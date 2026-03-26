"""
Lagoon Cockpit — Windows Agent
Standalone REST API for managing Windows Server infrastructure.
Compatible with the Lagoon Cockpit mobile app (multi-server profiles).
"""

import time
import threading
from flask import Flask, request, jsonify, Response, g
from config import SERVER_NAME, PORT

from auth.keys import authenticate_with_key
from auth.jwt_auth import (
    validate_refresh_token, sign_access_token,
    generate_refresh_token, cleanup_expired_tokens,
)
from auth.middleware import (
    require_auth, require_role, rate_limit_auth,
    record_failed_attempt, clear_failed_attempts,
)
from system.metrics import get_system_metrics
from system.services import (
    list_services, get_service, start_service, stop_service,
    restart_service, SERVICE_NAME_RE,
)
from system.processes import list_processes, kill_process
from system.eventlog import read_event_log
from mt5.proxy import get_health as mt5_health, get_account as mt5_account, get_positions as mt5_positions
from stream.sse import add_client, remove_client, broadcast, get_client_count, sse_stream

app = Flask(__name__)
app.config["JSON_SORT_KEYS"] = False


# ── Middleware ──────────────────────────────────────────────────────────────

@app.before_request
def log_request():
    if request.path != "/health":
        print(f"[REQ] {request.method} {request.path} from {request.remote_addr}")


@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    return response


@app.route("/health")
def health():
    return jsonify({"status": "ok", "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())})


# ── Auth ───────────────────────────────────────────────────────────────────

@app.route("/auth/token", methods=["POST"])
@rate_limit_auth
def auth_token():
    body = request.get_json(silent=True) or {}
    api_key = body.get("apiKey", "")
    if not api_key:
        return jsonify({"error": "apiKey is required"}), 400

    result = authenticate_with_key(api_key)
    if not result:
        record_failed_attempt(g.auth_ip)
        return jsonify({"error": "Invalid API key"}), 401

    clear_failed_attempts(g.auth_ip)
    result["serverName"] = SERVER_NAME
    return jsonify(result)


@app.route("/auth/refresh", methods=["POST"])
@rate_limit_auth
def auth_refresh():
    body = request.get_json(silent=True) or {}
    token = body.get("refreshToken", "")
    if not token:
        return jsonify({"error": "refreshToken is required"}), 400

    payload = validate_refresh_token(token)
    if not payload:
        return jsonify({"error": "Invalid or expired refresh token"}), 401

    new_access = sign_access_token({"sub": payload["user_id"], "role": payload["role"]})
    new_refresh = generate_refresh_token(payload["user_id"], payload["role"])
    return jsonify({"accessToken": new_access, "refreshToken": new_refresh})


# ── Overview ───────────────────────────────────────────────────────────────

@app.route("/api/overview")
@require_auth
def overview():
    metrics = get_system_metrics()
    services = list_services()
    running_svcs = [s for s in services if s["status"] == "running"]
    stopped_svcs = [s for s in services if s["status"] == "stopped"]

    # MT5 Bridge status
    mt5_data, mt5_status = mt5_health()
    mt5_ok = mt5_status == 200 and mt5_data.get("status") == "ok"

    return jsonify({
        "serverName": SERVER_NAME,
        "platform": "windows",
        "system": metrics,
        "services": {
            "total": len(services),
            "running": len(running_svcs),
            "stopped": len(stopped_svcs),
        },
        "mt5": {
            "status": "online" if mt5_ok else "offline",
            "balance": mt5_data.get("balance") if mt5_ok else None,
            "equity": mt5_data.get("equity") if mt5_ok else None,
        },
        # Compatibility with mobile app's OverviewData shape
        "containers": {"total": 0, "running": 0, "stopped": 0, "unhealthy": 0},
        "stacks": {"total": 0, "allHealthy": True},
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
    })


# ── System Metrics ─────────────────────────────────────────────────────────

@app.route("/api/system/metrics")
@require_auth
def system_metrics():
    return jsonify(get_system_metrics())


# ── Windows Services ───────────────────────────────────────────────────────

@app.route("/api/services")
@require_auth
def services_list():
    show = request.args.get("show", "all")  # all, running, stopped
    services = list_services()
    if show == "running":
        services = [s for s in services if s["status"] == "running"]
    elif show == "stopped":
        services = [s for s in services if s["status"] == "stopped"]
    return jsonify({"services": services})


@app.route("/api/services/<name>")
@require_auth
def service_detail(name):
    if not SERVICE_NAME_RE.match(name):
        return jsonify({"error": "Invalid service name"}), 400
    svc = get_service(name)
    if not svc:
        return jsonify({"error": "Service not found"}), 404
    return jsonify({"service": svc})


@app.route("/api/services/<name>/start", methods=["POST"])
@require_auth
@require_role("admin", "operator")
def service_start(name):
    if not SERVICE_NAME_RE.match(name):
        return jsonify({"error": "Invalid service name"}), 400
    try:
        start_service(name)
        return jsonify({"ok": True, "action": "start", "service": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/services/<name>/stop", methods=["POST"])
@require_auth
@require_role("admin")
def service_stop(name):
    if not SERVICE_NAME_RE.match(name):
        return jsonify({"error": "Invalid service name"}), 400
    try:
        stop_service(name)
        return jsonify({"ok": True, "action": "stop", "service": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@app.route("/api/services/<name>/restart", methods=["POST"])
@require_auth
@require_role("admin")
def service_restart(name):
    if not SERVICE_NAME_RE.match(name):
        return jsonify({"error": "Invalid service name"}), 400
    try:
        restart_service(name)
        return jsonify({"ok": True, "action": "restart", "service": name})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ── Processes ──────────────────────────────────────────────────────────────

@app.route("/api/processes")
@require_auth
def processes_list():
    limit = min(int(request.args.get("limit", "50")), 200)
    sort_by = request.args.get("sort", "cpu")
    return jsonify({"processes": list_processes(limit=limit, sort_by=sort_by)})


@app.route("/api/processes/<int:pid>/kill", methods=["POST"])
@require_auth
@require_role("admin")
def process_kill(pid):
    try:
        result = kill_process(pid)
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


# ── MT5 Bridge Proxy ──────────────────────────────────────────────────────

@app.route("/api/mt5/health")
@require_auth
def mt5_health_route():
    data, status = mt5_health()
    return jsonify(data), status


@app.route("/api/mt5/account")
@require_auth
def mt5_account_route():
    data, status = mt5_account()
    return jsonify(data), status


@app.route("/api/mt5/positions")
@require_auth
def mt5_positions_route():
    data, status = mt5_positions()
    return jsonify(data), status


# ── Event Log ──────────────────────────────────────────────────────────────

@app.route("/api/eventlog")
@require_auth
def event_log():
    source = request.args.get("source", "System")
    level = request.args.get("level", None)
    limit = min(int(request.args.get("limit", "50")), 200)
    if source not in ("System", "Application", "Security"):
        return jsonify({"error": "Invalid log source"}), 400
    entries = read_event_log(source=source, level=level, limit=limit)
    return jsonify({"entries": entries, "source": source})


# ── SSE Stream ─────────────────────────────────────────────────────────────

@app.route("/api/stream")
@require_auth
def sse():
    q = add_client()
    if not q:
        return jsonify({"error": "Too many SSE connections"}), 503
    return Response(sse_stream(q), content_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Compatibility stubs (mobile app may call Docker routes) ────────────────

@app.route("/api/containers")
@require_auth
def containers_stub():
    return jsonify({"containers": [], "note": "This is a Windows server — no Docker containers"})


@app.route("/api/stacks")
@require_auth
def stacks_stub():
    return jsonify({"stacks": [], "note": "This is a Windows server — no Docker stacks"})


@app.route("/api/ssl")
@require_auth
def ssl_stub():
    return jsonify({"certificates": []})


@app.route("/api/endpoints")
@require_auth
def endpoints_stub():
    return jsonify({"endpoints": []})


# ── Background: SSE broadcast loop ────────────────────────────────────────

def broadcast_loop():
    while True:
        try:
            if get_client_count() > 0:
                metrics = get_system_metrics()
                broadcast("metrics", metrics)
        except Exception as e:
            print(f"[SSE] Broadcast error: {e}")
        time.sleep(15)


def token_cleanup_loop():
    while True:
        cleanup_expired_tokens()
        time.sleep(3600)


# ── Startup ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"[COCKPIT] Lagoon Cockpit Windows Agent starting...")
    print(f"[COCKPIT] Server name: {SERVER_NAME}")
    print(f"[COCKPIT] Port: {PORT}")

    # Start background threads
    threading.Thread(target=broadcast_loop, daemon=True).start()
    threading.Thread(target=token_cleanup_loop, daemon=True).start()

    # Start Waitress (production WSGI server)
    try:
        from waitress import serve
        print(f"[COCKPIT] Running with Waitress on 0.0.0.0:{PORT}")
        serve(app, host="0.0.0.0", port=PORT, threads=4)
    except ImportError:
        print(f"[COCKPIT] Waitress not found, falling back to Flask dev server")
        app.run(host="0.0.0.0", port=PORT, debug=False)
