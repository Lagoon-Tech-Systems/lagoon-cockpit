import requests
from config import MT5_BRIDGE_URL, MT5_BRIDGE_API_KEY

TIMEOUT = 5


def _bridge_get(path):
    sep = "&" if "?" in path else "?"
    url = f"{MT5_BRIDGE_URL}{path}{sep}api_key={MT5_BRIDGE_API_KEY}"
    try:
        resp = requests.get(url, timeout=TIMEOUT)
        return resp.json(), resp.status_code
    except requests.ConnectionError:
        return {"error": "MT5 Bridge unreachable", "bridge_url": MT5_BRIDGE_URL}, 503
    except requests.Timeout:
        return {"error": "MT5 Bridge timed out"}, 504
    except Exception as e:
        return {"error": str(e)}, 500


def get_health():
    return _bridge_get("/health")


def get_account():
    return _bridge_get("/account")


def get_positions():
    return _bridge_get("/positions")


def get_symbols(filter_str=""):
    path = f"/symbols?filter={filter_str}" if filter_str else "/symbols"
    return _bridge_get(path)
