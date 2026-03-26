import jwt
import secrets
import hashlib
import time
from config import JWT_SECRET

ACCESS_TTL = 900  # 15 minutes
REFRESH_TTL = 7 * 24 * 3600  # 7 days

# In-memory refresh token store: hash -> {user_id, role, expires_at}
_refresh_tokens = {}


def sign_access_token(payload):
    data = {**payload, "iat": int(time.time()), "exp": int(time.time()) + ACCESS_TTL}
    return jwt.encode(data, JWT_SECRET, algorithm="HS256")


def verify_access_token(token):
    return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])


def generate_refresh_token(user_id, role):
    token = secrets.token_hex(48)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    _refresh_tokens[token_hash] = {
        "user_id": user_id,
        "role": role,
        "expires_at": time.time() + REFRESH_TTL,
    }
    return token


def validate_refresh_token(token):
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    entry = _refresh_tokens.get(token_hash)
    if not entry:
        return None
    if time.time() > entry["expires_at"]:
        del _refresh_tokens[token_hash]
        return None
    # Rotate: delete old token
    del _refresh_tokens[token_hash]
    return {"user_id": entry["user_id"], "role": entry["role"]}


def cleanup_expired_tokens():
    now = time.time()
    expired = [h for h, e in _refresh_tokens.items() if now > e["expires_at"]]
    for h in expired:
        del _refresh_tokens[h]
