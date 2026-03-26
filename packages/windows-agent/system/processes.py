import os

try:
    import psutil
except ImportError:
    psutil = None

# PIDs that cannot be killed
PROTECTED_PIDS = {0, 4}


def list_processes(limit=50, sort_by="cpu"):
    if not psutil:
        return []

    procs = []
    for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_info", "status", "username"]):
        try:
            info = p.info
            procs.append({
                "pid": info["pid"],
                "name": info["name"],
                "cpuPercent": round(info["cpu_percent"] or 0, 1),
                "memoryMB": round((info["memory_info"].rss if info["memory_info"] else 0) / (1024 * 1024), 1),
                "status": info["status"],
                "user": info["username"] or "",
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    key = "cpuPercent" if sort_by == "cpu" else "memoryMB"
    procs.sort(key=lambda p: p[key], reverse=True)
    return procs[:limit]


def kill_process(pid):
    if not psutil:
        raise RuntimeError("psutil not installed")

    pid = int(pid)
    if pid in PROTECTED_PIDS:
        raise ValueError(f"Cannot kill protected PID {pid}")
    if pid == os.getpid():
        raise ValueError("Cannot kill the agent process")

    proc = psutil.Process(pid)
    proc.kill()
    return {"pid": pid, "name": proc.name()}
