import os
import sys
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("API_KEY")
JWT_SECRET = os.getenv("JWT_SECRET")
SERVER_NAME = os.getenv("SERVER_NAME", "Windows Server")
PORT = int(os.getenv("PORT", "3001"))
MT5_BRIDGE_URL = os.getenv("MT5_BRIDGE_URL", "http://localhost:8787")
MT5_BRIDGE_API_KEY = os.getenv("MT5_BRIDGE_API_KEY", "")

# Validate required config
if not API_KEY:
    print("[FATAL] API_KEY must be set in .env")
    sys.exit(1)
if not JWT_SECRET or JWT_SECRET == "change-me-in-production":
    print("[FATAL] JWT_SECRET must be set to a strong random value in .env")
    sys.exit(1)
