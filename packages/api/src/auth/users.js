const bcrypt = require("bcryptjs");
const { signAccessToken } = require("./jwt");

let db = null;

/** Initialize the users table (called from db/sqlite.js) */
function init(database) {
  db = database;
}

/** Authenticate with email + password, return tokens or null */
function authenticateWithCredentials(email, password) {
  if (!db) throw new Error("User database not initialized");

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return null;

  if (!bcrypt.compareSync(password, user.password_hash)) return null;

  // Rehash if stored hash uses a weaker cost factor (< 12)
  const currentCost = parseInt(user.password_hash.split("$")[2], 10);
  if (!currentCost || currentCost < 12) {
    const newHash = bcrypt.hashSync(password, 12);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(newHash, user.id);
  }

  const accessToken = signAccessToken({ sub: user.id, role: user.role, email: user.email });

  // Update last_login
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(user.id);

  return { accessToken, userId: user.id, role: user.role, email: user.email };
}

/** Create a new user (admin only) */
function createUser(email, password, role = "viewer") {
  if (!db) throw new Error("User database not initialized");

  const valid = ["admin", "operator", "viewer"];
  if (!valid.includes(role)) throw new Error(`Invalid role: ${role}. Must be one of: ${valid.join(", ")}`);

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) throw new Error("User already exists");

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)").run(email, hash, role);

  return { id: result.lastInsertRowid, email, role };
}

/** List all users (admin only) */
function listUsers() {
  if (!db) throw new Error("User database not initialized");
  return db.prepare("SELECT id, email, role, created_at, last_login FROM users").all();
}

/** Delete a user (admin only) */
function deleteUser(id) {
  if (!db) throw new Error("User database not initialized");
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
}

/** Update user role (admin only) */
function updateUserRole(id, role) {
  if (!db) throw new Error("User database not initialized");
  const valid = ["admin", "operator", "viewer"];
  if (!valid.includes(role)) throw new Error(`Invalid role: ${role}`);
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

module.exports = {
  init,
  authenticateWithCredentials,
  createUser,
  listUsers,
  deleteUser,
  updateUserRole,
};
