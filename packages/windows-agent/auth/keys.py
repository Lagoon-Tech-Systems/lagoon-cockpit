import hashlib
import hmac
from config import API_KEY
from auth.jwt_auth import sign_access_token, generate_refresh_token


def authenticate_with_key(provided_key):
    if not API_KEY:
        raise ValueError("API_KEY not configured")

    provided_hash = hashlib.sha256(provided_key.encode()).digest()
    expected_hash = hashlib.sha256(API_KEY.encode()).digest()

    if not hmac.compare_digest(provided_hash, expected_hash):
        return None

    user_id = "admin"
    role = "admin"
    access_token = sign_access_token({"sub": user_id, "role": role})
    refresh_token = generate_refresh_token(user_id, role)

    return {
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "userId": user_id,
        "role": role,
    }
