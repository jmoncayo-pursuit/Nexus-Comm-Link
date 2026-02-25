// --- Elements ---
const chatContainer = document.getElementById('chatContainer');
const chatContent = document.getElementById('chatContent');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const scrollToBottomBtn = document.getElementById('scrollToBottom');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

const newChatBtn = document.getElementById('newChatBtn');
const historyBtn = document.getElementById('historyBtn');

let lastCssText = '';
let lastHtmlHash = '';
let isSending = false;

const modeBtn = document.getElementById('modeBtn');
const modelBtn = document.getElementById('modelBtn');
const bootServerBtn = document.getElementById('bootServerBtn');
const modalOverlay = document.getElementById('modalOverlay');
const modalList = document.getElementById('modalList');
const modalTitle = document.getElementById('modalTitle');
const modeText = document.getElementById('modeText');
const modelText = document.getElementById('modelText');
const historyLayer = document.getElementById('historyLayer');
const historyList = document.getElementById('historyList');
const attachmentIndicator = document.getElementById('attachmentIndicator');

// --- State ---
let isFirstLoad = true;
let autoRefreshEnabled = true;
let userIsScrolling = false;
let userScrollLockUntil = 0; // Timestamp until which we respect user scroll
let pendingSnapshotData = null; // Buffer for deferred updates while user reads
let lastScrollPosition = 0;
let ws = null;
let idleTimer = null;
let lastHash = '';
let currentMode = 'Fast';
let chatIsOpen = true; // Track if a chat is currently open


// --- Auth Utilities ---
async function fetchWithAuth(url, options = {}) {
    // Add ngrok skip warning header to all requests
    if (!options.headers) options.headers = {};
    options.headers['ngrok-skip-browser-warning'] = 'true';

    try {
        const res = await fetch(url, options);
        if (res.status === 401) {
            console.log('[AUTH] Unauthorized, redirecting to login...');
            window.location.href = '/login.html';
            return new Promise(() => { }); // Halt execution
        }
        return res;
    } catch (e) {
        throw e;
    }
}
const USER_SCROLL_LOCK_DURATION = 10000; // 10 seconds of scroll protection

// --- Sync State (Desktop is Always Priority) ---
async function fetchAppState() {
    try {
        const res = await fetchWithAuth('/app-state');
        const data = await res.json();

        // Mode Sync (Fast/Planning) - Desktop is source of truth
        if (data.mode && data.mode !== 'Unknown') {
            modeText.textContent = data.mode;
            modeBtn.classList.toggle('active', data.mode === 'Planning');
            currentMode = data.mode;
        }

        // Model Sync - Desktop is source of truth
        if (data.model && data.model !== 'Unknown') {
            modelText.textContent = data.model;
        }

        console.log('[SYNC] State refreshed from Desktop:', data);
    } catch (e) { console.error('[SYNC] Failed to sync state', e); }
}

// --- SSL Banner ---
const sslBanner = document.getElementById('sslBanner');

async function checkSslStatus() {
    // Only show banner if currently on HTTP
    if (window.location.protocol === 'https:') return;

    // Check if user dismissed the banner before
    if (localStorage.getItem('sslBannerDismissed')) return;

    sslBanner.style.display = 'flex';
}

async function enableHttps() {
    const btn = document.getElementById('enableHttpsBtn');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
        const res = await fetchWithAuth('/generate-ssl', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            sslBanner.innerHTML = `
                <span>✅ ${data.message}</span>
                <button onclick="location.reload()">Reload After Restart</button>
            `;
            sslBanner.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
        } else {
            btn.textContent = 'Failed - Retry';
            btn.disabled = false;
        }
    } catch (e) {
        btn.textContent = 'Error - Retry';
        btn.disabled = false;
    }
}

function dismissSslBanner() {
    sslBanner.style.display = 'none';
    localStorage.setItem('sslBannerDismissed', 'true');
}

// Check SSL on load
checkSslStatus();
// --- Models ---
const MODELS = [
    "Gemini 3.1 Pro (High)",
    "Gemini 3.1 Pro (Low)",
    "Gemini 3 Flash",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)"
];

// --- WebSocket ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('WS Connected');
        updateStatus(true);
        loadSnapshot();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'error' && data.message === 'Unauthorized') {
            window.location.href = '/login.html';
            return;
        }
        if (data.type === 'snapshot_update' && autoRefreshEnabled) {
            loadSnapshot();
        }
    };

    ws.onclose = () => {
        console.log('WS Disconnected');
        updateStatus(false);
        setTimeout(connectWebSocket, 2000);
    };
}

function updateStatus(connected) {
    if (connected) {
        statusDot.classList.remove('disconnected');
        statusDot.classList.add('connected');
        statusText.textContent = 'Live';
    } else {
        statusDot.classList.remove('connected');
        statusDot.classList.add('disconnected');
        statusText.textContent = 'Reconnecting';
    }
}

// --- Rendering ---
async function loadSnapshot(force = false) {
    try {


        const response = await fetchWithAuth('/snapshot');
        if (!response.ok) {
            if (response.status === 503) {
                // No snapshot available - likely no chat open
                chatIsOpen = false;
                // ONLY show empty state if we don't have existing content
                // This prevents "flicker/wipe" when data temporarily drops
                if (chatContent.innerHTML.trim() === '') {
                    showEmptyState();
                }

                // Still check status even if snapshot 503s
                const data = await response.json().catch(() => ({}));
                updateBootServerStatus(data.cdpConnected);

                return;
            }
            throw new Error('Failed to load');
        }

        // Mark chat as open since we got a valid snapshot
        chatIsOpen = true;

        const data = await response.json();
        updateBootServerStatus(data.cdpConnected);

        const scrollPos = chatContainer.scrollTop;
        const scrollHeight = chatContainer.scrollHeight;
        const clientHeight = chatContainer.clientHeight;
        const isNearBottom = scrollHeight - scrollPos - clientHeight < 50;
        const isNearTop = scrollPos < 300;

        // --- THE GOLDEN RULE OF SCROLLING ---
        // If the user is actively reading in the middle of the document, 
        // we DO NOT replace the DOM. Period. This guarantees zero jumping.
        // We only allow DOM replacements if they are at the top (pulling history)
        // or at the bottom (reading live messages), UNLESS forced by refresh button.
        if (!isNearBottom && !isNearTop && !isFirstLoad && !force) {
            pendingSnapshotData = data;
            if (data.stats) {
                const kbs = Math.round((data.stats.htmlSize + data.stats.cssSize) / 1024);
                const statsEl = document.getElementById('statsText');
                if (statsEl) {
                    statsEl.textContent = `${data.stats.nodes} N · ${kbs}KB`;
                    statsEl.style.display = 'inline';
                }
            }
            // Even if we don't update the chat DOM, update the Send button status
            if (data.stats.isGenerating) {
                sendBtn.classList.add('stop-mode');
                sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" style="fill: currentColor; stroke: currentColor; stroke-width: 2;" /></svg>`;
            } else {
                sendBtn.classList.remove('stop-mode');
                sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" style="fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;" /></svg>`;
            }
            return;
        }

        // If they are moving their thumb at the top to load history, wait until they stop
        // so we don't fight their thumb with an abrupt DOM replace.
        if (isNearTop && userIsScrolling && !isFirstLoad && !force) {
            pendingSnapshotData = data;
            return;
        }


        pendingSnapshotData = null; // Clear cached buffer

        // Find what the user is reading so we can snap back to it after DOM replacement
        let anchorInfo = null;
        if (!isNearBottom && scrollPos > 0 && !isFirstLoad) {
            anchorInfo = findScrollAnchor(chatContainer, scrollPos);
        }

        // --- Proceed with full update ---
        if (data.stats) {
            const kbs = Math.round((data.stats.htmlSize + data.stats.cssSize) / 1024);
            const nodes = data.stats.nodes;
            const statsText = document.getElementById('statsText');
            if (statsText) {
                statsText.textContent = `${nodes} N · ${kbs}KB`;
                statsText.style.display = 'inline';
            }

            // Toggle STOP mode logic directly on the Send button to match Antigravity
            const isGenerating = data.stats.isGenerating;
            if (isGenerating) {
                sendBtn.classList.add('stop-mode');
                sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" style="fill: currentColor; stroke: currentColor; stroke-width: 2;" /></svg>`;
            } else {
                sendBtn.classList.remove('stop-mode');
                sendBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" style="fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round;" /></svg>`;
            }
        }

        // --- CSS INJECTION (Cached) ---
        let styleTag = document.getElementById('cdp-styles');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'cdp-styles';
            document.head.appendChild(styleTag);
        }

        const darkModeOverrides = '/* --- BASE SNAPSHOT CSS --- */\n' +
            data.css +
            '\n\n/* --- FORCE DARK MODE OVERRIDES --- */\n' +
            ':root {\n' +
            '    --bg-app: #020617;\n' +
            '    --text-main: #f8fafc;\n' +
            '    --text-muted: #94a3b8;\n' +
            '    --border-color: rgba(34, 211, 238, 0.3);\n' +
            '}\n' +
            '\n' +
            '#conversation, #chat, #cascade {\n' +
            '    background-color: transparent !important;\n' +
            '    color: var(--text-main) !important;\n' +
            '    font-family: \'Inter\', system-ui, sans-serif !important;\n' +
            '    position: relative !important;\n' +
            '    height: auto !important;\n' +
            '    width: 100% !important;\n' +
            '    padding-bottom: 0px !important;\n' +
            '    margin-bottom: 0px !important;\n' +
            '}\n' +
            '#conversation > *:last-child, #chat > *:last-child, #cascade > *:last-child {\n' +
            '    margin-bottom: 0 !important;\n' +
            '    padding-bottom: 0 !important;\n' +
            '}\n' +
            '/* Kill scroll spacers and empty bottom anchors */\n' +
            '#conversation > div[style*="height"], #chat > div[style*="height"], #cascade > div[style*="height"] {\n' +
            '    height: 0 !important;\n' +
            '    min-height: 0 !important;\n' +
            '    max-height: 0 !important;\n' +
            '    overflow: hidden !important;\n' +
            '}\n' +
            '\n' +
            '/* Fix stacking BUT preserve absolute/fixed positioning for dropdowns */\n' +
            '#conversation > div, #chat > div, #cascade > div {\n' +
            '    position: static !important;\n' +
            '}\n' +
            '/* Preserve absolute positioning needed for dropdowns, tooltips, popups */\n' +
            '[style*="position: absolute"], [style*="position: fixed"],\n' +
            '[data-headlessui-state], [id*="headlessui"] {\n' +
            '    position: absolute !important;\n' +
            '}\n' +
            '\n' +
            '/* Annihilate invisible scroll anchors */\n' +
            '#conversation div:empty, #chat div:empty, #cascade div:empty {\n' +
            '    display: none !important;\n' +
            '}\n' +
            '\n' +
            '\n' +
            '#conversation p, #chat p, #cascade p, #conversation h1, #chat h1, #cascade h1, #conversation h2, #chat h2, #cascade h2, #conversation h3, #chat h3, #cascade h3, #conversation h4, #chat h4, #cascade h4, #conversation h5, #chat h5, #cascade h5, #conversation span, #chat span, #cascade span, #conversation div, #chat div, #cascade div, #conversation li, #chat li, #cascade li {\n' +
            '    color: inherit !important;\n' +
            '}\n' +
            '\n' +
            '/* Force black inline text to white */\n' +
            '[style*="color: rgb(0, 0, 0)"], [style*="color: black"],\n' +
            '[style*="color:#000"], [style*="color: #000"] {\n' +
            '    color: #e2e8f0 !important;\n' +
            '}\n' +
            '\n' +
            '#conversation a, #chat a, #cascade a {\n' +
            '    color: #22d3ee !important;\n' +
            '    text-decoration: underline;\n' +
            '}\n' +
            '\n' +
            '/* File Icons Proxy Enabler */\n' +
            '\n' +
            '/* Fix Inline Code - Ultra-compact */\n' +
            ':not(pre) > code {\n' +
            '    padding: 0px 2px !important;\n' +
            '    border-radius: 2px !important;\n' +
            '    background-color: rgba(255, 255, 255, 0.1) !important;\n' +
            '    font-size: 0.82em !important;\n' +
            '    line-height: 1 !important;\n' +
            '    white-space: normal !important;\n' +
            '}\n' +
            '\n' +
            'pre, code, .monaco-editor-background, [class*="terminal"] {\n' +
            '    background-color: #0f172a !important;\n' +
            '    color: #e2e8f0 !important;\n' +
            '    font-family: \'JetBrains Mono\', monospace !important;\n' +
            '    border-radius: 4px;\n' +
            '    border: 1px solid rgba(34, 211, 238, 0.3);\n' +
            '}\n' +
            '\n' +
            '/* Thought Caret / Details Styling */\n' +
            '#conversation details, #chat details, #cascade details {\n' +
            '    background: rgba(15, 23, 42, 0.4) !important;\n' +
            '    border-left: 2px solid var(--accent) !important;\n' +
            '    border-radius: 4px !important;\n' +
            '    margin: 8px 0 !important;\n' +
            '    padding: 6px 12px !important;\n' +
            '}\n' +
            '#conversation summary, #chat summary, #cascade summary {\n' +
            '    font-family: \'Orbitron\', \'Inter\', sans-serif !important;\n' +
            '    font-size: 11px !important;\n' +
            '    text-transform: uppercase !important;\n' +
            '    letter-spacing: 1.5px !important;\n' +
            '    color: var(--text-muted) !important;\n' +
            '    padding: 4px 0 !important;\n' +
            '    cursor: pointer !important;\n' +
            '}\n' +
            '#conversation summary:hover, #chat summary:hover, #cascade summary:hover {\n' +
            '    color: var(--accent) !important;\n' +
            '}\n' +
            '                \n' +
            '/* Multi-line Code Block - Minimal */\n' +
            'pre {\n' +
            '    position: relative !important;\n' +
            '    white-space: pre-wrap !important; \n' +
            '    word-break: break-word !important;\n' +
            '    padding: 4px 6px !important;\n' +
            '    margin: 2px 0 !important;\n' +
            '    display: block !important;\n' +
            '    width: 100% !important;\n' +
            '}\n' +
            '                \n' +
            'pre.has-copy-btn {\n' +
            '    padding-right: 28px !important;\n' +
            '}\n' +
            '                \n' +
            '/* Single-line Code Block - Minimal */\n' +
            'pre.single-line-pre {\n' +
            '    display: inline-block !important;\n' +
            '    width: auto !important;\n' +
            '    max-width: 100% !important;\n' +
            '    padding: 0px 4px !important;\n' +
            '    margin: 0px !important;\n' +
            '    vertical-align: middle !important;\n' +
            '    background-color: #1e293b !important;\n' +
            '    font-size: 0.85em !important;\n' +
            '}\n' +
            '                \n' +
            'pre.single-line-pre > code {\n' +
            '    display: inline !important;\n' +
            '    white-space: nowrap !important;\n' +
            '}\n' +
            '                \n' +
            'pre:not(.single-line-pre) > code {\n' +
            '    display: block !important;\n' +
            '    width: 100% !important;\n' +
            '    overflow-x: auto !important;\n' +
            '    background: transparent !important;\n' +
            '    border: none !important;\n' +
            '    padding: 0 !important;\n' +
            '    margin: 0 !important;\n' +
            '}\n' +
            '                \n' +
            '.mobile-copy-btn {\n' +
            '    position: absolute !important;\n' +
            '    top: 2px !important;\n' +
            '    right: 2px !important;\n' +
            '    background: rgba(30, 41, 59, 0.5) !important;\n' +
            '    color: #94a3b8 !important;\n' +
            '    border: none !important;\n' +
            '    width: 24px !important; \n' +
            '    height: 24px !important;\n' +
            '    padding: 0 !important;\n' +
            '    cursor: pointer !important;\n' +
            '    display: flex !important;\n' +
            '    align-items: center !important;\n' +
            '    justify-content: center !important;\n' +
            '    border-radius: 4px !important;\n' +
            '    transition: all 0.2s ease !important;\n' +
            '    -webkit-tap-highlight-color: transparent !important;\n' +
            '    z-index: 10 !important;\n' +
            '    margin: 0 !important;\n' +
            '}\n' +
            '                \n' +
            '.mobile-copy-btn:hover,\n' +
            '.mobile-copy-btn:focus {\n' +
            '    background: rgba(59, 130, 246, 0.2) !important;\n' +
            '    color: #60a5fa !important;\n' +
            '}\n' +
            '                \n' +
            '.mobile-copy-btn svg {\n' +
            '    width: 16px !important;\n' +
            '    height: 16px !important;\n' +
            '    stroke: currentColor !important;\n' +
            '    stroke-width: 2 !important;\n' +
            '    fill: none !important;\n' +
            '}\n' +
            '                \n' +
            'blockquote {\n' +
            '    border-left: 3px solid #3b82f6 !important;\n' +
            '    background: rgba(59, 130, 246, 0.1) !important;\n' +
            '    color: #cbd5e1 !important;\n' +
            '    padding: 8px 12px !important;\n' +
            '    margin: 8px 0 !important;\n' +
            '}\n' +
            '\n' +
            'table {\n' +
            '    border-collapse: collapse !important;\n' +
            '    width: 100% !important;\n' +
            '    border: 1px solid #334155 !important;\n' +
            '}\n' +
            'th, td {\n' +
            '    border: 1px solid #334155 !important;\n' +
            '    padding: 8px !important;\n' +
            '    color: #e2e8f0 !important;\n' +
            '}\n' +
            '\n' +
            '::-webkit-scrollbar {\n' +
            '    width: 0 !important;\n' +
            '}\n' +
            '                \n' +
            '[style*="background-color: rgb(255, 255, 255)"],\n' +
            '[style*="background-color: white"],\n' +
            '[style*="background: white"] {\n' +
            '    background-color: transparent !important;\n' +
            '}';

        // Only inject and force a browser restyle if the CSS payload actually changed
        if (data.css !== lastCssText) {
            styleTag.textContent = darkModeOverrides + `
                img[src*="vscode-file"], img[src*="vscode-resource"], 
                img[src*="extension"], img[src*="local-img?path=%2F"],
                img[src*="local-img?path=%5C"] {
                    display: none !important;
                }
                .neural-icon-fallback { display: inline-block !important; }
            `;
            lastCssText = data.css;
        }

        // --- STABLE HTML UPDATE ---
        // We clean the HTML slightly for comparison purposes to avoid "refresh blinking"
        // triggered by tiny dynamic ID/class changes while maintaining the actual rich content.
        const cleanedForCompare = data.html
            .replace(/id="[^"]*P0-\d+[^"]*"/g, '')
            .replace(/data-tooltip-id="[^"]*"/g, '')
            .replace(/data-headlessui-state="[^"]*"/g, '')
            // Keep class/style/aria in hash to detect Thought expansion
            .replace(/\s+/g, ' ');

        if (cleanedForCompare !== lastHtmlHash) {
            chatContent.innerHTML = data.html;
            lastHtmlHash = cleanedForCompare;
        }

        // Smart Scroll Handling
        if (isFirstLoad) {
            scrollToBottom('auto');
            isFirstLoad = false;
        } else if (isNearTop && anchorInfo) {
            // ONLY snap back if we updated because we were near the top.
            // When we load history at the top, the DOM replaces and old messages are prepended.
            const restored = restoreScrollAnchor(chatContainer, anchorInfo);
            if (!restored) {
                chatContainer.scrollTop = chatContainer.scrollHeight - (scrollHeight - scrollPos);
            }
        } else if (isNearBottom) {
            scrollToBottom('auto');
        }

        // Defer cosmetic enhancements
        const deferWork = window.requestIdleCallback || ((cb) => setTimeout(cb, 16));
        deferWork(() => {
            addMobileCopyButtons();
            linkifyFilePaths();
        });

    } catch (err) {
        console.error(err);
    }
}

// --- Mobile Code Block Copy Functionality ---
function addMobileCopyButtons() {
    // Find all pre elements (code blocks) in the chat
    const codeBlocks = chatContent.querySelectorAll('pre');

    codeBlocks.forEach((pre, index) => {
        // Skip if already has our button
        if (pre.querySelector('.mobile-copy-btn')) return;

        // Get the code text
        const codeElement = pre.querySelector('code') || pre;
        const textToCopy = (codeElement.textContent || codeElement.innerText).trim();

        // Check if there's a newline character in the TRIMMED text
        // This ensures single-line blocks with trailing newlines don't get buttons
        const hasNewline = /\n/.test(textToCopy);

        // If it's a single line code block, don't add the copy button
        if (!hasNewline) {
            pre.classList.remove('has-copy-btn');
            pre.classList.add('single-line-pre');
            return;
        }

        // Add class for padding
        pre.classList.remove('single-line-pre');
        pre.classList.add('has-copy-btn');

        // Create the copy button (icon only)
        const copyBtn = document.createElement('button');
        copyBtn.className = 'mobile-copy-btn';
        copyBtn.setAttribute('data-code-index', index);
        copyBtn.setAttribute('aria-label', 'Copy code');
        copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            `;

        // Add click handler for copy
        copyBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            const success = await copyToClipboard(textToCopy);

            if (success) {
                // Visual feedback - show checkmark
                copyBtn.classList.add('copied');
                copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            `;

                // Reset after 2 seconds
                setTimeout(() => {
                    copyBtn.classList.remove('copied');
                    copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
            `;
                }, 2000);
            } else {
                // Show X icon briefly on error
                copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
            `;
                setTimeout(() => {
                    copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
            `;
                }, 2000);
            }
        });

        // Insert button into pre element
        pre.appendChild(copyBtn);
    });
}

// --- Cross-platform Clipboard Copy ---
async function copyToClipboard(text) {
    // Method 1: Modern Clipboard API (works on HTTPS or localhost)
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            console.log('[COPY] Success via Clipboard API');
            return true;
        } catch (err) {
            console.warn('[COPY] Clipboard API failed:', err);
        }
    }

    // Method 2: Fallback using execCommand (works on HTTP, older browsers)
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;

        // Avoid scrolling to bottom on iOS
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        textArea.style.opacity = '0';

        document.body.appendChild(textArea);

        // iOS specific handling
        if (navigator.userAgent.match(/ipad|iphone/i)) {
            const range = document.createRange();
            range.selectNodeContents(textArea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            textArea.setSelectionRange(0, text.length);
        } else {
            textArea.select();
        }

        const success = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (success) {
            console.log('[COPY] Success via execCommand fallback');
            return true;
        }
    } catch (err) {
        console.warn('[COPY] execCommand fallback failed:', err);
    }

    // Method 3: For Android WebView or restricted contexts
    // Show the text in a selectable modal if all else fails
    console.error('[COPY] All copy methods failed');
    return false;
}

function scrollToBottom(behavior = 'smooth') {
    requestAnimationFrame(() => {
        // Slight delay to allow DOM/images to settle before calculating scrollHeight
        setTimeout(() => {
            chatContainer.scrollTo({
                top: chatContainer.scrollHeight,
                behavior: behavior
            });
        }, 50);
    });
}

// --- Inputs ---
async function sendMessage() {
    if (isSending) return;
    const message = messageInput.value.trim();
    if (!message) return;

    isSending = true;

    // Optimistic UI updates
    messageInput.value = ''; // Clear immediately
    messageInput.style.height = 'auto'; // Reset height
    messageInput.blur(); // Close keyboard on mobile immediately

    sendBtn.disabled = true;
    sendBtn.style.opacity = '0.5';

    try {
        // If no chat is open, start a new one first
        if (!chatIsOpen) {
            const newChatRes = await fetchWithAuth('/new-chat', { method: 'POST' });
            const newChatData = await newChatRes.json();
            if (newChatData.success) {
                // Wait for the new chat to be ready
                await new Promise(r => setTimeout(r, 800));
                chatIsOpen = true;
            }
        }

        // Optimistic Thinking State - provide immediate feedback
        const thinkingDiv = document.createElement('div');
        thinkingDiv.id = 'optimisticThinking';
        thinkingDiv.innerHTML = `<div class="thinking-loader"></div><span>Comm-Link: Relaying query to Neural Core...</span>`;
        chatContent.appendChild(thinkingDiv);
        scrollToBottom('smooth');

        const res = await fetchWithAuth('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        // Always reload snapshot to check if message appeared
        setTimeout(loadSnapshot, 300);
        setTimeout(loadSnapshot, 1200); // Wait longer for agent to start thinking
        setTimeout(checkChatStatus, 2000);

        // Don't revert the input - if user sees the message in chat, it was sent
        // Only log errors for debugging, don't show alert popups
        if (!res.ok) {
            console.warn('Send response not ok, but message may have been sent:', await res.json().catch(() => ({})));
        }
    } catch (e) {
        // Network error - still try to refresh in case it went through
        console.error('Send error:', e);
        setTimeout(loadSnapshot, 500);
    } finally {
        isSending = false;
        sendBtn.disabled = false;
        sendBtn.style.opacity = '1';
        if (attachmentIndicator) attachmentIndicator.style.display = 'none';
    }
}

// --- Send/Stop Logic ---
async function handleStop() {
    sendBtn.style.opacity = '0.5';
    try {
        const res = await fetchWithAuth('/stop', { method: 'POST' });
        const data = await res.json();
    } catch (e) { }
    setTimeout(() => sendBtn.style.opacity = '1', 500);
}

sendBtn.addEventListener('click', () => {
    if (sendBtn.classList.contains('stop-mode')) {
        handleStop();
    } else {
        sendMessage();
    }
});

const uploadInput = document.getElementById('imageUploadBtn');
if (uploadInput) {
    uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            if (attachmentIndicator) attachmentIndicator.style.display = 'block';
            uploadInput.disabled = true;
            statusText.textContent = 'Uploading...';

            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = async () => {
                const base64 = reader.result;

                try {
                    const res = await fetchWithAuth('/upload-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            imageBase64: base64,
                            filename: file.name
                        })
                    });

                    if (res.ok) {
                        statusText.textContent = 'Image Sent';
                        setTimeout(() => loadSnapshot(), 1000); // Reload chat
                    } else {
                        statusText.textContent = 'Upload Failed';
                        if (attachmentIndicator) attachmentIndicator.style.display = 'none';
                        console.error('Upload failed with status', res.status);
                    }
                } catch (netErr) {
                    statusText.textContent = 'Upload Failed';
                    if (attachmentIndicator) attachmentIndicator.style.display = 'none';
                    console.error('Network error on upload', netErr);
                } finally {
                    uploadInput.disabled = false;
                    e.target.value = ''; // Reset input
                    setTimeout(updateStatus, 3000); // Reset status bar
                }
            };
        } catch (err) {
            console.error(err);
            uploadInput.disabled = false;
            e.target.value = '';
        }
    });
}



messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

messageInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

// --- Scroll Sync to Desktop ---
let scrollSyncTimeout = null;
let lastScrollSync = 0;
const SCROLL_SYNC_DEBOUNCE = 800; // ms between scroll syncs (longer to prevent fighting user)
let snapshotReloadPending = false;

async function syncScrollToDesktop() {
    const scrollPercent = chatContainer.scrollTop / (chatContainer.scrollHeight - chatContainer.clientHeight);
    try {
        await fetchWithAuth('/remote-scroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scrollPercent })
        });

        // We removed the 'isNearBottom' restriction here.
        // If we scrolled the desktop, we WANT a new snapshot immediately
        // so we can see the older history we just scrolled to.
        if (!snapshotReloadPending) {
            snapshotReloadPending = true;
            setTimeout(() => {
                // By checking userIsScrolling, we wait until the thumb is off the screen
                if (!userIsScrolling) {
                    loadSnapshot();
                }
                snapshotReloadPending = false;
            }, 500);
        }
    } catch (e) {
        console.log('Scroll sync failed:', e.message);
    }
}

// --- Anchor-Based Scroll Preservation ---
// Fast version: uses scrollTop math instead of getBoundingClientRect in loops.

function findScrollAnchor(container, scrollTop) {
    // Use direct children of chat-content as anchor candidates (message blocks)
    // These are far fewer than all p/h1/li inside them
    const chatContent = container.querySelector('.chat-content') || container;
    const children = chatContent.children;
    if (!children.length) return null;

    const viewportTarget = scrollTop + container.clientHeight * 0.3;

    // Binary-ish search: walk children using offsetTop (no reflow, uses layout cache)
    let best = null;
    for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const top = child.offsetTop;
        if (top > viewportTarget) break;
        best = child;
    }

    if (!best) best = children[0];

    // Now find a text-bearing element inside this block for fingerprinting
    const textEl = best.querySelector('p, h1, h2, h3, h4, li, summary, pre') || best;
    const text = (textEl.textContent || '').trim().substring(0, 100);
    const tag = textEl.tagName.toLowerCase();
    const offsetFromBlock = viewportTarget - best.offsetTop;

    return { tag, text, offsetFromBlock, blockIndex: Array.prototype.indexOf.call(children, best) };
}

function restoreScrollAnchor(container, anchor) {
    if (!anchor) return false;

    const chatContent = container.querySelector('.chat-content') || container;
    const children = chatContent.children;

    // Fast path: try the same block index first (most common case)
    if (anchor.blockIndex >= 0 && anchor.blockIndex < children.length) {
        const block = children[anchor.blockIndex];
        const textEl = block.querySelector(anchor.tag) || block;
        const blockText = (textEl.textContent || '').trim().substring(0, 100);
        if (blockText === anchor.text) {
            container.scrollTop = Math.max(0, block.offsetTop + anchor.offsetFromBlock);
            return true;
        }
    }

    // Fallback: scan all blocks for text match (still fast, just offsetTop, no reflow)
    for (let i = 0; i < children.length; i++) {
        const block = children[i];
        const textEl = block.querySelector(anchor.tag) || block;
        const blockText = (textEl.textContent || '').trim().substring(0, 100);
        if (blockText === anchor.text) {
            container.scrollTop = Math.max(0, block.offsetTop + anchor.offsetFromBlock);
            return true;
        }
    }

    // Last resort: use block index with offset
    if (anchor.blockIndex >= 0 && anchor.blockIndex < children.length) {
        container.scrollTop = Math.max(0, children[anchor.blockIndex].offsetTop + anchor.offsetFromBlock);
        return true;
    }

    return false;
}

chatContainer.addEventListener('scroll', () => {
    userIsScrolling = true;
    userScrollLockUntil = Date.now() + USER_SCROLL_LOCK_DURATION;
    clearTimeout(idleTimer);

    const isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < 50;
    if (isNearBottom) {
        scrollToBottomBtn.classList.remove('show');
        userScrollLockUntil = 0;
    } else {
        scrollToBottomBtn.classList.add('show');
    }

    // Debounced scroll sync to desktop
    const now = Date.now();
    if (now - lastScrollSync > SCROLL_SYNC_DEBOUNCE) {
        lastScrollSync = now;
        clearTimeout(scrollSyncTimeout);
        scrollSyncTimeout = setTimeout(syncScrollToDesktop, 100);
    }

    idleTimer = setTimeout(() => {
        userIsScrolling = false;
        autoRefreshEnabled = true;

        // User stopped scrolling. Always fetch a fresh snapshot now to ensure 
        // any older messages the desktop just loaded are injected into the phone immediately.
        loadSnapshot();
    }, 800);
});

scrollToBottomBtn.addEventListener('click', () => {
    userIsScrolling = false;
    userScrollLockUntil = 0;
    loadSnapshot(); // Get the latest content
    scrollToBottom();
});

// --- Quick Actions ---
function quickAction(text) {
    messageInput.value = text;
    messageInput.style.height = 'auto';
    messageInput.style.height = messageInput.scrollHeight + 'px';
    messageInput.focus();
}

// --- Stop Logic removed, now handled by Send Button ---

// --- New Chat Logic ---
async function startNewChat() {
    newChatBtn.style.opacity = '0.5';
    newChatBtn.style.pointerEvents = 'none';

    try {
        const res = await fetchWithAuth('/new-chat', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            // Reload snapshot to show new empty chat
            setTimeout(loadSnapshot, 500);
            setTimeout(loadSnapshot, 1000);
            setTimeout(checkChatStatus, 1500);
        } else {
            console.error('Failed to start new chat:', data.error);
        }
    } catch (e) {
        console.error('New chat error:', e);
    }

    setTimeout(() => {
        newChatBtn.style.opacity = '1';
        newChatBtn.style.pointerEvents = 'auto';
    }, 500);
}

newChatBtn.addEventListener('click', startNewChat);

// --- Chat History Logic ---
async function showChatHistory() {
    const historyLayer = document.getElementById('historyLayer');
    const historyList = document.getElementById('historyList');

    // Temporary: Feature is in development
    historyList.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: white;">
            <div style="font-size: 24px; margin-bottom: 10px;">🚧</div>
            <div style="font-weight: 500; margin-bottom: 5px;">History In Development</div>
            <div style="font-size: 13px; opacity: 0.7;">We are working on improving the history sync. Check back soon!</div>
            <br>
            <div class="history-item new-chat-item" onclick="hideChatHistory(); startNewChat();" style="justify-content: center; background: var(--accent); color: white; border:none;">
                Start New Conversation
            </div>
        </div>
    `;
    historyLayer.classList.add('show');
    setTimeout(() => historyBtn.style.opacity = '1', 300);
}

function hideChatHistory() {
    historyLayer.classList.remove('show');
}

historyBtn.addEventListener('click', showChatHistory);

// --- Select Chat from History ---
async function selectChat(title) {
    try {
        const res = await fetchWithAuth('/select-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        const data = await res.json();

        if (data.success) {
            setTimeout(loadSnapshot, 300);
            setTimeout(loadSnapshot, 800);
            setTimeout(checkChatStatus, 1000);
        } else {
            console.error('Failed to select chat:', data.error);
        }
    } catch (e) {
        console.error('Select chat error:', e);
    }
}

// --- Check Chat Status ---
async function checkChatStatus() {
    try {
        const res = await fetchWithAuth('/chat-status');
        const data = await res.json();

        chatIsOpen = data.hasChat || data.editorFound;

        if (!chatIsOpen && chatContent.innerHTML.trim() === '') {
            showEmptyState();
        }
    } catch (e) {
        console.error('Chat status check failed:', e);
    }
}

// --- Empty State (No Chat Open) ---
function showEmptyState() {
    chatContent.innerHTML = `
        <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                <line x1="9" y1="10" x2="15" y2="10"></line>
            </svg>
            <h2>No Chat Open</h2>
            <p>Start a new conversation or select one from your history to begin chatting.</p>
            <button class="empty-state-btn" onclick="startNewChat()">
                Start New Conversation
            </button>
        </div>
    `;
}

// --- Utility: Escape HTML ---
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// --- Settings Logic ---


function openModal(title, options, onSelect) {
    modalTitle.textContent = title;
    modalList.innerHTML = '';
    options.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'modal-option';
        div.textContent = opt;
        div.onclick = () => {
            onSelect(opt);
            closeModal();
        };
        modalList.appendChild(div);
    });
    modalOverlay.classList.add('show');
}

function closeModal() {
    modalOverlay.classList.remove('show');
}

modalOverlay.onclick = (e) => {
    if (e.target === modalOverlay) closeModal();
};

modeBtn.addEventListener('click', () => {
    openModal('Select Mode', ['Fast', 'Planning'], async (mode) => {
        modeText.textContent = 'Setting...';
        try {
            const res = await fetchWithAuth('/set-mode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mode })
            });
            const data = await res.json();
            if (data.success) {
                currentMode = mode;
                modeText.textContent = mode;
                modeBtn.classList.toggle('active', mode === 'Planning');
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
                modeText.textContent = currentMode;
            }
        } catch (e) {
            modeText.textContent = currentMode;
        }
    });
});

modelBtn.addEventListener('click', () => {
    openModal('Select Model', MODELS, async (model) => {
        const prev = modelText.textContent;
        modelText.textContent = 'Setting...';
        try {
            const res = await fetchWithAuth('/set-model', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model })
            });
            const data = await res.json();
            if (data.success) {
                modelText.textContent = model;
            } else {
                alert('Error: ' + (data.error || 'Unknown'));
                modelText.textContent = prev;
            }
        } catch (e) {
            modelText.textContent = prev;
        }
    });
});
function updateBootServerStatus(connected) {
    const textSpan = document.getElementById('bootServerText');
    const bootBtn = document.getElementById('bootServerBtn');
    if (!textSpan || !bootBtn) return;

    if (connected) {
        textSpan.innerText = 'SERVER ON';
        bootBtn.style.color = '#10b981'; // Green
        bootBtn.style.borderColor = '#10b981';
    } else {
        // Only reset if it's not currently "BOOTING..."
        if (textSpan.innerText !== 'BOOTING...') {
            textSpan.innerText = 'BOOT SERVER';
            bootBtn.style.color = 'var(--accent)';
            bootBtn.style.borderColor = 'var(--accent)';
        }
    }
}
bootServerBtn.addEventListener('click', async () => {
    try {
        const textSpan = document.getElementById('bootServerText');
        if (textSpan) textSpan.innerText = 'BOOTING...';

        const res = await fetchWithAuth('/boot-server', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            setTimeout(() => { if (textSpan) textSpan.innerText = 'BOOTED'; }, 1000);
        } else {
            if (textSpan) textSpan.innerText = 'ERROR';
        }
    } catch (e) {
        console.error(e);
        const textSpan = document.getElementById('bootServerText');
        if (textSpan) textSpan.innerText = 'ERROR';
    }
});

// --- Viewport / Keyboard Handling ---
// This fixes the issue where the keyboard hides the input or layout breaks
if (window.visualViewport) {
    function handleResize() {
        // Resize the body to match the visual viewport (screen minus keyboard)
        document.body.style.height = window.visualViewport.height + 'px';

        // Don't auto-scroll when keyboard opens — user controls scroll via FAB
    }

    window.visualViewport.addEventListener('resize', handleResize);
    window.visualViewport.addEventListener('scroll', handleResize);
    handleResize(); // Init
} else {
    // Fallback for older browsers without visualViewport support
    window.addEventListener('resize', () => {
        document.body.style.height = window.innerHeight + 'px';
    });
    document.body.style.height = window.innerHeight + 'px'; // Init
}

// --- Remote Click Logic (Thinking/Thought & Review Changes) ---
chatContainer.addEventListener('click', async (e) => {
    // NEXUS CONTEXT RELAY: Handle terminal context button clicks
    const contextBtn = e.target.closest('.nexus-terminal-context-btn');
    if (contextBtn) {
        e.stopPropagation();
        const payload = contextBtn.getAttribute('data-context-payload');
        if (payload) {
            showToast("Establishing Brain Link...", "processing");
            contextBtn.style.opacity = "0.5";
            contextBtn.style.pointerEvents = "none";

            try {
                await fetchWithAuth('/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: "Analyzing system logs for context:\n\n" + payload })
                });
                showToast("Log Coupled to Neural Core", "success");
                contextBtn.style.background = "#4ade80";
                contextBtn.innerHTML = "<span>✅ LOG COUPLED</span>";

                setTimeout(() => {
                    contextBtn.style.background = "#22d3ee";
                    contextBtn.innerHTML = "<span>COUPLE CONTEXT</span>";
                    contextBtn.style.opacity = "1";
                    contextBtn.style.pointerEvents = "auto";
                }, 3000);
            } catch (err) {
                showToast("Link Refused - Check System", "error");
                contextBtn.style.opacity = "1";
                contextBtn.style.pointerEvents = "auto";
            }
        }
        return;
    }

    // 1. Find the nearest container that might be the "Thought" block or an Action Button
    const target = e.target.closest('div, span, p, summary, button, details');
    if (!target) return;

    const text = target.innerText || '';

    // Check if this looks like a thought toggle
    const isThoughtToggle = /Thought|Thinking/i.test(text) && text.length < 500;

    // Check if this looks like an Accept/Reject action button
    const isActionBtn = target.tagName === 'BUTTON' || target.getAttribute('role') === 'button';
    const isReviewAction = isActionBtn && /Accept|Reject|Run|Stop|Cancel/i.test(text) && text.length < 30;

    const shouldForwardClick = isThoughtToggle || isReviewAction;

    if (shouldForwardClick) {
        // Visual feedback
        target.style.opacity = '0.5';
        setTimeout(() => target.style.opacity = '1', 300);

        // For thoughts, use first line ("Thought for 3s"). For buttons, use precise text.
        const firstLine = isReviewAction ? text.trim() : text.split('\n')[0].trim();

        try {
            const response = await fetchWithAuth('/remote-click', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    selector: target.tagName.toLowerCase(),
                    index: 0,
                    textContent: firstLine
                })
            });

            // Reload snapshot multiple times to catch the UI change
            setTimeout(() => loadSnapshot(true), 1200);
            setTimeout(() => loadSnapshot(true), 2500);
        } catch (e) {
            console.error('Remote click failed:', e);
        }
    }
});

// --- Init ---
connectWebSocket();
// Sync state initially and every 5 seconds to keep phone in sync with desktop changes
fetchAppState();
setInterval(fetchAppState, 5000);

// Check chat status initially and periodically
checkChatStatus();
setInterval(checkChatStatus, 10000); // Check every 10 seconds

// ============================================
//  FILE HOLOGRAM — "Peek" Protocol
// ============================================

const FILE_EXT_ICONS = {
    'py': '🐍', 'js': '⚡', 'jsx': '⚛️', 'tsx': '⚛️', 'ts': '📘',
    'json': '📋', 'md': '📝', 'html': '🌐', 'css': '🎨', 'txt': '📄',
    'sh': '💻', 'sql': '🗄️', 'yaml': '⚙️', 'yml': '⚙️', 'env': '🔐',
    'xml': '📃', 'csv': '📊', 'toml': '⚙️', 'ini': '⚙️', 'cfg': '⚙️',
    'rs': '🦦', 'go': '🐹', 'rb': '💎', 'java': '☕', 'c': '⚡',
    'cpp': '⚡', 'h': '📄', 'vue': '💚'
};

const VALID_EXTENSIONS = new Set(Object.keys(FILE_EXT_ICONS));

function linkifyFilePaths() {
    // Regex: match file paths like server.js, src/utils/heroUtils.js, etc.
    const FILE_REGEX = /(?:^|[\s"'`(\[{])([\w\-.\/]+\.(?:py|js|jsx|tsx|ts|json|md|html|css|txt|sh|sql|yaml|yml|env|xml|csv|toml))(?=[\s"'`)\]},;:]|$)/g;

    // Walk text nodes in the chat content (skip code blocks and existing links)
    const walker = document.createTreeWalker(
        chatContent,
        NodeFilter.SHOW_TEXT,
        {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent) return NodeFilter.FILTER_REJECT;
                // Skip if already inside a file-link, code block, or link
                if (parent.closest('.file-link, pre, code, a, .hologram-code')) {
                    return NodeFilter.FILTER_REJECT;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        }
    );

    const textNodes = [];
    let n;
    while (n = walker.nextNode()) textNodes.push(n);

    textNodes.forEach(node => {
        const text = node.textContent;
        if (!FILE_REGEX.test(text)) return;
        FILE_REGEX.lastIndex = 0; // Reset regex state

        const frag = document.createDocumentFragment();
        let lastIdx = 0;
        let match;

        while (match = FILE_REGEX.exec(text)) {
            const filePath = match[1];
            const matchStart = match.index + match[0].indexOf(filePath);
            const matchEnd = matchStart + filePath.length;

            // Add text before the match
            if (matchStart > lastIdx) {
                frag.appendChild(document.createTextNode(text.slice(lastIdx, matchStart)));
            }

            // Create the hologram link
            const link = document.createElement('span');
            link.className = 'file-link';

            // Add a small icon based on extension
            const ext = filePath.split('.').pop().toLowerCase();
            let iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px; vertical-align:middle;"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';

            if (ext === 'css' || ext === 'scss') {
                iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" stroke-width="2.5" style="margin-right:4px; vertical-align:middle;"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path></svg>';
            } else if (ext === 'js' || ext === 'ts' || ext === 'jsx' || ext === 'tsx') {
                iconSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2.5" style="margin-right:4px; vertical-align:middle;"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"></path></svg>';
            }

            link.innerHTML = iconSvg + filePath;
            link.setAttribute('data-file-path', filePath);
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                openHologram(filePath);
            });

            frag.appendChild(link);
            lastIdx = matchEnd;
        }

        // Add remaining text
        if (lastIdx < text.length) {
            frag.appendChild(document.createTextNode(text.slice(lastIdx)));
        }

        if (frag.childNodes.length > 0) {
            // NUCLEAR SCRUB: Remove sibling broken icons more aggressively
            let sib = node.previousSibling;
            while (sib) {
                const tag = sib.tagName;
                const isIconRemnant = tag === 'IMG' || tag === 'SVG' ||
                    (sib.className && String(sib.className).includes('icon')) ||
                    (sib.innerText && sib.innerText.length < 2);

                if (isIconRemnant) {
                    let toRemove = sib;
                    sib = sib.previousSibling;
                    toRemove.remove();
                } else break;
            }
            node.parentNode.replaceChild(frag, node);
        }
    });
}

async function openHologram(filePath) {
    const overlay = document.getElementById('hologramOverlay');
    const filenameEl = document.getElementById('hologramFilename');
    const metaEl = document.getElementById('hologramMeta');
    const codeEl = document.getElementById('hologramCode');
    const iconEl = document.getElementById('hologramIcon');

    // Show loading state
    const ext = filePath.split('.').pop() || 'txt';
    iconEl.textContent = FILE_EXT_ICONS[ext] || '📄';
    filenameEl.textContent = filePath.split('/').pop();
    metaEl.textContent = 'Loading...';
    codeEl.textContent = '// Fetching file content...';
    overlay.classList.add('show');

    try {
        const res = await fetchWithAuth('/file-peek?path=' + encodeURIComponent(filePath));
        const data = await res.json();

        if (data.success) {
            filenameEl.textContent = data.filename;
            metaEl.textContent = `${data.lines} lines \u00b7 ${(data.size / 1024).toFixed(1)}KB \u00b7 .${data.extension}`;
            codeEl.textContent = data.content;
        } else {
            codeEl.textContent = `// Error: ${data.error}\n// Path: ${filePath}`;
            metaEl.textContent = 'File not accessible';
        }
    } catch (e) {
        codeEl.textContent = `// Network error: ${e.message}`;
        metaEl.textContent = 'Connection failed';
    }
}

function closeHologram() {
    document.getElementById('hologramOverlay').classList.remove('show');
}

// Close hologram on overlay click (outside the panel)
document.getElementById('hologramOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'hologramOverlay') closeHologram();
});

// ============================================
//  VOICE-TO-COMMAND — Neural Bridge
// ============================================

const ELITE_DX_COMMANDS = {
    'check this': 'Run a diagnostic on the active file and report anomalies.',
    'fix this': 'Analyze the current file and fix any linting errors.',
    'clean up': 'Execute the Zero-Shim policy: delete all temporary logs and orphaned result files.',
    'ship it': 'Final review of the current changes and prepare for commit.',
    'analyze': 'Analyze the current draft and identify win conditions.',
    'review': 'Review the most recent match for mechanical errors.',
    'status': 'Give me a full status report on all running services.',
    'what changed': 'Summarize all file changes since the last commit.',
    'explain': 'Explain the logic of the currently open file in simple terms.',
    'test it': 'Run the test suite and report results.',
    'summarize': 'Provide a concise summary of the current conversation.'
};

let voiceRecognition = null;
let isListening = false;
let voiceTranscriptEl = null;

function initVoice() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('Speech Recognition not supported');
        const voiceBtn = document.getElementById('voiceBtn');
        if (voiceBtn) voiceBtn.style.display = 'none';
        return;
    }

    voiceRecognition = new SpeechRecognition();
    voiceRecognition.continuous = false;
    voiceRecognition.interimResults = true;
    voiceRecognition.lang = 'en-US';
    voiceRecognition.maxAlternatives = 1;

    voiceRecognition.onstart = () => {
        isListening = true;
        const voiceBtn = document.getElementById('voiceBtn');
        voiceBtn.classList.add('listening');
        showVoiceTranscript('Listening...');
    };

    voiceRecognition.onresult = (event) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                final += transcript;
            } else {
                interim += transcript;
            }
        }

        // Show live transcript
        if (interim) showVoiceTranscript('\ud83c\udfa4 ' + interim);

        if (final) {
            const processed = processVoiceCommand(final.trim());
            showVoiceTranscript('\u2705 ' + processed.display);

            setTimeout(() => {
                // Inject into message input and send
                messageInput.value = processed.command;
                messageInput.dispatchEvent(new Event('input'));
                sendMessage();
                hideVoiceTranscript();
            }, 600);
        }
    };

    voiceRecognition.onerror = (event) => {
        console.error('Voice error:', event.error);
        if (event.error === 'not-allowed') {
            showVoiceTranscript('\u26a0\ufe0f Microphone access denied');
        } else {
            showVoiceTranscript('\u26a0\ufe0f ' + event.error);
        }
        setTimeout(hideVoiceTranscript, 2000);
        stopListening();
    };

    voiceRecognition.onend = () => {
        stopListening();
    };
}

function processVoiceCommand(transcript) {
    const lower = transcript.toLowerCase().trim();

    // Check for exact Elite DX command matches
    for (const [trigger, command] of Object.entries(ELITE_DX_COMMANDS)) {
        if (lower === trigger || lower.startsWith(trigger + ' ') || lower.endsWith(' ' + trigger)) {
            return { command, display: trigger + ' \u2192 Elite DX' };
        }
    }

    // Check for partial matches (e.g., "check this file" matches "check this")
    for (const [trigger, command] of Object.entries(ELITE_DX_COMMANDS)) {
        if (lower.includes(trigger)) {
            return { command, display: trigger + ' \u2192 Elite DX' };
        }
    }

    // No mapping — send raw transcript (sanitized)
    const sanitized = transcript.trim().replace(/\s+/g, ' ');
    return { command: sanitized, display: sanitized };
}

function toggleVoice() {
    if (!voiceRecognition) {
        initVoice();
        if (!voiceRecognition) return;
    }

    if (isListening) {
        voiceRecognition.stop();
    } else {
        try {
            voiceRecognition.start();
        } catch (e) {
            console.error('Failed to start voice:', e);
        }
    }
}

function stopListening() {
    isListening = false;
    const voiceBtn = document.getElementById('voiceBtn');
    if (voiceBtn) voiceBtn.classList.remove('listening');
}

function showVoiceTranscript(text) {
    if (!voiceTranscriptEl) {
        voiceTranscriptEl = document.createElement('div');
        voiceTranscriptEl.className = 'voice-transcript';
        document.body.appendChild(voiceTranscriptEl);
    }
    voiceTranscriptEl.textContent = text;
    voiceTranscriptEl.style.display = 'block';
}

function hideVoiceTranscript() {
    if (voiceTranscriptEl) {
        voiceTranscriptEl.style.display = 'none';
    }
}

// Wire up voice button
const voiceBtn = document.getElementById('voiceBtn');
if (voiceBtn) {
    voiceBtn.addEventListener('click', toggleVoice);
}

// Init voice engine
initVoice();
// Nexus Notification Hub
function showToast(message, type = "info") {
    const toast = document.getElementById('nexusToast');
    if (!toast) return;

    toast.textContent = message;
    toast.className = `nexus-toast show ${type}`;

    // Auto-dismiss after 4 seconds
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}
