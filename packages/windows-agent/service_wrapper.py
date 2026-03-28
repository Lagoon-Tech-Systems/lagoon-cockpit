"""
Windows Service wrapper for the Lagoon Cockpit Agent.

Install:   python service_wrapper.py install
Start:     python service_wrapper.py start
Stop:      python service_wrapper.py stop
Remove:    python service_wrapper.py remove
"""

import os
import sys
import time

try:
    import win32serviceutil
    import win32service
    import win32event
    import servicemanager

    class CockpitAgentService(win32serviceutil.ServiceFramework):
        _svc_name_ = "LagoonCockpitAgent"
        _svc_display_name_ = "Lagoon Cockpit Agent"
        _svc_description_ = "Lagoon Cockpit Windows monitoring agent — REST API for system metrics, services, and processes"

        def __init__(self, args):
            win32serviceutil.ServiceFramework.__init__(self, args)
            self.stop_event = win32event.CreateEvent(None, 0, 0, None)
            self.running = False

        def SvcStop(self):
            self.ReportServiceStatus(win32service.SERVICE_STOP_PENDING)
            win32event.SetEvent(self.stop_event)
            self.running = False

        def SvcDoRun(self):
            servicemanager.LogMsg(
                servicemanager.EVENTLOG_INFORMATION_TYPE,
                servicemanager.PYS_SERVICE_STARTED,
                (self._svc_name_, ""),
            )
            self.running = True
            self.main()

        def main(self):
            # Change to the agent directory
            # NOTE: __file__ may resolve to pythonservice.exe's directory
            # when running as a Windows Service, so we use the known install path.
            agent_dir = r"C:\lagoon\cockpit-agent"
            os.chdir(agent_dir)
            sys.path.insert(0, agent_dir)

            # Load .env BEFORE any imports that depend on config
            from dotenv import load_dotenv
            load_dotenv(os.path.join(agent_dir, ".env"), override=True)

            # Import and start the agent
            import threading
            from agent import app, broadcast_loop, token_cleanup_loop
            from config import PORT

            # Start background threads
            threading.Thread(target=broadcast_loop, daemon=True).start()
            threading.Thread(target=token_cleanup_loop, daemon=True).start()

            # Start Waitress in a thread
            from waitress import serve

            server_thread = threading.Thread(
                target=serve, args=(app,),
                kwargs={"host": "0.0.0.0", "port": PORT, "threads": 4},
                daemon=True,
            )
            server_thread.start()

            # Wait for stop signal
            while self.running:
                rc = win32event.WaitForSingleObject(self.stop_event, 5000)
                if rc == win32event.WAIT_OBJECT_0:
                    break

    if __name__ == "__main__":
        if len(sys.argv) == 1:
            servicemanager.Initialize()
            servicemanager.PrepareToHostSingle(CockpitAgentService)
            servicemanager.StartServiceCtrlDispatcher()
        else:
            win32serviceutil.HandleCommandLine(CockpitAgentService)

except ImportError:
    print("pywin32 is required. Install with: pip install pywin32")
    print("This script only works on Windows.")
    sys.exit(1)
