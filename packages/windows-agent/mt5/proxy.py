import logging

import requests
from config import MT5_BRIDGE_URL, MT5_BRIDGE_API_KEY

TIMEOUT = 5
log = logging.getLogger("cockpit.mt5")


def _bridge_get(path):
    url = f"{MT5_BRIDGE_URL}{path}"
    headers = {"X-API-Key": MT5_BRIDGE_API_KEY}
    try:
        resp = requests.get(url, headers=headers, timeout=TIMEOUT)
        return resp.json(), resp.status_code
    except requests.ConnectionError:
        return {"error": "MT5 Bridge unreachable"}, 503
    except requests.Timeout:
        return {"error": "MT5 Bridge timed out"}, 504
    except Exception:
        log.exception("[MT5] bridge call failed: %s", path)
        return {"error": "MT5 Bridge error"}, 500


def get_health():
    return _bridge_get("/health")


def get_account():
    return _bridge_get("/account")


def get_positions():
    return _bridge_get("/positions")


def get_symbols(filter_str=""):
    path = f"/symbols?filter={filter_str}" if filter_str else "/symbols"
    return _bridge_get(path)
