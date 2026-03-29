const tls = require("tls");

/**
 * Check SSL certificate expiry for a domain.
 * Returns { domain, valid, daysRemaining, expiresAt, issuer, error }
 */
function checkSSL(domain, port = 443, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host: domain, port, servername: domain, rejectUnauthorized: false, timeout }, () => {
      try {
        const cert = socket.getPeerCertificate();
        socket.end();

        if (!cert || !cert.valid_to) {
          resolve({ domain, valid: false, error: "No certificate found" });
          return;
        }

        const expiresAt = new Date(cert.valid_to);
        const now = new Date();
        const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        resolve({
          domain,
          valid: daysRemaining > 0,
          daysRemaining,
          expiresAt: expiresAt.toISOString(),
          issuer: cert.issuer ? cert.issuer.O || cert.issuer.CN : "unknown",
          subject: cert.subject ? cert.subject.CN : domain,
        });
      } catch (err) {
        socket.end();
        resolve({ domain, valid: false, error: err.message });
      }
    });

    socket.on("error", (err) => {
      resolve({ domain, valid: false, error: err.message });
    });

    socket.on("timeout", () => {
      socket.destroy();
      resolve({ domain, valid: false, error: "Connection timed out" });
    });
  });
}

/** Check SSL for all configured domains */
async function checkAllSSL(domains) {
  if (!domains || domains.length === 0) return [];
  return Promise.all(domains.map((d) => checkSSL(d)));
}

module.exports = { checkSSL, checkAllSSL };
