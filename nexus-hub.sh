#!/bin/bash

# --- Aesthetic Header ---
clear
echo -e "\033[1;36m"
echo " ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗"
echo " ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝"
echo " ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗"
echo " ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║"
echo " ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║"
echo " ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝"
echo "           COMM-LINK TACTICAL HUB           "
echo -e "\033[0m"

# --- Configuration ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_CMD="python3"

if ! command -v python3 &> /dev/null; then
    PYTHON_CMD="python"
fi

# --- Menu ---
echo -e "\033[1;34m[1]\033[0m Launch & Link \033[1;32mAntigravity\033[0m (Premium)"
echo -e "\033[1;34m[2]\033[0m Start Bridge Only (\033[1;33mLocal WiFi\033[0m)"
echo -e "\033[1;34m[3]\033[0m Start Bridge Only (\033[1;35mGlobal Web\033[0m)"
echo -e "\033[1;34m[4]\033[0m Exit"
echo ""
read -p "Selection > " choice

case $choice in
    1) $PYTHON_CMD "$SCRIPT_DIR/launcher.py" --mode local --link antigravity ;;
    2) $PYTHON_CMD "$SCRIPT_DIR/launcher.py" --mode local ;;
    3) $PYTHON_CMD "$SCRIPT_DIR/launcher.py" --mode web ;;
    *) echo "Exiting..."; exit 0 ;;
esac
