#!/bin/bash
# NEXUS COMM-LINK INITIALIZER

echo "==================================================="
echo "  NEXUS COMM-LINK // MOBILE BRIDGE"
echo "==================================================="

# 1. SETUP: Identify context 
BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BRIDGE_DIR"

# 3. ANTIGRAVITY: Ensure IDE is in Debug Mode
# We force-kill existing Antigravity instances to ensure the NEW one starts with the --remote-debugging-port flag
echo "🚀 Force-restarting Antigravity in Debug Mode (Port 9222)..."
pkill -i -f "Antigravity" 2>/dev/null || true
pkill -i -f "Electron" 2>/dev/null || true
sleep 1

# Launching on 9222 to avoid conflict with other internal components on 9000
DEBUG_PORT=9222

/Applications/Antigravity.app/Contents/MacOS/Electron "$BRIDGE_DIR" --remote-debugging-port=$DEBUG_PORT > /dev/null 2>&1 &
sleep 5

if lsof -i :$DEBUG_PORT > /dev/null; then
    echo "✅ Antigravity is now running in Debug Mode on Port $DEBUG_PORT."
else
    echo "❌ Error: Failed to start Antigravity in Debug Mode."
    echo "   Check if /Applications/Antigravity.app exists."
fi

# 4. NEXUS COMM-LINK: Start Mobile Bridge
echo "🎙️  Starting Nexus Comm-Link..."
# Default to web mode unless specifically overridden (most common for this user)
export NEXUS_MODE=${1:-web}
./venv/bin/python3 launcher.py --mode $NEXUS_MODE

exit 0
