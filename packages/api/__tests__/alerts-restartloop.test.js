const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-restartloop-'));
  const db = new Database(path.join(dir, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return { db, dir };
}

describe('B7: restart-loop dedup via gated RestartCount inspect (G-Gk1)', () => {
  let db, dir, indexMod, alerts, pushSpy;

  beforeEach(() => {
    ({ db, dir } = freshDb());
    require('../src/db/sqlite').runMigrations(db);
    jest.resetModules();
    pushSpy = jest.fn(async () => {});
    // No SSE clients connected — matches the 2am oncall scenario this whole detection path serves.
    jest.doMock('../src/stream/sse', () => ({
      getClientCount: jest.fn(() => 0),
      broadcast: jest.fn(),
      closeAllClients: jest.fn(),
    }));
    // Non-breaching metrics so alertEngine.evaluateRules never contributes a push —
    // isolates the assertions to the crash-loop path.
    jest.doMock('../src/system/metrics', () => ({
      getSystemMetrics: () => ({ cpuPercent: 5, memory: { percent: 10 }, disk: { percent: 10 }, load: { load1: 0.1 } }),
    }));
    // evaluateAndDetect lazy-requires './push/expo' directly for the crash-loop push —
    // mock it so pushSpy captures those calls (title is call[0]).
    jest.doMock('../src/push/expo', () => ({
      init: jest.fn(),
      sendPushNotification: (...args) => pushSpy(...args),
    }));

    alerts = require('../src/system/alerts');
    alerts.init(db, pushSpy);
    indexMod = require('../src/index');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    jest.dontMock('../src/stream/sse');
    jest.dontMock('../src/docker/containers');
    jest.dontMock('../src/system/metrics');
    jest.dontMock('../src/push/expo');
    jest.resetModules();
  });

  function armTick() {
    indexMod._resetSamplerState();
    indexMod._setRecorder(() => {});
  }

  test('a crash-looping container collapses to ONE crash-loop push across 4 ticks, and does not re-fire on a 5th', async () => {
    let restartCount = 0;
    const inspectContainer = jest.fn(async () => {
      restartCount += 1;
      return { State: { RestartCount: restartCount } };
    });
    jest.doMock('../src/docker/containers', () => ({
      listContainers: jest.fn(async () => [
        { id: 'c1', name: 'web', state: 'restarting', status: 'Restarting (1) 3 seconds ago' },
      ]),
      inspectContainer,
    }));
    // Re-require index after docker/containers mock is in place (lazy requires inside
    // evaluateAndDetect/sampleTick pick up jest.doMock regardless of require order, but
    // keep the same indexMod instance so module-level _restartHistory persists across ticks).

    // Tick 1: baseline — RestartCount 1, no rise counted on first sight.
    armTick();
    await indexMod.sampleTick();
    // Tick 2: RestartCount 2 — rises=1.
    armTick();
    await indexMod.sampleTick();
    // Tick 3: RestartCount 3 — rises=2.
    armTick();
    await indexMod.sampleTick();
    // Tick 4: RestartCount 4 — rises=3 → fires exactly once.
    armTick();
    await indexMod.sampleTick();

    let crashPushes = pushSpy.mock.calls.filter((c) => /crash-looping/i.test(c[0]));
    expect(crashPushes.length).toBe(1);

    // Tick 5: RestartCount 5 — already alerted, must not fire again.
    armTick();
    await indexMod.sampleTick();
    crashPushes = pushSpy.mock.calls.filter((c) => /crash-looping/i.test(c[0]));
    expect(crashPushes.length).toBe(1);
  });

  test('a healthy, never-transitioning container is never inspected (gated inspect)', async () => {
    const inspectContainer = jest.fn(async () => ({ State: { RestartCount: 0 } }));
    jest.doMock('../src/docker/containers', () => ({
      listContainers: jest.fn(async () => [{ id: 'c1', name: 'web', state: 'running', status: 'Up 2 hours' }]),
      inspectContainer,
    }));

    armTick();
    await indexMod.sampleTick();
    armTick();
    await indexMod.sampleTick();
    armTick();
    await indexMod.sampleTick();

    expect(inspectContainer.mock.calls.length).toBe(0);
  });

  test('a container with a live crash-loop alert suppresses the regular Container Down push, but the state-change broadcast still fires (B7 down-push suppression)', async () => {
    const listContainers = jest
      .fn()
      .mockResolvedValueOnce([{ id: 'c1', name: 'web', state: 'running', status: 'Up 2 hours' }])
      .mockResolvedValueOnce([{ id: 'c1', name: 'web', state: 'exited', status: 'Exited (1) 2 seconds ago' }]);
    const inspectContainer = jest.fn(async () => ({ State: { RestartCount: 5 } }));
    jest.doMock('../src/docker/containers', () => ({ listContainers, inspectContainer }));

    // Tick 1: baseline — seeds _previousContainerStates['c1'] = 'running'. State is 'running'
    // with no restarting status and no prior recorded state, so the gated inspect never runs
    // and _restartHistory stays untouched by this tick.
    armTick();
    await indexMod.sampleTick();
    expect(inspectContainer).not.toHaveBeenCalled();

    // Directly seed a live crash-loop alert for c1 — the exported test seam standing in for
    // a prior tick's inspect having already crossed the rise threshold and fired the
    // crash-loop push.
    indexMod._restartHistory['c1'] = { lastCount: 5, windowStart: Date.now(), rises: 3, alerted: true };

    // Tick 2: container transitions running -> exited.
    armTick();
    await indexMod.sampleTick();

    // The regular "Container Down" push must be suppressed by the live crash-loop alert...
    const downPushes = pushSpy.mock.calls.filter((c) => /Container Down/i.test(c[0]));
    expect(downPushes.length).toBe(0);

    // ...but the tick still processed the transition: the state_change SSE broadcast fires
    // unconditionally, proving only the push (not the whole transition-handling branch) was skipped.
    const sse = require('../src/stream/sse');
    const alertBroadcasts = sse.broadcast.mock.calls.filter((c) => c[0] === 'alert');
    expect(alertBroadcasts.length).toBe(1);
    expect(alertBroadcasts[0][1]).toMatchObject({
      type: 'container_state_change',
      containerId: 'c1',
      previousState: 'running',
      currentState: 'exited',
    });

    // No second crash-loop push either — the seeded entry was already alerted and the
    // inspected RestartCount (5) matches lastCount (5), so no new rise is counted.
    const crashPushes = pushSpy.mock.calls.filter((c) => /crash-looping/i.test(c[0]));
    expect(crashPushes.length).toBe(0);
  });

  test('the 5-minute crash-loop window resets rises on expiry but preserves lastCount, then re-fires once in the new window (B7 window reset)', async () => {
    const inspectContainer = jest.fn();
    const listContainers = jest.fn(async () => [
      { id: 'c1', name: 'web', state: 'restarting', status: 'Restarting (1) 3 seconds ago' },
    ]);
    jest.doMock('../src/docker/containers', () => ({ listContainers, inspectContainer }));

    // Seed an expired-window crash-loop entry: already alerted in the OLD window, which ended
    // more than the 5-minute RESTART_WINDOW_MS ago.
    indexMod._restartHistory['c1'] = {
      lastCount: 4,
      windowStart: Date.now() - 6 * 60 * 1000,
      rises: 3,
      alerted: true,
    };

    // Tick 1: RestartCount 5. The window-expiry branch resets rises/alerted to 0/false and
    // bumps windowStart to `now` FIRST; the rise is then counted from the preserved lastCount
    // (4 -> 5) in the same pass — so rises lands on 1, not on 0 from a re-baseline.
    inspectContainer.mockResolvedValueOnce({ State: { RestartCount: 5 } });
    armTick();
    await indexMod.sampleTick();
    expect(indexMod._restartHistory['c1'].lastCount).toBe(5);
    expect(indexMod._restartHistory['c1'].rises).toBe(1);
    expect(indexMod._restartHistory['c1'].alerted).toBe(false);
    expect(pushSpy.mock.calls.filter((c) => /crash-looping/i.test(c[0])).length).toBe(0);

    // Tick 2: RestartCount 6 — rises=2, still under threshold.
    inspectContainer.mockResolvedValueOnce({ State: { RestartCount: 6 } });
    armTick();
    await indexMod.sampleTick();
    expect(indexMod._restartHistory['c1'].lastCount).toBe(6);
    expect(indexMod._restartHistory['c1'].rises).toBe(2);
    expect(pushSpy.mock.calls.filter((c) => /crash-looping/i.test(c[0])).length).toBe(0);

    // Tick 3: RestartCount 7 — rises=3, crosses the threshold again and fires exactly once
    // in the new window.
    inspectContainer.mockResolvedValueOnce({ State: { RestartCount: 7 } });
    armTick();
    await indexMod.sampleTick();
    expect(indexMod._restartHistory['c1'].rises).toBe(3);
    expect(indexMod._restartHistory['c1'].alerted).toBe(true);
    const crashPushes = pushSpy.mock.calls.filter((c) => /crash-looping/i.test(c[0]));
    // Exactly one crash-loop push across the whole test — the seeded alerted:true entry
    // never produced its own push, so this is the only one from the new window.
    expect(crashPushes.length).toBe(1);
  });
});
