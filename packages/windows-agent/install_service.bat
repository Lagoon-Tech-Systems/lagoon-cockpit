@echo off
echo === Lagoon Cockpit Windows Agent Installer ===
echo.

cd /d "%~dp0"

echo Installing Python dependencies...
pip install -r requirements.txt
echo.

echo Installing Windows Service...
python service_wrapper.py install
echo.

echo Starting service...
net start LagoonCockpitAgent
echo.

echo === Done ===
echo The Lagoon Cockpit Agent is now running as a Windows Service on port 3001.
echo.
echo To check status: sc query LagoonCockpitAgent
echo To stop:         net stop LagoonCockpitAgent
echo To uninstall:    python service_wrapper.py remove
echo.
pause
