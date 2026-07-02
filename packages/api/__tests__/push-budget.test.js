const fs = require('fs'); const os = require('os'); const path = require('path');
const Database = require('better-sqlite3');

describe('G-P1: per-token push budget caps storm', () => {
  let db, dir, expo;
  beforeEach(() => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-push-'));
    dir = d; db = new Database(path.join(d, 'test.db'));
    db.exec(`CREATE TABLE push_tokens (token TEXT PRIMARY KEY, user_id TEXT, server_name TEXT, created_at DATETIME, updated_at DATETIME);`);
    db.prepare(`INSERT INTO push_tokens (token, user_id) VALUES ('ExponentPushToken[aaa]', 'u1')`).run();
    jest.resetModules();
    jest.doMock('expo-server-sdk', () => ({ Expo: class {
      static isExpoPushToken() { return true; }
      chunkPushNotifications(m) { return [m]; }
      async sendPushNotificationsAsync() { return []; }
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
});
