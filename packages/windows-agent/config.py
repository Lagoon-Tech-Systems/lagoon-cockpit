import os
import sys

# Read .env manually — python-dotenv fails under pythonservice.exe context.
_ENV_FILE = r"C:\lagoon\cockpit-agent\.env"
_env = {}
try:
    with open(_ENV_FILE, "r") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                _env[key.strip()] = val.strip()
except FileNotFoundError:
    pass

def _get(key, default=""):
    return _env.get(key) or os.getenv(key) or default

API_KEY = _get("API_KEY")
JWT_SECRET = _get("JWT_SECRET")
SERVER_NAME = _get("SERVER_NAME", "Windows Server")
PORT = int(_get("PORT", "3001"))
MT5_BRIDGE_URL = _get("MT5_BRIDGE_URL", "http://100.85.242.40:8787")
MT5_BRIDGE_API_KEY = _get("MT5_BRIDGE_API_KEY", "phantom-secret-key")

# Validate required config
if not API_KEY:
    print("[FATAL] API_KEY must be set in .env")
    sys.exit(1)
if not JWT_SECRET or JWT_SECRET == "change-me-in-production":
    print("[FATAL] JWT_SECRET must be set to a strong random value in .env")
    sys.exit(1)
