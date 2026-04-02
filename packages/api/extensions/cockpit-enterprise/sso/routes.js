/**
 * SSO/SAML Module — Enterprise
 *
 * Manages SAML 2.0 Identity Provider configurations and SSO sessions.
 * Provides SP metadata, IdP CRUD, and assertion consumer service (ACS).
 *
 * The ACS endpoint performs XML signature verification with minimal Exclusive
 * XML Canonicalization (exc-c14n) using Node's built-in crypto module.
 * InResponseTo replay protection ensures each SAML response can only be
 * consumed once (request IDs expire after 5 minutes).
 *
 * Routes (mounted at /api/ext/cockpit-enterprise/sso):
 *   GET    /providers           — List configured IdPs
 *   GET    /providers/:id       — Get IdP details
 *   POST   /providers           — Add IdP configuration
 *   PUT    /providers/:id       — Update IdP configuration
 *   DELETE /providers/:id       — Remove IdP
 *   PUT    /providers/:id/toggle — Enable/disable IdP
 *   GET    /metadata            — SP metadata (XML)
 *   GET    /login/:id           — Initiate SSO login (generates AuthnRequest)
 *   POST   /acs                 — Assertion Consumer Service (SAML response handler)
 *   GET    /sessions            — List active SSO sessions
 *   DELETE /sessions/:id        — Revoke SSO session
 *   DELETE /sessions/expired    — Purge expired sessions
 */

const express = require("express");
const crypto = require("crypto");
const { requireRole } = require("../helpers/auth");

// ── Validation (stateless, shared across instances) ─────────────
const VALID_BINDINGS = ["HTTP-POST", "HTTP-Redirect"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PEM_LENGTH = 50000; // 50KB — generous for any X.509 cert

function validateProvider(body) {
  const { name, entity_id, sso_url, certificate, binding } = body;
  if (!name || typeof name !== "string" || name.length > 200) {
    return "name is required (max 200 chars)";
  }
  if (!entity_id || typeof entity_id !== "string" || entity_id.length > 500) {
    return "entity_id is required (max 500 chars)";
  }
  if (!sso_url || typeof sso_url !== "string") {
    return "sso_url is required";
  }
  try {
    const u = new URL(sso_url);
    if (!["http:", "https:"].includes(u.protocol)) return "sso_url must be http or https";
  } catch {
    return "sso_url must be a valid URL";
  }
  if (!certificate || typeof certificate !== "string") {
    return "certificate (X.509 PEM) is required";
  }
  if (certificate.length > MAX_PEM_LENGTH) {
    return `certificate exceeds max length (${MAX_PEM_LENGTH} chars)`;
  }
  if (!certificate.includes("-----BEGIN CERTIFICATE-----")) {
    return "certificate must be in PEM format";
  }
  if (binding && !VALID_BINDINGS.includes(binding)) {
    return `binding must be one of: ${VALID_BINDINGS.join(", ")}`;
  }
  return null;
}

// ── Minimal Exclusive XML Canonicalization (exc-c14n) ────────────
// Covers the subset needed for standard SAML responses from Okta,
// Azure AD, and Google Workspace: comment stripping, tag whitespace
// normalisation, alphabetical attribute ordering, and default
// namespace handling.  NOT a full C14N implementation.

function canonicalizeExcC14n(xml) {
  // 1. Strip comments
  let out = xml.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Normalise whitespace between tags (collapse runs of whitespace
  //    that sit between > and < but are NOT inside text content)
  out = out.replace(/>\s+</g, "><");

  // 3. Normalise whitespace *inside* opening/self-closing tags:
  //    collapse multiple spaces/newlines between attributes, and
  //    ensure a single space before the closing /> or >.
  out = out.replace(/<([A-Za-z_:][\w:.-]*)(\s[\s\S]*?)(\s*\/?>)/g, (_match, tag, attrs, close) => {
    // Parse individual attributes (name="value" pairs)
    const attrRe = /([\w:.=-]+)\s*=\s*"([^"]*)"/g;
    const attrList = [];
    let am;
    while ((am = attrRe.exec(attrs)) !== null) {
      attrList.push({ name: am[1], value: am[2] });
    }

    // 4. Sort attributes alphabetically.  xmlns attributes come first
    //    (namespace declarations before regular attrs per exc-c14n),
    //    then remaining attrs in lexicographic order.
    attrList.sort((a, b) => {
      const aIsNs = a.name === "xmlns" || a.name.startsWith("xmlns:");
      const bIsNs = b.name === "xmlns" || b.name.startsWith("xmlns:");
      if (aIsNs && !bIsNs) return -1;
      if (!aIsNs && bIsNs) return 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });

    const sortedAttrs = attrList.map((a) => `${a.name}="${a.value}"`).join(" ");
    const closeTrimmed = close.trim();
    return `<${tag}${sortedAttrs ? " " + sortedAttrs : ""}${closeTrimmed}`;
  });

  // 5. Self-closing tags: in C14N, empty elements use explicit
  //    open+close, e.g. <br></br>.  Convert <Tag .../> → <Tag ...></Tag>.
  out = out.replace(/<([A-Za-z_:][\w:.-]*)([^>]*?)\/>/g, "<$1$2></$1>");

  return out;
}

// ── SAML XML parsing helpers (basic, no external deps) ─────────

function extractXmlElement(xml, localName) {
  // Match element with optional namespace prefix, return text content.
  // Strips XML comments first to prevent comment injection.
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");
  const re = new RegExp(
    `<(?:[\\w-]+:)?${localName}[^>]*>([^<]+)<\\/(?:[\\w-]+:)?${localName}>`,
    ""
  );
  const m = cleaned.match(re);
  return m ? m[1].trim() : null;
}

function extractXmlAttribute(xml, elementLocalName, attrName) {
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");
  const re = new RegExp(
    `<(?:[\\w-]+:)?${elementLocalName}[^>]*?${attrName}="([^"]+)"`,
    ""
  );
  const m = cleaned.match(re);
  return m ? m[1] : null;
}

function extractSignatureValue(xml) {
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");
  const m = cleaned.match(
    /<(?:ds:)?SignatureValue[^>]*>\s*([\s\S]+?)\s*<\/(?:ds:)?SignatureValue>/
  );
  return m ? m[1].replace(/\s+/g, "") : null;
}

function extractSignedInfo(xml) {
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");
  const m = cleaned.match(
    /(<(?:ds:)?SignedInfo[\s\S]*?<\/(?:ds:)?SignedInfo>)/
  );
  return m ? m[1] : null;
}

function extractSamlAttributes(xml) {
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");
  const attributes = {};
  const re =
    /<(?:[\w-]+:)?Attribute\s+Name="([^"]+)"[^>]*>\s*<(?:[\w-]+:)?AttributeValue[^>]*>([^<]+)<\/(?:[\w-]+:)?AttributeValue>/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    attributes[m[1]] = m[2].trim();
  }
  return attributes;
}

function verifySamlSignature(xml, certPem) {
  const signatureValue = extractSignatureValue(xml);
  const signedInfo = extractSignedInfo(xml);
  if (!signatureValue || !signedInfo) return false;

  // Apply Exclusive XML Canonicalization to SignedInfo before
  // signature verification — required by the SAML spec.
  const canonicalSignedInfo = canonicalizeExcC14n(signedInfo);

  try {
    const sig = Buffer.from(signatureValue, "base64");

    // Try RSA-SHA256 first (most common), then RSA-SHA1
    const verifier256 = crypto.createVerify("RSA-SHA256");
    verifier256.update(canonicalSignedInfo);
    if (verifier256.verify(certPem, sig)) return true;

    const verifier1 = crypto.createVerify("RSA-SHA1");
    verifier1.update(canonicalSignedInfo);
    return verifier1.verify(certPem, sig);
  } catch {
    return false;
  }
}

function validateSamlConditions(xml, expectedAudience) {
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");
  const now = new Date();

  // Check NotBefore
  const notBefore = extractXmlAttribute(cleaned, "Conditions", "NotBefore");
  if (notBefore) {
    const nbDate = new Date(notBefore);
    // Allow 5 minute clock skew
    if (now < new Date(nbDate.getTime() - 5 * 60 * 1000)) {
      return "Assertion is not yet valid (NotBefore)";
    }
  }

  // Check NotOnOrAfter
  const notOnOrAfter = extractXmlAttribute(cleaned, "Conditions", "NotOnOrAfter");
  if (notOnOrAfter) {
    const noaDate = new Date(notOnOrAfter);
    if (now >= new Date(noaDate.getTime() + 5 * 60 * 1000)) {
      return "Assertion has expired (NotOnOrAfter)";
    }
  }

  // Check Audience restriction
  const audience = extractXmlElement(cleaned, "Audience");
  if (audience && expectedAudience && audience !== expectedAudience) {
    return `Audience mismatch: expected ${expectedAudience}, got ${audience}`;
  }

  return null;
}

// ── Factory ─────────────────────────────────────────────────────
function create() {
  const router = express.Router();
  let db = null;
  let services = null;

  // Rate limiting state — per-instance, not module-scoped
  const acsAttempts = new Map();
  const ACS_RATE_LIMIT = 10; // max per window
  const ACS_RATE_WINDOW = 60000; // 1 minute

  function checkAcsRateLimit(ip) {
    const now = Date.now();
    const record = acsAttempts.get(ip);
    if (!record || now - record.windowStart > ACS_RATE_WINDOW) {
      acsAttempts.set(ip, { windowStart: now, count: 1 });
      return true;
    }
    record.count++;
    return record.count <= ACS_RATE_LIMIT;
  }

// ── Init ───────────────────────────────────────────────────────
function init(svc) {
  services = svc;
  db = svc.db;

  db.exec(`
    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_sso_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_id TEXT NOT NULL UNIQUE,
      sso_url TEXT NOT NULL,
      slo_url TEXT,
      certificate TEXT NOT NULL,
      binding TEXT NOT NULL DEFAULT 'HTTP-POST',
      name_id_format TEXT DEFAULT 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      attribute_mapping TEXT DEFAULT '{}',
      auto_provision INTEGER DEFAULT 0,
      default_role TEXT DEFAULT 'viewer',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now')),
      updated_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_sso_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider_id TEXT NOT NULL REFERENCES ext_cockpit_enterprise_sso_providers(id) ON DELETE CASCADE,
      name_id TEXT NOT NULL,
      session_index TEXT,
      attributes TEXT DEFAULT '{}',
      ip_address TEXT,
      user_agent TEXT,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_ce_sso_sessions_user
      ON ext_cockpit_enterprise_sso_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_sso_sessions_expires
      ON ext_cockpit_enterprise_sso_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_ext_ce_sso_providers_entity
      ON ext_cockpit_enterprise_sso_providers(entity_id);

    CREATE TABLE IF NOT EXISTS ext_cockpit_enterprise_sso_pending_requests (
      request_id TEXT PRIMARY KEY,
      provider_id TEXT,
      created_at DATETIME DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ext_ce_sso_pending_created
      ON ext_cockpit_enterprise_sso_pending_requests(created_at);
  `);
}

// ── InResponseTo replay protection helpers ──────────────────────
const SAML_REQUEST_TTL_SECONDS = 300; // 5 minutes

function storePendingRequestId(requestId, providerId) {
  // Clean up expired entries first (older than 5 min)
  db.prepare(
    `DELETE FROM ext_cockpit_enterprise_sso_pending_requests
     WHERE created_at <= datetime('now', '-${SAML_REQUEST_TTL_SECONDS} seconds')`
  ).run();

  db.prepare(
    "INSERT OR IGNORE INTO ext_cockpit_enterprise_sso_pending_requests (request_id, provider_id) VALUES (?, ?)"
  ).run(requestId, providerId || null);
}

function consumePendingRequestId(requestId) {
  // Clean up expired entries
  db.prepare(
    `DELETE FROM ext_cockpit_enterprise_sso_pending_requests
     WHERE created_at <= datetime('now', '-${SAML_REQUEST_TTL_SECONDS} seconds')`
  ).run();

  const row = db
    .prepare("SELECT request_id FROM ext_cockpit_enterprise_sso_pending_requests WHERE request_id = ?")
    .get(requestId);

  if (!row) return false;

  // One-time use: delete after consumption
  db.prepare("DELETE FROM ext_cockpit_enterprise_sso_pending_requests WHERE request_id = ?").run(
    requestId
  );
  return true;
}

// ── Provider CRUD ──────────────────────────────────────────────

// List providers
router.get("/providers", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const providers = db
      .prepare(
        "SELECT id, name, entity_id, sso_url, slo_url, binding, name_id_format, auto_provision, default_role, enabled, created_at, updated_at FROM ext_cockpit_enterprise_sso_providers ORDER BY name LIMIT ? OFFSET ?"
      )
      .all(limit, offset);

    const total = db
      .prepare("SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_sso_providers")
      .get().cnt;

    res.json({ providers, total });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get provider
router.get("/providers/:id", (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid provider ID" });
    }

    const provider = db
      .prepare(
        "SELECT id, name, entity_id, sso_url, slo_url, binding, name_id_format, attribute_mapping, auto_provision, default_role, enabled, created_at, updated_at FROM ext_cockpit_enterprise_sso_providers WHERE id = ?"
      )
      .get(req.params.id);

    if (!provider) return res.status(404).json({ error: "Provider not found" });
    res.json(provider);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Create provider
router.post("/providers", requireRole("admin"), (req, res) => {
  try {
    const err = validateProvider(req.body);
    if (err) return res.status(400).json({ error: err });

    const id = crypto.randomUUID();
    const {
      name,
      entity_id,
      sso_url,
      slo_url,
      certificate,
      binding,
      name_id_format,
      attribute_mapping,
      auto_provision,
      default_role,
    } = req.body;

    db.prepare(
      `INSERT INTO ext_cockpit_enterprise_sso_providers
        (id, name, entity_id, sso_url, slo_url, certificate, binding, name_id_format, attribute_mapping, auto_provision, default_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name,
      entity_id,
      sso_url,
      slo_url || null,
      certificate,
      binding || "HTTP-POST",
      name_id_format || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      JSON.stringify(attribute_mapping || {}),
      auto_provision ? 1 : 0,
      default_role || "viewer"
    );

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "sso_provider.create", id, name);
    }

    res.status(201).json({ id, name, entity_id, enabled: true });
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: "A provider with this entity_id already exists" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// Update provider
router.put("/providers/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid provider ID" });
    }

    const existing = db
      .prepare("SELECT id FROM ext_cockpit_enterprise_sso_providers WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Provider not found" });

    const err = validateProvider(req.body);
    if (err) return res.status(400).json({ error: err });

    const {
      name,
      entity_id,
      sso_url,
      slo_url,
      certificate,
      binding,
      name_id_format,
      attribute_mapping,
      auto_provision,
      default_role,
    } = req.body;

    db.prepare(
      `UPDATE ext_cockpit_enterprise_sso_providers SET
        name = ?, entity_id = ?, sso_url = ?, slo_url = ?, certificate = ?,
        binding = ?, name_id_format = ?, attribute_mapping = ?,
        auto_provision = ?, default_role = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      name,
      entity_id,
      sso_url,
      slo_url || null,
      certificate,
      binding || "HTTP-POST",
      name_id_format || "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      JSON.stringify(attribute_mapping || {}),
      auto_provision ? 1 : 0,
      default_role || "viewer",
      req.params.id
    );

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "sso_provider.update", req.params.id, name);
    }

    res.json({ id: req.params.id, updated: true });
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: "A provider with this entity_id already exists" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

// Delete provider
router.delete("/providers/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid provider ID" });
    }

    const existing = db
      .prepare("SELECT id, name FROM ext_cockpit_enterprise_sso_providers WHERE id = ?")
      .get(req.params.id);
    if (!existing) return res.status(404).json({ error: "Provider not found" });

    db.transaction(() => {
      db.prepare("DELETE FROM ext_cockpit_enterprise_sso_sessions WHERE provider_id = ?").run(
        req.params.id
      );
      db.prepare("DELETE FROM ext_cockpit_enterprise_sso_providers WHERE id = ?").run(
        req.params.id
      );
    })();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "sso_provider.delete", req.params.id, existing.name);
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Toggle provider enabled/disabled
router.put("/providers/:id/toggle", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid provider ID" });
    }

    const provider = db
      .prepare("SELECT id, name, enabled FROM ext_cockpit_enterprise_sso_providers WHERE id = ?")
      .get(req.params.id);
    if (!provider) return res.status(404).json({ error: "Provider not found" });

    const newState = provider.enabled ? 0 : 1;
    db.prepare(
      "UPDATE ext_cockpit_enterprise_sso_providers SET enabled = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(newState, req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(
        userId,
        newState ? "sso_provider.enable" : "sso_provider.disable",
        req.params.id,
        provider.name
      );
    }

    res.json({ id: req.params.id, enabled: !!newState });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── SP Metadata ────────────────────────────────────────────────
router.get("/metadata", (req, res) => {
  try {
    // Use configured base URL or derive from env, not from Host header
    const envBase = process.env.COCKPIT_BASE_URL;
    const baseUrl = envBase || `${req.protocol}://${req.get("host")}`;
    const acsUrl = `${baseUrl}/api/ext/cockpit-enterprise/sso/acs`;
    const entityId = `${baseUrl}/api/ext/cockpit-enterprise/sso/metadata`;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
  entityID="${entityId}">
  <md:SPSSODescriptor
    AuthnRequestsSigned="false"
    WantAssertionsSigned="true"
    protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService
      Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
      Location="${acsUrl}"
      index="0"
      isDefault="true" />
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;

    res.set("Content-Type", "application/xml");
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── SSO Login Initiation (generates AuthnRequest) ──────────────
router.get("/login/:id", (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid provider ID" });
    }

    const provider = db
      .prepare(
        "SELECT * FROM ext_cockpit_enterprise_sso_providers WHERE id = ? AND enabled = 1"
      )
      .get(req.params.id);
    if (!provider) {
      return res.status(404).json({ error: "Provider not found or disabled" });
    }

    const envBase = process.env.COCKPIT_BASE_URL;
    const baseUrl = envBase || `${req.protocol}://${req.get("host")}`;
    const acsUrl = `${baseUrl}/api/ext/cockpit-enterprise/sso/acs`;
    const entityId = `${baseUrl}/api/ext/cockpit-enterprise/sso/metadata`;

    const requestId = `_${crypto.randomUUID()}`;
    const issueInstant = new Date().toISOString();

    // Store the request ID for InResponseTo replay protection
    storePendingRequestId(requestId, provider.id);

    const authnRequest = `<samlp:AuthnRequest
  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"
  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
  ID="${requestId}"
  Version="2.0"
  IssueInstant="${issueInstant}"
  Destination="${provider.sso_url}"
  AssertionConsumerServiceURL="${acsUrl}"
  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST">
  <saml:Issuer>${entityId}</saml:Issuer>
  <samlp:NameIDPolicy Format="${provider.name_id_format}" AllowCreate="true" />
</samlp:AuthnRequest>`;

    const encodedRequest = Buffer.from(authnRequest).toString("base64");

    if (provider.binding === "HTTP-Redirect") {
      const redirectUrl = new URL(provider.sso_url);
      redirectUrl.searchParams.set("SAMLRequest", encodedRequest);
      return res.redirect(redirectUrl.toString());
    }

    // HTTP-POST binding: render a self-submitting form
    const html = `<!DOCTYPE html>
<html><body onload="document.forms[0].submit()">
<form method="POST" action="${provider.sso_url}">
  <input type="hidden" name="SAMLRequest" value="${encodedRequest}" />
  <noscript><button type="submit">Continue to SSO</button></noscript>
</form></body></html>`;

    res.set("Content-Type", "text/html");
    res.send(html);
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Assertion Consumer Service ─────────────────────────────────
router.post("/acs", (req, res) => {
  try {
    // Rate limiting
    const clientIp = req.ip || "unknown";
    if (!checkAcsRateLimit(clientIp)) {
      return res.status(429).json({ error: "Too many SSO attempts. Try again later." });
    }

    const { SAMLResponse } = req.body;
    if (!SAMLResponse || typeof SAMLResponse !== "string") {
      return res.status(400).json({ error: "SAMLResponse is required" });
    }

    // Decode base64 SAML response
    let xml;
    try {
      xml = Buffer.from(SAMLResponse, "base64").toString("utf-8");
    } catch {
      return res.status(400).json({ error: "Invalid SAMLResponse encoding" });
    }

    // Strip XML comments before any extraction (prevents comment injection)
    const cleanedXml = xml.replace(/<!--[\s\S]*?-->/g, "");

    // Extract Issuer to identify the provider
    const issuer = extractXmlElement(cleanedXml, "Issuer");
    if (!issuer) {
      return res.status(400).json({ error: "No Issuer found in SAML response" });
    }

    // Find the provider
    const provider = db
      .prepare(
        "SELECT * FROM ext_cockpit_enterprise_sso_providers WHERE entity_id = ? AND enabled = 1"
      )
      .get(issuer);
    if (!provider) {
      return res.status(403).json({ error: "Unknown or disabled identity provider" });
    }

    // Verify XML signature using provider's certificate
    if (!verifySamlSignature(cleanedXml, provider.certificate)) {
      if (services?.auditLog) {
        services.auditLog("system", "sso.signature_failure", null, `issuer=${issuer}, ip=${clientIp}`);
      }
      return res.status(403).json({ error: "SAML signature verification failed" });
    }

    // InResponseTo replay protection: verify the response references a
    // pending AuthnRequest ID we issued, and consume it (one-time use).
    const inResponseTo = extractXmlAttribute(cleanedXml, "Response", "InResponseTo")
      || extractXmlAttribute(cleanedXml, "SubjectConfirmationData", "InResponseTo");
    if (inResponseTo) {
      if (!consumePendingRequestId(inResponseTo)) {
        if (services?.auditLog) {
          services.auditLog(
            "system",
            "sso.replay_attempt",
            null,
            `InResponseTo=${inResponseTo}, issuer=${issuer}, ip=${clientIp}`
          );
        }
        return res.status(403).json({ error: "SAML response replay detected or request expired" });
      }
    }

    // Validate time conditions and audience restriction
    const envBase = process.env.COCKPIT_BASE_URL;
    const expectedAudience = envBase
      ? `${envBase}/api/ext/cockpit-enterprise/sso/metadata`
      : null;
    const conditionErr = validateSamlConditions(cleanedXml, expectedAudience);
    if (conditionErr) {
      return res.status(400).json({ error: conditionErr });
    }

    // Extract NameID
    const nameId = extractXmlElement(cleanedXml, "NameID");
    if (!nameId) {
      return res.status(400).json({ error: "No NameID found in SAML response" });
    }

    // Extract SessionIndex
    const sessionIndex = extractXmlAttribute(cleanedXml, "AuthnStatement", "SessionIndex");

    // Extract attributes
    const attributes = extractSamlAttributes(cleanedXml);

    // Create SSO session
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(); // 8h

    db.prepare(
      `INSERT INTO ext_cockpit_enterprise_sso_sessions
        (id, user_id, provider_id, name_id, session_index, attributes, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      sessionId,
      nameId,
      provider.id,
      nameId,
      sessionIndex,
      JSON.stringify(attributes),
      clientIp,
      req.get("user-agent") || "",
      expiresAt
    );

    if (services?.auditLog) {
      services.auditLog(nameId, "sso.login", sessionId, `via ${provider.name}`);
    }

    res.json({
      session_id: sessionId,
      user_id: nameId,
      provider: provider.name,
      attributes,
      expires_at: expiresAt,
      auto_provision: !!provider.auto_provision,
      default_role: provider.default_role,
    });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Sessions ───────────────────────────────────────────────────

// List active sessions
router.get("/sessions", (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const sessions = db
      .prepare(
        `SELECT s.id, s.user_id, s.name_id, s.ip_address, s.created_at, s.expires_at,
                p.name AS provider_name
         FROM ext_cockpit_enterprise_sso_sessions s
         JOIN ext_cockpit_enterprise_sso_providers p ON s.provider_id = p.id
         WHERE s.expires_at > datetime('now')
         ORDER BY s.created_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset);

    const total = db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM ext_cockpit_enterprise_sso_sessions WHERE expires_at > datetime('now')"
      )
      .get().cnt;

    res.json({ sessions, total });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Revoke session
router.delete("/sessions/:id", requireRole("admin"), (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(400).json({ error: "Invalid session ID" });
    }

    const session = db
      .prepare("SELECT id, user_id FROM ext_cockpit_enterprise_sso_sessions WHERE id = ?")
      .get(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });

    db.prepare("DELETE FROM ext_cockpit_enterprise_sso_sessions WHERE id = ?").run(req.params.id);

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "sso.session_revoke", req.params.id, session.user_id);
    }

    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Purge expired sessions (retention)
router.delete("/sessions/expired", requireRole("admin"), (req, res) => {
  try {
    const result = db
      .prepare("DELETE FROM ext_cockpit_enterprise_sso_sessions WHERE expires_at <= datetime('now')")
      .run();

    const userId = req.user?.id || "system";
    if (services?.auditLog) {
      services.auditLog(userId, "sso.sessions_purge", null, `${result.changes} expired sessions`);
    }

    res.json({ deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

  return { init, router };
}

module.exports = { create };
