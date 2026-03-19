#!/bin/bash
# NEXUS EMERGENCY FIX (STUCK?)
# Clears ports and restarts only the bridge without killing the IDE/Assistant.

BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BRIDGE_DIR"

echo "============================================"
echo "🛡️  NEXUS EMERGENCY REPAIR"
echo "============================================"

# Call our surgical repair script
./scripts/safe_restart.sh

echo ""
echo "⌛ Looking for the new URL..."
sleep 5
tail -n 25 launcher_web_fresh.log

echo ""
echo "✅ Everything recovered! You can close this window."
read -p "Press Enter to exit..."
