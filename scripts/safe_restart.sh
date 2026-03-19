#!/usr/bin/env bash
# Nexus Safe Restart
# Restarts only the Nexus Bridge components without killing the IDE/Agent process

echo "🛠️ Performing surgical restart of Nexus Bridge..."

# 1. Kill only the process on Port 3131
PORT_PID=$(lsof -t -i:3131)
if [ ! -z "$PORT_PID" ]; then
    echo "💀 Stopping Node on 3131 (PID $PORT_PID)..."
    kill -9 $PORT_PID
fi

# 2. Kill only the launcher.py (Python)
LAUNCHER_PID=$(ps aux | grep "launcher.py" | grep -v grep | awk '{print $2}')
if [ ! -z "$LAUNCHER_PID" ]; then
    echo "💀 Stopping Launcher (PID $LAUNCHER_PID)..."
    kill -9 $LAUNCHER_PID
fi

# 3. Kill all ngrok processes
echo "💀 Clearing ngrok tunnels..."
pkill -f ngrok

# 4. Restart in Web Mode
echo "🚀 Rebooting in Web Mode..."
nohup python3 launcher.py --mode web > launcher_web_fresh.log 2>&1 &

echo "✅ Restart complete. Use 'cat launcher_web_fresh.log' to check the tunnel URL."
