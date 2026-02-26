import http from 'http';
import WebSocket from 'ws';

const PORTS = [9000, 56991, 9001, 9002, 9003];

// Helper: HTTP GET JSON
export function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// Find Nexus CDP endpoint
export async function discoverCDP() {
    const listResults = [];

    // First, gather all lists from all active ports
    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            listResults.push({ port, list });
        } catch (e) {
            // Port not open or no JSON list
        }
    }

    if (listResults.length === 0) {
        throw new Error(`CDP not found. No debug ports responding (${PORTS.join(', ')})`);
    }

    // Priority 1: Main Workbench (Chat DOM) - Search all ports first
    for (const { port, list } of listResults) {
        const workbench = list.find(t =>
            t.type === 'page' &&
            t.url?.includes('workbench.html') &&
            !t.url?.includes('jetski')
        );
        if (workbench && workbench.webSocketDebuggerUrl) {
            console.log(`✅ [Port ${port}] Found Workbench target:`, workbench.title);
            return { port, url: workbench.webSocketDebuggerUrl };
        }
    }

    // Priority 2: Jetski/Launchpad - Search all ports next
    for (const { port, list } of listResults) {
        const jetski = list.find(t => t.url?.includes('jetski') || t.title === 'Launchpad');
        if (jetski && jetski.webSocketDebuggerUrl) {
            console.log(`🔧 [Port ${port}] Found Jetski/Launchpad target:`, jetski.title);
            return { port, url: jetski.webSocketDebuggerUrl };
        }
    }

    // Priority 3: Any non-viewer page
    for (const { port, list } of listResults) {
        const generic = list.find(t =>
            t.type === 'page' &&
            t.webSocketDebuggerUrl &&
            !t.url?.includes('localhost:5173') // Avoid connecting back to the viewer UI itself
        );
        if (generic) {
            console.log(`⚠️ [Port ${port}] Found generic page target:`, generic.title);
            return { port, url: generic.webSocketDebuggerUrl };
        }
    }

    throw new Error('CDP found ports but no suitable Page target detected.');
}

// Connect to CDP
export async function connectCDP(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let id = 0;
        const pendingCalls = new Map();
        ws.contexts = []; // Initialize contexts array

        ws.on('open', async () => {
            console.log('✅ Connected to Nexus CDP');

            // Expose a clean .call() method
            ws.call = (method, params) => {
                return new Promise((res, rej) => {
                    const messageId = ++id;
                    const payload = JSON.stringify({ id: messageId, method, params });

                    const timeout = setTimeout(() => {
                        pendingCalls.delete(messageId);
                        rej(new Error(`CDP Call Timeout (${method})`));
                    }, 30000);

                    pendingCalls.set(messageId, { res, rej, timeout });
                    ws.send(payload);
                });
            };

            // Discover execution contexts
            try {
                await ws.call('Runtime.enable', {});
                // Small delay for contexts to populate
                await new Promise(r => setTimeout(r, 500));

                // Try to get the default context by evaluating a simple expression
                try {
                    const testResult = await ws.call('Runtime.evaluate', {
                        expression: '({contextId: 1})',
                        returnByValue: true
                    });
                    // If we get here, the default context works — create a minimal context entry
                    ws.contexts = [{ id: undefined }]; // undefined contextId = default context
                    console.log('✅ Using default execution context');
                } catch (e) {
                    console.warn('⚠️  Could not verify default context:', e.message);
                    ws.contexts = [{ id: undefined }];
                }
            } catch (e) {
                console.warn('⚠️  Runtime.enable failed:', e.message);
                ws.contexts = [{ id: undefined }]; // Fallback to default
            }

            resolve(ws);
        });

        ws.on('message', (data) => {
            try {
                const response = JSON.parse(data);
                if (response.id && pendingCalls.has(response.id)) {
                    const { res, rej, timeout } = pendingCalls.get(response.id);
                    clearTimeout(timeout);
                    pendingCalls.delete(response.id);
                    if (response.error) rej(response.error);
                    else res(response.result);
                }
            } catch (e) { /* Notification or malformed */ }
        });

        ws.on('error', reject);
        ws.on('close', () => console.log('❌ CDP connection closed'));
    });
}
