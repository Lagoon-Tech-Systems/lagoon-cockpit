import time

try:
    import win32evtlog
    import win32evtlogutil

    LEVEL_MAP = {
        win32evtlog.EVENTLOG_ERROR_TYPE: "error",
        win32evtlog.EVENTLOG_WARNING_TYPE: "warning",
        win32evtlog.EVENTLOG_INFORMATION_TYPE: "info",
        win32evtlog.EVENTLOG_AUDIT_SUCCESS: "audit_success",
        win32evtlog.EVENTLOG_AUDIT_FAILURE: "audit_failure",
    }

    def read_event_log(source="System", level=None, limit=50):
        entries = []
        handle = win32evtlog.OpenEventLog(None, source)
        try:
            flags = win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ
            total = 0
            while total < limit:
                events = win32evtlog.ReadEventLog(handle, flags, 0)
                if not events:
                    break
                for event in events:
                    if total >= limit:
                        break
                    evt_level = LEVEL_MAP.get(event.EventType, "unknown")
                    if level and evt_level != level:
                        continue
                    try:
                        msg = win32evtlogutil.SafeFormatMessage(event, source)
                    except Exception:
                        msg = str(event.StringInserts) if event.StringInserts else ""

                    entries.append({
                        "source": event.SourceName,
                        "level": evt_level,
                        "eventId": event.EventID & 0xFFFF,
                        "timestamp": event.TimeGenerated.isoformat() if event.TimeGenerated else "",
                        "message": msg[:500],
                    })
                    total += 1
        finally:
            win32evtlog.CloseEventLog(handle)
        return entries

except ImportError:
    def read_event_log(source="System", level=None, limit=50):
        return [{"source": "mock", "level": "info", "eventId": 0,
                 "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"), "message": "Event log not available on this platform"}]
