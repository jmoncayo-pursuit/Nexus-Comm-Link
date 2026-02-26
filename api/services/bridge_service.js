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
        console.log('🔍 Discovering Nexus CDP endpoint...');
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
            console.warn(`⚠️  CDP discovery failed: ${err.message}`);
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
                    console.log('🔍 Looking for Nexus CDP connection...');
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
                        const htmlForHash = snapshot.html
                            .replace(/id="[^"]*P0-\d+[^"]*"/g, '')
                            .replace(/data-tooltip-id="[^"]*"/g, '')
                            .replace(/data-headlessui-state="[^"]*"/g, '')
                            .replace(/\s+/g, ' ');

                        const hash = hashString(htmlForHash);
                        if (hash !== this.lastSnapshotHash) {
                            this.lastSnapshot = snapshot;
                            this.lastSnapshotHash = hash;
                            this.broadcast({ type: 'snapshot_update' });
                            console.log(`📸 Snapshot updated (hash: ${hash})`);
                        }
                    } else {
                        const now = Date.now();
                        if (now - this.lastErrorLog > 10000) {
                            console.warn(`⚠️  Snapshot capture issue: ${snapshot?.error || 'No valid snapshot'}`);
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
            setTimeout(poll, this.pollInterval);
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

