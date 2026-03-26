import platform
import time

try:
    import psutil
except ImportError:
    psutil = None


def get_system_metrics():
    if not psutil:
        return {"error": "psutil not installed"}

    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("C:\\")
    net = psutil.net_io_counters()
    boot = psutil.boot_time()
    uptime = int(time.time() - boot)

    # Windows doesn't have Unix load avg — use CPU queue length approximation
    cpu_percent = psutil.cpu_percent(interval=0.5)

    return {
        "hostname": platform.node(),
        "os": f"Windows Server {platform.version()}",
        "cpuPercent": round(cpu_percent, 2),
        "cpuCount": psutil.cpu_count(logical=True),
        "memory": {
            "total": mem.total,
            "used": mem.used,
            "free": mem.available,
            "percent": round(mem.percent, 2),
        },
        "disk": {
            "total": disk.total,
            "used": disk.used,
            "free": disk.free,
            "percent": round(disk.percent, 2),
            "mountpoint": "C:\\",
        },
        "network": {
            "bytesSent": net.bytes_sent,
            "bytesRecv": net.bytes_recv,
        },
        "load": {
            "load1": round(cpu_percent / 100 * psutil.cpu_count(), 2),
            "load5": 0,
            "load15": 0,
        },
        "uptimeSeconds": uptime,
    }
