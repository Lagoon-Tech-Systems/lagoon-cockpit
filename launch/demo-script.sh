#!/bin/bash
# Lagoon Cockpit — Live API Demo
# This script demonstrates the cockpit-api running against a real Docker environment

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

pause() { sleep 1.5; }
type_slow() { echo -e "${CYAN}$ $1${NC}"; sleep 0.5; eval "$1"; }

clear
echo -e "${BOLD}${GREEN}"
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║         LAGOON COCKPIT — Live Demo            ║"
echo "  ║   Mobile DevOps Dashboard for Docker          ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo -e "${NC}"
pause

# Get API address
COCKPIT_IP=$(docker inspect lagoon_cockpit_api --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
API="http://$COCKPIT_IP:3000"

echo -e "${YELLOW}▸ Step 1: Health Check${NC}"
pause
type_slow "curl -s $API/health | python3 -m json.tool"
echo
pause

echo -e "${YELLOW}▸ Step 2: Authenticate with API Key${NC}"
pause
TOKEN=$(curl -s -X POST $API/auth/token -H 'Content-Type: application/json' -d '{"apiKey":"lagoon-cockpit-dev-key-2026"}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['accessToken'])")
echo -e "${CYAN}$ curl -s -X POST $API/auth/token -d '{\"apiKey\":\"***\"}'${NC}"
echo -e "${GREEN}✓ JWT token acquired (15-minute expiry)${NC}"
echo
pause

echo -e "${YELLOW}▸ Step 3: System Overview${NC}"
pause
echo -e "${CYAN}$ curl -s $API/api/overview${NC}"
curl -s $API/api/overview -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
s = d['system']
c = d['containers']
print(f'  Server:     {d[\"serverName\"]}')
print(f'  Hostname:   {s[\"hostname\"]}')
print(f'  CPU:        {s[\"cpuPercent\"]}% ({s[\"cpuCount\"]} cores)')
print(f'  Memory:     {s[\"memory\"][\"percent\"]}% ({s[\"memory\"][\"used\"]//1024//1024}MB / {s[\"memory\"][\"total\"]//1024//1024}MB)')
print(f'  Disk:       {s[\"disk\"][\"percent\"]}% ({s[\"disk\"][\"used\"]//1024//1024//1024}GB / {s[\"disk\"][\"total\"]//1024//1024//1024}GB)')
print(f'  Uptime:     {s[\"uptimeSeconds\"]//86400}d {(s[\"uptimeSeconds\"]%86400)//3600}h')
print(f'  Containers: {c[\"total\"]} total ({c[\"running\"]} running, {c[\"stopped\"]} stopped)')
print(f'  Stacks:     {d[\"stacks\"][\"total\"]} compose projects')
"
echo
pause

echo -e "${YELLOW}▸ Step 4: All Containers${NC}"
pause
echo -e "${CYAN}$ curl -s $API/api/containers${NC}"
curl -s $API/api/containers -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'  {\"NAME\":<42s} {\"STATE\":<12s} {\"STACK\":<20s}')
print(f'  {\"─\"*42} {\"─\"*12} {\"─\"*20}')
for c in d['containers']:
    stack = c.get('composeProject') or '(standalone)'
    icon = '🟢' if c['state'] == 'running' else '🔴'
    print(f'  {icon} {c[\"name\"]:<40s} {c[\"state\"]:<12s} {stack:<20s}')
"
echo
pause

echo -e "${YELLOW}▸ Step 5: Docker Compose Stacks${NC}"
pause
echo -e "${CYAN}$ curl -s $API/api/stacks${NC}"
curl -s $API/api/stacks -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for s in d['stacks']:
    icon = '🟢' if s['status'] == 'running' else '🟡'
    print(f'  {icon} {s[\"name\"]:<25s} {s[\"containerCount\"]} containers ({s[\"running\"]} up)')
"
echo
pause

echo -e "${YELLOW}▸ Step 6: SSL Certificate Status${NC}"
pause
echo -e "${CYAN}$ curl -s $API/api/ssl${NC}"
curl -s $API/api/ssl -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for c in d['certificates']:
    days = c.get('daysRemaining', 0)
    icon = '🟢' if days > 14 else '🟡' if days > 7 else '🔴'
    print(f'  {icon} {c[\"domain\"]:<35s} {days}d remaining  (issuer: {c.get(\"issuer\",\"?\")})')
"
echo
pause

echo -e "${YELLOW}▸ Step 7: HTTP Endpoint Probes${NC}"
pause
echo -e "${CYAN}$ curl -s $API/api/endpoints${NC}"
curl -s $API/api/endpoints -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for e in d['endpoints']:
    icon = '🟢' if e['healthy'] else '🔴'
    print(f'  {icon} {e[\"name\"]:<15s} HTTP {e[\"status\"]}  {e[\"responseTime\"]}ms  {e[\"url\"]}')
"
echo
pause

echo -e "${BOLD}${GREEN}"
echo "  ╔═══════════════════════════════════════════════╗"
echo "  ║  All data served from a single 22MB container ║"
echo "  ║  github.com/Lagoon-Tech-Systems/lagoon-cockpit ║"
echo "  ╚═══════════════════════════════════════════════╝"
echo -e "${NC}"
