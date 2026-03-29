const express = require("express");
const router = express.Router();

const { authenticateWithKey } = require("../auth/keys");
const { authenticateWithCredentials, createUser, listUsers, deleteUser, updateUserRole } = require("../auth/users");
const { signAccessToken, generateRefreshToken, validateRefreshToken } = require("../auth/jwt");
const {
  requireAuth,
  requireRole,
  rateLimitAuth,
  recordFailedAttempt,
  clearFailedAttempts,
} = require("../auth/middleware");
const { auditLog } = require("../db/sqlite");
const { validateBody } = require("../security/request-validator");
const { requestFingerprint } = require("../security/crypto");

const AUTH_MODE = process.env.AUTH_MODE || "key";
const SERVER_NAME = process.env.SERVER_NAME || "Cockpit Server";

// ── API key auth (single-admin mode) ─────────────────────
router.post("/auth/token", rateLimitAuth, validateBody("authToken"), (req, res) => {
  if (AUTH_MODE !== "key") {
    return res.status(400).json({ error: "Use /auth/login for user-based auth" });
  }

  const { apiKey } = req.body;
  const result = authenticateWithKey(apiKey);
  if (!result) {
    recordFailedAttempt(req._authIp);
    return res.status(401).json({ error: "Invalid API key" });
  }

  clearFailedAttempts(req._authIp);
  const fingerprint = requestFingerprint(req);
  auditLog(result.userId, "auth.token", null, "API key authentication");
  res.json({
    accessToken: result.accessToken,
    refreshToken: generateRefreshToken(result.userId, result.role, fingerprint),
    role: result.role,
    serverName: SERVER_NAME,
  });
});

// ── User login (multi-user mode) ─────────────────────────
router.post("/auth/login", rateLimitAuth, validateBody("authLogin"), (req, res) => {
  if (AUTH_MODE !== "users") {
    return res.status(400).json({ error: "Use /auth/token for API key auth" });
  }

  const { email, password } = req.body;
  const result = authenticateWithCredentials(email, password);
  if (!result) {
    recordFailedAttempt(req._authIp);
    return res.status(401).json({ error: "Invalid credentials" });
  }

  clearFailedAttempts(req._authIp);
  const fingerprint = requestFingerprint(req);
  auditLog(result.userId, "auth.login", null, `User login: ${email}`);
  res.json({
    accessToken: result.accessToken,
    refreshToken: generateRefreshToken(result.userId, result.role, fingerprint),
    role: result.role,
    email: result.email,
    serverName: SERVER_NAME,
  });
});

// ── Refresh token ────────────────────────────────────────
router.post("/auth/refresh", rateLimitAuth, validateBody("authRefresh"), (req, res) => {
  const { refreshToken } = req.body;
  const fingerprint = requestFingerprint(req);

  const payload = validateRefreshToken(refreshToken, fingerprint);
  if (!payload) {
    recordFailedAttempt(req._authIp);
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }

  clearFailedAttempts(req._authIp);
  const accessToken = signAccessToken({ sub: payload.userId, role: payload.role });
  const newRefreshToken = generateRefreshToken(payload.userId, payload.role, fingerprint);

  res.json({ accessToken, refreshToken: newRefreshToken });
});

// ── User management (multi-user mode, admin only) ────────
router.get("/auth/users", requireAuth, requireRole("admin"), (_req, res) => {
  res.json({ users: listUsers() });
});

router.post("/auth/users", requireAuth, requireRole("admin"), validateBody("createUser"), (req, res) => {
  try {
    const { email, password, role } = req.body;
    const user = createUser(email, password, role);
    auditLog(req.user.id, "user.create", email, `Role: ${role || "viewer"}`);
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/auth/users/:id", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid user ID" });
    if (id === req.user.id) return res.status(400).json({ error: "Cannot delete your own account" });
    deleteUser(id);
    auditLog(req.user.id, "user.delete", req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /auth/users/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/auth/users/:id/role", requireAuth, requireRole("admin"), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid user ID" });
    updateUserRole(id, req.body.role);
    auditLog(req.user.id, "user.role", req.params.id, `New role: ${req.body.role}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
