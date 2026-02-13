#!/usr/bin/env bash
# External Health Verification
set -euo pipefail

URL="${1:-https://funduri-ue.example.ro}"

echo "=== Health Check: $URL ==="

# App health
echo -n "App health: "
curl -sf "$URL/api/health" | jq -r '.status' 2>/dev/null || echo "UNREACHABLE"

# Response time
echo -n "Homepage response: "
curl -sf -o /dev/null -w "%{time_total}s\n" "$URL/"

# SSL check
echo -n "SSL valid: "
echo | openssl s_client -connect "$(echo "$URL" | sed 's|https://||'):443" -servername "$(echo "$URL" | sed 's|https://||')" 2>/dev/null | openssl x509 -noout -dates 2>/dev/null | grep notAfter || echo "N/A"

echo "Done."
