import { captureSnapshot } from './nexus_service.js';
import { hashString, isPortOpen } from './utils.js';
import { discoverCDP, connectCDP } from './cdp_service.js';
import { WebSocket } from 'ws';

export class BridgeService {
    constructor(wss) {
        this.wss = wss;
        this.cdpConnection = null;
        this.lastSnapshot = null;
        this.lastSnapshotHash = null;
        this.isConnecting = false;
        this.pollInterval = 1500;
        this.lastErrorLog = 0;
        this.lastApiState = false;
        this.lastCdpState = false;
    }

    async initCDP() {
        // console.log('🔍 Discovering Nexus CDP endpoint...');
        try {
            const cdpInfo = await discoverCDP();
            console.log(`✅ Found Nexus on port ${cdpInfo.port}`);
            this.cdpConnection = await connectCDP(cdpInfo.url);
            console.log(`✅ Connected! Found ${this.cdpConnection.contexts.length} execution contexts`);

            // Proactive disconnect handling
            this.cdpConnection.on('close', () => {
                console.warn('❌ CDP Connection lost');
                this.cdpConnection = null;
                this.broadcastStatus();
            });

            return this.cdpConnection;
        } catch (err) {
            // console.warn(`⚠️  CDP discovery failed: ${err.message}`);
            throw err;
        }
    }

    startPolling() {
        const poll = async () => {
            // 1. Monitor Base Status (API + CDP)
            try {
                const apiAlive = await isPortOpen(8000);
                const cdpAlive = !!(this.cdpConnection && this.cdpConnection.readyState === WebSocket.OPEN);

                if (apiAlive !== this.lastApiState || cdpAlive !== this.lastCdpState) {
                    this.lastApiState = apiAlive;
                    this.lastCdpState = cdpAlive;
                    this.broadcastStatus();
                }
            } catch (e) { }

            // 2. Handle Reconnection
            if (!this.cdpConnection) {
                if (!this.isConnecting) {
                    // console.log('🔍 Looking for Nexus CDP connection...');
                    this.isConnecting = true;
                }
                try {
                    await this.initCDP();
                    this.isConnecting = false;
                } catch (err) { }
                setTimeout(poll, 2000);
                return;
            }

            // 3. Capture Snapshot
            try {
                if (this.cdpConnection && this.cdpConnection.readyState === WebSocket.OPEN) {
                    const snapshot = await captureSnapshot(this.cdpConnection);
                    if (snapshot && !snapshot.error) {
                        // HYPER-AGGRESSIVE CLEANING: Strip everything that isn't core content 
                        // to prevent phantom "twitchy" updates. We only care if the TEXT or 
                        // the TAG structure changes.
                        const htmlForHash = snapshot.html
                            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Strip inline styles
                            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Strip scripts
                            .replace(/ (id|class|style|aria-[a-z]+|data-[a-z0-9-]+)="[^"]*"/gi, '') // Strip ALL attributes
                            .replace(/>\s+</g, '><') // Normalize whitespace between tags
                            .trim();

                        // Skip server log view (feedback loop) but keep polling
                        if (snapshot.title?.includes('server.log')) {
                            setTimeout(poll, 2000);
                            return;
                        }

                        const hash = hashString(htmlForHash);
                        if (hash !== this.lastSnapshotHash) {
                            this.lastSnapshot = snapshot;
                            this.lastSnapshotHash = hash;
                            // snapshot updated (broadcast sent; no log to reduce noise)
                            const now = Date.now();
                            if (now - (this.lastSuccessLog || 0) > 60000) {
                                const stats = snapshot.stats || {};
                                console.log(`✅ Snapshot heartbeat: ${stats.nodes || 0} nodes, ${Math.round((stats.htmlSize || 0)/1024)}KB`);
                                this.lastSuccessLog = now;
                            }
                            this.broadcast({ type: 'snapshot_update' });
                        }
                    } else {
                        const now = Date.now();
                        if (now - this.lastErrorLog > 10000) { 
                            console.warn(`⚠️  Snapshot capture issue: ${snapshot?.error || 'No valid snapshot'} (Title: "${snapshot?.title}", URL: "${snapshot?.url}")`);
                            this.lastErrorLog = now;
                        }
                    }
                }
            } catch (err) {
                console.error('Poll error:', err.message);
                if (err.message.includes('WebSocket') || err.message.includes('closed') || err.message.includes('not open')) {
                    this.cdpConnection = null;
                }
            }
            setTimeout(poll, 2000); // Relaxed frequency to 2s
        };
        poll();
    }

    broadcastStatus() {
        this.broadcast({
            type: 'status_update',
            apiConnected: this.lastApiState,
            cdpConnected: this.lastCdpState
        });
    }

    broadcast(message) {
        const payload = JSON.stringify({ ...message, timestamp: new Date().toISOString() });
        this.wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        });
    }

    getConnection() {
        return this.cdpConnection;
    }

    getLastSnapshot() {
        return this.lastSnapshot;
    }
}

