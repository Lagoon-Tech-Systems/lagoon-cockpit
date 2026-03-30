/**
 * Sanitize error messages before displaying to users.
 * Strips stack traces, file paths, SQL fragments, and truncates long messages.
 */

const UNSAFE_PATTERNS = [
  /\/[a-z_]+\.[a-z]+:\d+/i,        // file paths like /app/server.js:42
  /at\s+\w+\s+\(/i,                 // stack trace lines
  /SELECT|INSERT|UPDATE|DELETE\s+FROM/i, // SQL fragments
  /ECONNREFUSED|ETIMEDOUT/i,        // raw Node errors
  /errno|syscall|code:/i,           // system error details
];

export function sanitizeErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const msg = err.message.split('\n')[0].trim();
  if (!msg) return fallback;
  if (UNSAFE_PATTERNS.some((p) => p.test(msg))) return fallback;
  return msg.length > 200 ? msg.slice(0, 200) + '\u2026' : msg;
}
