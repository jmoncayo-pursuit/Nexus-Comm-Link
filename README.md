# Nexus Comm-Link

[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](#license)

**Nexus Comm-Link** is a high-performance, bidirectional bridge designed for the **Gemini Multimodal Live API**. It creates a low-latency "neural link" between a desktop development environment and a mobile interface, enabling real-time workspace mobility, multimodal situational awareness, and agentic remote control via the **Chrome DevTools Protocol (CDP)**.

---

![Nexus Comm-Link Overview](./assets/nexus_hero_shot.png)

---

## Core Features

- **Real-Time Monitoring**: 1:1 visual mirroring of your development session.
- **Multimodal Live Integration**: Powered by the Gemini 2.0 Multimodal Live API for real-time voice and vision synthesis.
- **Action Relay (Tool Calling)**: Translates natural language intent into direct IDE actions (commits, undos, navigation) via CDP.
- **Context Coupling**: Streams high-fidelity DOM snapshots allowing the agent to "read" internal IDE reasoning and thought blocks.
- **Global Access**: Optional secure tunneling via ngrok for remote connectivity over mobile data.
- **Scroll Synchronization**: Syncs viewport positions between mobile and desktop.
- **HTTPS Support**: Encrypted connections via automated SSL generation.

---

## Technical Architecture

![Nexus Data Flow](./assets/nexus_data_flow_3d.jpg)

Nexus Comm-Link utilizes a tiered architecture to bridge physical and digital workspaces:

1. **The Bridge (Node.js)**: A local proxy that manages bidirectional WebSockets between the mobile client and the desktop environment.
2. **Context Intake (CDP)**: Leverages the Chrome DevTools Protocol to extract high-fidelity DOM snapshots and internal AI reasoning states (grounding).
3. **Multimodal Core (Gemini Live API)**: Process vision, audio, and text in a single low-latency stream, hosted on **Google Cloud** powered by Gemini 2.0.
4. **Action Relay**: Maps natural language commands to physical browser events using local tool calling.

---

## Installation & Setup

### 1. Enable Desktop Debugging
Start your environment with the remote debugging port enabled.

**macOS (Antigravity):**
```bash
/Applications/Antigravity.app/Contents/MacOS/Electron . --remote-debugging-port=9000
```
(Run from your project folder, or use `launch_nexus_debug.command` if you have one.)

**Context Menu (Linux):**
Run the installer script to add "Open with Nexus (Debug)" to your file manager's right-click menu:
- Windows: `install_context_menu.bat`
- Linux: `./install_context_menu.sh`

### 2. Start the Connector
The server requires an active session to mirror. Ensure a chat is open on your desktop before starting the connector.

**Local Access:**
```bash
chmod +x start_nexus_connect.sh
./start_nexus_connect.sh
```

**Remote Access (Web Mode):**
Requires an [ngrok Authtoken](https://ngrok.com).
```bash
cp .env.example .env
# Edit .env with your NGROK_AUTHTOKEN and APP_PASSWORD
./start_nexus_connect_web.sh
```

---

## Security & Access Control

Nexus Comm-Link provides tiered access security:
- **LAN Access**: Trusted by default for devices on the same Wi-Fi network.
- **Remote Access**: Protected by passcode authentication and signed session cookies.
- **Encryption**: TLS 1.2/1.3 supported via auto-generated self-signed certificates.

See [SECURITY.md](SECURITY.md) for detailed configuration and browser trust instructions.

---

## Reproducible Testing & Verification

To verify the integration and the **Gemini Multimodal Live** connection, follow these steps:

1. **Verify Binary Access**: Ensure `Antigravity` is installed and the CLI tools are available.
2. **Environment Check**: Run `./nexus-hub.sh` (or `nexus-hub.bat` on Windows) and select option `[1]`.
3. **CDP Linkage**: Once the IDE launches, watch the terminal logs for `[BRIDGE] CDP Connected to Antigravity`.
4. **Voice Activation**: Open the mobile interface using the QR code. Tap "Connect to Gemini". 
5. **Action Relay Test**: Speak clearly: *"Can you trigger an undo?"*. 
6. **Pass Criterion**: The IDE on your desktop should physically trigger the `Command+Z` (or `Ctrl+Z`) operation, confirmed by the terminal log `[NEXUS] Action Triggered: triggerUndo`.

---

## Documentation

- [Code Documentation](CODE_DOCUMENTATION.md) - Architecture and API overview.
- [Security Policy](SECURITY.md) - Vulnerability reporting and security model.
- [Design Philosophy](DESIGN_PHILOSOPHY.md) - Project rationale and design decisions.
- [Task Tracker](TASKS.md) - Development roadmap.

---

## License

This project is proprietary. Copyright (c) 2026 **Jean Moncayo**. All rights reserved. 
Source code is provided exclusively for evaluation by the Gemini Multimodal Live API Developer Challenge judges. Commercial use is prohibited. See the [LICENSE](LICENSE) file for full details.
