import re

# Protected services that cannot be stopped via the API
PROTECTED_SERVICES = {
    "sshd", "WinRM", "TermService", "Tailscale", "LagoonCockpitAgent",
    "EventLog", "RpcSs", "Winmgmt", "LSM", "SamSs",
}

SERVICE_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,127}$")

try:
    import win32serviceutil
    import win32service
    import pywintypes

    def list_services():
        services = []
        handle = win32service.OpenSCManager(None, None, win32service.SC_MANAGER_ENUMERATE_SERVICE)
        try:
            statuses = win32service.EnumServicesStatusEx(handle)
            for svc in statuses:
                state_map = {
                    1: "stopped", 2: "start_pending", 3: "stop_pending",
                    4: "running", 5: "continue_pending", 6: "pause_pending", 7: "paused",
                }
                start_map = {
                    0: "boot", 1: "system", 2: "automatic", 3: "manual", 4: "disabled",
                }
                services.append({
                    "name": svc["ServiceName"],
                    "displayName": svc["DisplayName"],
                    "status": state_map.get(svc["CurrentState"], "unknown"),
                    "pid": svc.get("ProcessId", 0),
                    "startType": start_map.get(svc.get("ServiceStartType", -1), "unknown"),
                    "protected": svc["ServiceName"] in PROTECTED_SERVICES,
                })
        finally:
            win32service.CloseServiceHandle(handle)
        return sorted(services, key=lambda s: s["displayName"].lower())

    def get_service(name):
        for svc in list_services():
            if svc["name"].lower() == name.lower():
                return svc
        return None

    def start_service(name):
        if name in PROTECTED_SERVICES:
            raise ValueError(f"Service '{name}' is already protected and running")
        win32serviceutil.StartService(name)

    def stop_service(name):
        if name in PROTECTED_SERVICES:
            raise ValueError(f"Cannot stop protected service '{name}'")
        win32serviceutil.StopService(name)

    def restart_service(name):
        if name in PROTECTED_SERVICES:
            raise ValueError(f"Cannot restart protected service '{name}'")
        win32serviceutil.RestartService(name)

except ImportError:
    # Fallback for non-Windows development
    def list_services():
        return [{"name": "mock", "displayName": "Mock Service", "status": "running",
                 "pid": 0, "startType": "automatic", "protected": False}]

    def get_service(name):
        return None

    def start_service(name):
        raise NotImplementedError("Windows services not available on this platform")

    def stop_service(name):
        raise NotImplementedError("Windows services not available on this platform")

    def restart_service(name):
        raise NotImplementedError("Windows services not available on this platform")
