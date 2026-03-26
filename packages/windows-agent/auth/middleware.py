import time
from functools import wraps
from flask import request, jsonify, g
from auth.jwt_auth import verify_access_token

# Rate limiting
_failed_attempts = {}  # ip -> {count, locked_until}
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 900  # 15 minutes


def is_rate_limited(ip):
    entry = _failed_attempts.get(ip)
    if not entry:
        return False
    if entry.get("locked_until") and time.time() < entry["locked_until"]:
        return True
    if entry.get("locked_until") and time.time() >= entry["locked_until"]:
        del _failed_attempts[ip]
        return False
    return False


def record_failed_attempt(ip):
    entry = _failed_attempts.get(ip, {"count": 0})
    entry["count"] += 1
    if entry["count"] >= MAX_ATTEMPTS:
        entry["locked_until"] = time.time() + LOCKOUT_SECONDS
    _failed_attempts[ip] = entry


def clear_failed_attempts(ip):
    _failed_attempts.pop(ip, None)


def rate_limit_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        ip = request.remote_addr
        if is_rate_limited(ip):
            return jsonify({"error": "Too many failed attempts. Try again in 15 minutes."}), 429
        g.auth_ip = ip
        return f(*args, **kwargs)
    return decorated


def require_auth(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401
        token = header[7:]
        try:
            payload = verify_access_token(token)
            g.user = {"id": payload["sub"], "role": payload["role"]}
        except Exception as e:
            if "expired" in str(e).lower():
                return jsonify({"error": "Token expired"}), 401
            return jsonify({"error": "Invalid token"}), 401
        return f(*args, **kwargs)
    return decorated


def require_role(*roles):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not hasattr(g, "user"):
                return jsonify({"error": "Not authenticated"}), 401
            if g.user["role"] not in roles:
                return jsonify({"error": "Insufficient permissions"}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator
