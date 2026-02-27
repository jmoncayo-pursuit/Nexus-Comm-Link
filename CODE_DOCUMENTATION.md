# CODE DOCUMENTATION - Nexus Comm-Link

## Project Structure
```text
nexus_comm_link/
├── server.js                       # Main Node.js server (Express + WebSocket + CDP + HTTPS)
├── generate_ssl.js                 # SSL certificate generator (pure Node.js, no OpenSSL needed)
├── ui_inspector.js                 # Utility for inspecting Nexus UI via CDP
├── public/
│   ├── index.html                  # Mobile-optimized web frontend
│   ├── css/
│   │   └── style.css               # Main stylesheet (App aesthetics & layout)
│   └── js/
│       └── app.js                  # Client-side logic (WebSocket, API calls, UI interactions)
├── certs/                          # SSL certificates directory (auto-generated, gitignored)
│   ├── server.key                  # Private key
│   └── server.cert                 # Self-signed certificate
├── start_nexus_connect.sh       # Standard Mac/Linux launcher (LAN)
├── start_nexus_connect_web.sh   # Web Mac/Linux launcher (Starts server + Global Tunnel)
├── install_context_menu.sh         # Linux Context Menu installer
├── launcher.py                     # Unified Python launcher (Manages Server, Tunnel, QR Codes)
├── .env                            # Local configuration (Passwords & API Tokens - gitignored)
├── .env.example                    # Template for environment variables
├── package.json                    # Dependencies and metadata
├── LICENSE                         # MIT License
└── README.md                       # Quick-start guide
```

## High-Level Architecture
The system acts as a "Headless Mirror" of the development session running on a Desktop machine. It utilizes the **Chrome DevTools Protocol (CDP)** to bridge the gap between a local session and a remote mobile browser.

### Data Flow
```mermaid
graph TD
    IDE[Antigravity Session] -- CDP Snapshots --> S[Node.js Server]
    S -- WebSocket Status --> P[Mobile Frontend]
    P -- GET /snapshot --> S
    P -- POST /login --> S
    S -- Cookie Auth --> P
    T[ngrok Tunnel] -- Proxy --> S
    P[Mobile Frontend] -- Mobile Data --> T
    S -- CDP Commands --> IDE
    PY[launcher.py Manager] -- Spawns/Kills --> S
    PY -- Monitors --> T
```

## Core Modules & Methods (server.js)

| Module/Function | Description |
| :--- | :--- |
| `killPortProcess()` | Automatically kills any existing process on the server port (prevents EADDRINUSE errors). Works on Windows/Linux/macOS. |
| `getLocalIP()` | Detects local network IP address for mobile access display. |
| `discoverCDP()` | Scans ports (9000-9003) to find the Antigravity instance. |
| `connectCDP()` | Establishes CDP WebSocket with centralized message handling (prevents memory leaks). Uses `pendingCalls` Map with 30s timeout. |
| `captureSnapshot()` | Injects JS into Nexus to clone the chat DOM, extract CSS, and return it. |
| `loadSnapshot()` (Client) | Renders the HTML snapshot and injects CSS overrides for dark mode. |
| `injectMessage()` | Locates the Antigravity input field and simulates typing/submission. Uses `JSON.stringify` for safe escaping. |
| `setMode()` / `setModel()` | Robust text-based selectors to change AI settings remotely. |
| `clickElement()` | Relays a physical click from the phone to a specific element index on Desktop. |
| `clickActionButton()` | Robust action relay for Apply/Accept/Reject buttons. Uses 4-tier matching: exact text → starts-with → contains → aria-label. |
| `remoteScroll()` | Syncs phone scroll position to Desktop Antigravity chat. |
| `getAppState()` | Syncs Mode/Model status and detects history visibility. |
| `startNewChat()` | Triggers the "New Chat" action on Desktop. |
| `getChatHistory()` | Scrapes the Nexus history panel for active/past conversations. |
| `selectChat()` | Switches the desktop session to a specific conversation title. |
| `hasChatOpen()` | Verifies if the editor and chat container are currently rendered. |
| `gracefulShutdown()` | Handles SIGINT/SIGTERM for clean server shutdown. |
| `createServer()` | Creates Express app with automatic HTTP/HTTPS detection and Auth middleware. |

## API Endpoints

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/login` | POST | Authenticates user and sets session cookie. |
| `/logout` | POST | Clears session cookie. |
| `/health` | GET | Returns server status, CDP connection state, and uptime. |
| `/snapshot` | GET | Returns latest captured HTML/CSS snapshot. |
| `/app-state` | GET | Returns current Mode (Fast/Planning) and Model. |
| `/ssl-status` | GET | Returns HTTPS status and certificate info. |
| `/send` | POST | Sends a message to the Antigravity chat. Always returns 200 (optimistic). |
| `/stop` | POST | Stops the current AI generation. |
| `/set-mode` | POST | Changes mode to Fast or Planning. |
| `/set-model` | POST | Changes the AI model. |
| `/new-chat` | POST | Starts a new chat session. |
| `/chat-history`| GET | Returns list of recently captured conversation titles. |
| `/select-chat` | POST | Switches the desktop session to a selected conversation. |
| `/chat-status` | GET | Returns status of the chat container and editor. |
| `/remote-click` | POST | Triggers a click event on Desktop (for Thought expansion). |
| `/relay-action` | POST | Relays Apply/Accept/Reject button clicks from mobile to Desktop via robust text matching. |
| `/remote-scroll` | POST | Syncs phone scroll position to Desktop Nexus. |
| `/generate-ssl` | POST | Generates SSL certificates (for HTTPS setup via UI). |
| `/debug-ui` | GET | Returns serialized UI tree for debugging. |
| `/ui-inspect` | GET | Returns detailed button and icon metadata for development. |
| `/cdp-targets` | GET | Lists available CDP discovery targets for troubleshooting. |

## Security & Authentication

### 1. Global Web Access (Tunneling)
When using the `_web` launcher, the system utilizes `ngrok` to create a secure tunnel. 
- **Unified Manager**: `launcher.py` acts as a supervisor, spawning the Node.js server as a child process. This ensures that when the tunnel is closed (Ctrl+C), the server is also reliably terminated.
- **Magic Links**: In Web Mode, the launcher generates a "Magic QR Code" that includes the `?key=PASSWORD` parameter, allowing for instant, zero-typing auto-login on mobile.
- **Auto-Protocol Detection**: `launcher.py` detects if the local server is running HTTPS and configures the tunnel accordingly.
- **Passcode Generation**: If no `APP_PASSWORD` is set in `.env`, a temporary 6-digit numeric passcode is generated for the session.
- **Setup Assistant**: Launchers check for `.env`; if missing, they automatically create it using `.env.example` as a template and instruct the user to update it.

### 2. Password Protection
- **Session Management**: Uses signed, `httpOnly` cookies for maximum browser security.
- **Conditional Auth**: Requests from local network IPs (LAN) are automatically exempted from password checks for convenience.
- **WebSocket Auth**: Secure WebSockets verify credentials during the handshake.

### Setup (First Time)
1. **Get an ngrok Token**: Sign up for free at [ngrok.com](https://ngrok.com) and get your "Authtoken".
2. **Automatic Configuration**: Simply run any launcher script. They will detect if `.env` is missing and create it from `.env.example`.
3. **Manual Setup**: Alternatively, create a `.env` file manually or copy the example:
   ```bash
   cp .env.example .env
   ```
   Then update `NGROK_AUTHTOKEN`, `APP_PASSWORD`, and any AI provider keys (e.g., `GROQ_API_KEY`).

### 3. HTTPS/SSL Support
The server automatically detects SSL certificates and enables HTTPS:

1. **Certificate Generation**: Run `node generate_ssl.js`
   - **Hybrid approach**: Tries OpenSSL first (better SAN support), falls back to Node.js crypto
   - Automatically detects local IP addresses for certificate SANs
2. **Auto-Detection**: Server checks for `certs/server.key` and `certs/server.cert`
3. **Protocol Selection**: Uses HTTPS if certs exist, HTTP otherwise
4. **WebSocket**: Automatically uses `wss://` for secure WebSocket when HTTPS is enabled
5. **Web UI**: Users can generate certificates via the "Enable HTTPS" button when running HTTP

## Dependencies

- **Express**: HTTP/HTTPS server for UI and API endpoints.
- **ws**: WebSocket implementation for real-time update notifications.
- **os**: Node.js built-in for local IP detection.
- **fs**: Node.js built-in for SSL certificate file reading.
- **https**: Node.js built-in for secure server (when SSL enabled).
- **Chrome DevTools Protocol (CDP)**: The underlying bridge to Nexus's browser-based UI.

## Execution Flow

> ⚠️ **The order of these steps matters!** Always start Antigravity with an active chat BEFORE running the server.

### Required Startup Sequence:

1. **Start Nexus in Debug Mode**
   - Launch Antigravity with: `antigravity . --remote-debugging-port=9000`
   - Or use the context menu: Right-click folder → "Open with Nexus (Debug)"

2. **Open or Start a Chat**
   - Open an existing chat from the bottom-right panel, OR
   - Start a new chat by typing a message
      - ⚠️ The server requires an active chat (the `#conversation` or `#cascade` element) to capture snapshots

3. **Run the Server** (`start_nexus_connect.sh`)
   - **Port Cleanup**: Server automatically kills any existing process on port 3000
   - **CDP Discovery**: Scans ports 9000-9003 to find the running Antigravity instance
   - **SSL Check**: Checks for certificates in `./certs/` and enables HTTPS if found
   - **Polling Starts**: Once connected, polls the UI every 1 second for changes

4. **Connect Your Phone**
   - Open the URL shown in terminal (e.g., `https://192.168.1.5:3000`)
   - Accept SSL certificate warning on first visit
   - Phone receives snapshots via WebSocket notifications

### Runtime Behavior:

- **Snapshot Updates**: If content hash changes, clients are notified via WebSocket
- **Rendering**: Mobile client fetches latest HTML/CSS and renders in a sandboxed div
- **History Management**: 
    - A dedicated **History Icon** in the mobile header allows toggling a full-screen drawer.
    - The drawer displays recently opened chats captured from the desktop's history panel.
    - Tapping a history item triggers a remote click on the desktop to switch conversations.
- **Scroll Sync**: Phone scroll position syncs to Desktop with user scroll lock protection
- **Shutdown**: On SIGINT/SIGTERM, server gracefully closes all connections before exit

## Security Considerations

- **Self-Signed Certificates**: The generated certificates are self-signed; browsers will show a warning on the first visit.
- **Selective Access**: LAN devices have automatic access. External tunnel connections (Web Mode) require a passcode or Magic Link.
- **Session Security**: Uses signed, `httpOnly` cookies for authentication.
- **Input Sanitization**: User input is escaped using `JSON.stringify` before CDP injection.

> 📚 For detailed security information, browser warning bypass instructions, and recommendations, see [SECURITY.md](SECURITY.md).

## Technical Implementation Details (Advanced)

### Synchronization Philosophy: "Mobile-as-Primary"
The system utilizes a unidirectional Primary-Follower architecture for state management when active:
1.  **Interaction Priority**: The mobile device is treated as the **Primary Controller**. Any manual interaction (scrolling, clicking, typing) on the mobile triggers an immediate CDP command to the Desktop.
2.  **Scroll Synchronization**: Synchronization is strictly **Mobile → Desktop**. This design choice prevents "sync-fighting" conflicts and allows the mobile user to maintain a stable viewport regardless of background window movement on the Desktop.
3.  **Operational Balance**:
    *   **Lock Duration**: A `10000ms` lock is applied when the user touches the mobile screen, protecting the mobile viewport from auto-scroll triggers caused by incoming message events.
    *   **Idle State**: After `5000ms` of inactivity, the mobile enters an "Observation Mode" where it allows auto-scrolling to follow new incoming content.

### Performance & Processing Efficiency
1.  **Snapshot Polling**: The server polls the session CDP endpoint every `1000ms` to check for UI changes.
2.  **Delta Detection**: To minimize processing pressure, the system calculates a 36-char hash of the captured HTML. A full broadcast (Snapshot Update) ONLY occurs if the hash changes.
3.  **Interaction Overhead**: Typical POST interactions (sending a message or changing a setting) have a latency overhead of `<100ms`, making the remote interaction feel near-instant.

### Snapshot Cleanup & Interaction Filtering
To ensure a clean "Observation Mode" on mobile, the server performs an aggressive cleanup of the captured DOM before sending it to the client:
1.  **Interaction Area Removal**: The entire bottom interaction wrapper (input box, send buttons, setting selection) is identified and removed.
2.  **Context Bar Hiding**: "Review Changes" and "Files With Changes" bars are automatically stripped using structural and keyword-based filtering.
3.  **Visual Overrides**: Custom CSS injections ensure that Desktop-specific UI elements (like scrollbars or specific borders) are masked. Specifically, a precise **glassmorphism styling** and modern dark-mode tracking are applied to the mobile quick-action and settings headers for enhanced readability and aesthetics.
4.  **State Tracking**: Advanced DOM scraping dynamically tracks active states from Desktop, mirroring them seamlessly onto the mobile interface.
5.  **Error-Safe Cleanup**: The filtering logic uses `try-catch` blocks and safe `classList` checks to prevent CDP execution errors when encountering legacy or non-standard SVG elements.
