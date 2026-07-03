const fs = require('fs'); const os = require('os'); const path = require('path');
const Database = require('better-sqlite3');

const sent = [];

describe('G-P1: per-token push budget caps storm', () => {
  let db, dir, expo;
  beforeEach(() => {
    sent.length = 0;
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-push-'));
    dir = d; db = new Database(path.join(d, 'test.db'));
    db.exec(`CREATE TABLE push_tokens (token TEXT PRIMARY KEY, user_id TEXT, server_name TEXT, created_at DATETIME, updated_at DATETIME);`);
    db.prepare(`INSERT INTO push_tokens (token, user_id) VALUES ('ExponentPushToken[aaa]', 'u1')`).run();
    jest.resetModules();
    jest.doMock('expo-server-sdk', () => ({ Expo: class {
      static isExpoPushToken() { return true; }
      chunkPushNotifications(m) { return [m]; }
      async sendPushNotificationsAsync(chunk) { sent.push(...chunk); return chunk.map(() => ({ status: 'ok' })); }
    } }));
    expo = require('../src/push/expo');
    expo.init(db);
    expo._resetBudget();
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('beyond the per-token window cap, further pushes are dropped', async () => {
    let queued = 0;
    for (let i = 0; i < 20; i++) queued += await expo.sendPushNotification('t', 'b', {});
    expect(queued).toBeLessThanOrEqual(expo.MAX_PUSHES_PER_WINDOW);
  });

  test('opts.userId scopes recipients to that user', async () => {
    db.prepare(`INSERT INTO push_tokens (token, user_id) VALUES ('ExponentPushToken[bbb]', 'u2')`).run();
    expo._resetBudget();
    const queued = await expo.sendPushNotification('t', 'b', {}, { userId: 'u2' });
    expect(queued).toBe(1); // only u2's single token
  });

  test('severity=critical maps to time-sensitive + cockpit-critical channel', async () => {
    await expo.sendPushNotification('t', 'b', {}, { severity: 'critical', userId: 'u1' });
    expect(sent[0]).toMatchObject({
      interruptionLevel: 'time-sensitive',
      channelId: 'cockpit-critical',
      sound: 'default',
    });
  });

  test('default/unknown severity maps to warn; info maps to passive + null sound', async () => {
    await expo.sendPushNotification('t', 'b', {}, { userId: 'u1' });
    expect(sent[0]).toMatchObject({
      interruptionLevel: 'active',
      channelId: 'cockpit-default',
      sound: 'default',
    });

    expo._resetBudget();
    sent.length = 0;
    await expo.sendPushNotification('t', 'b', {}, { severity: 'info', userId: 'u1' });
    expect(sent[0]).toMatchObject({
      interruptionLevel: 'passive',
      channelId: 'cockpit-info',
      sound: null,
    });
  });

  test('I2: exhausting the non-critical budget does not starve a CRITICAL push (separate bucket)', async () => {
    for (let i = 0; i < expo.MAX_PUSHES_PER_WINDOW; i++) {
      const queued = await expo.sendPushNotification('t', 'b', {}, { severity: 'warn', userId: 'u1' });
      expect(queued).toBe(1);
    }
    // Non-critical bucket is now exhausted — an 11th warn is dropped.
    const warnAfterExhaustion = await expo.sendPushNotification('t', 'b', {}, { severity: 'warn', userId: 'u1' });
    expect(warnAfterExhaustion).toBe(0);

    // A CRITICAL push right after must still queue — it draws from its own bucket.
    const critical = await expo.sendPushNotification('t', 'b', {}, { severity: 'critical', userId: 'u1' });
    expect(critical).toBe(1);
  });

  test('I2: the critical bucket itself caps at MAX_CRITICAL_PUSHES_PER_WINDOW per token', async () => {
    let queued = 0;
    for (let i = 0; i < expo.MAX_CRITICAL_PUSHES_PER_WINDOW + 1; i++) {
      queued += await expo.sendPushNotification('t', 'b', {}, { severity: 'critical', userId: 'u1' });
    }
    expect(queued).toBe(expo.MAX_CRITICAL_PUSHES_PER_WINDOW);
  });
});
