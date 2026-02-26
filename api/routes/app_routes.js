import express from 'express';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import * as NexusService from '../services/nexus_service.js';
import { inspectUI } from '../../ui_inspector.js';
import { isPortOpen } from '../services/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createRoutes(bridgeService, appPassword, authToken, authCookieName) {
    const router = express.Router();

    // Login
    router.post('/login', (req, res) => {
        if (req.body.password === appPassword) {
            res.cookie(authCookieName, authToken, { httpOnly: true, signed: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
            res.json({ success: true });
        } else {
            res.status(401).json({ success: false, error: 'Invalid password' });
        }
    });

    // Logout
    router.post('/logout', (req, res) => {
        res.clearCookie(authCookieName);
        res.json({ success: true });
    });

    // Snapshot
    router.get('/snapshot', async (req, res) => {
        const snapshot = bridgeService.getLastSnapshot();
        const cdp = bridgeService.getConnection();
        const apiAlive = await isPortOpen(8000);
        if (!snapshot) return res.status(503).json({ error: 'No snapshot available', cdpConnected: !!cdp, apiConnected: apiAlive });
        res.json({ ...snapshot, cdpConnected: !!cdp, apiConnected: apiAlive });
    });

    // Health
    router.get('/health', async (req, res) => {
        const apiAlive = await isPortOpen(8000);
        res.json({
            status: 'ok',
            cdpConnected: !!bridgeService.getConnection(),
            apiConnected: apiAlive,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });

    // Interactivity Routes
    const cdpWrapper = (fn) => async (req, res) => {
        const cdp = bridgeService.getConnection();
        if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
        try {
            const result = await fn(cdp, req.body || req.query);
            res.json(result);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    };

    router.post('/send', cdpWrapper((cdp, body) => NexusService.injectMessage(cdp, body.message)));
    router.post('/stop', cdpWrapper((cdp) => NexusService.stopGeneration(cdp)));
    router.post('/set-mode', cdpWrapper((cdp, body) => NexusService.setMode(cdp, body.mode)));
    router.post('/set-model', cdpWrapper((cdp, body) => NexusService.setModel(cdp, body.model)));
    router.post('/new-chat', cdpWrapper((cdp) => NexusService.startNewChat(cdp)));
    router.post('/select-chat', cdpWrapper((cdp, body) => NexusService.selectChat(cdp, body.chatTitle)));
    router.get('/chat-history', cdpWrapper((cdp) => NexusService.getChatHistory(cdp)));
    router.get('/app-state', cdpWrapper((cdp) => NexusService.getAppState(cdp)));
    router.post('/remote-click', cdpWrapper((cdp, body) => NexusService.clickElement(cdp, body)));

    // Remote Action Relay (Apply/Accept/Reject buttons)
    router.post('/relay-action', cdpWrapper((cdp, body) => NexusService.clickActionButton(cdp, body.action)));
    router.post('/undo', cdpWrapper((cdp) => NexusService.triggerUndo(cdp)));

    // File Peek Utility
    router.get('/file-peek', (req, res) => {
        const filePath = req.query.path;
        if (!filePath) return res.status(400).json({ error: 'No path' });
        const projectRoot = join(__dirname, '../../..');
        const resolved = join(projectRoot, filePath);
        try {
            if (!fs.existsSync(resolved)) return res.status(404).json({ error: 'Not found' });
            const content = fs.readFileSync(resolved, 'utf8');
            res.json({ success: true, path: filePath, content });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Image Upload
    router.post('/upload-image', async (req, res) => {
        const cdp = bridgeService.getConnection();
        if (!cdp) return res.status(503).json({ error: 'CDP not connected' });
        const { imageBase64, filename } = req.body;
        const base64Data = imageBase64?.replace(/^data:image\/\w+;base64,/, "");
        if (!base64Data) return res.status(400).json({ error: 'No image data' });

        const tmppath = join(__dirname, `../../upload_${Math.random().toString(36).substring(7)}.png`);
        fs.writeFileSync(tmppath, base64Data, { encoding: 'base64' });

        try {
            const doc = await cdp.call('DOM.getDocument', {});
            const input = await cdp.call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type="file"]' });
            if (input.nodeId) {
                await cdp.call('DOM.setFileInputFiles', { files: [tmppath], nodeId: input.nodeId });
                res.json({ success: true });
            } else res.status(400).json({ error: 'No input found' });
        } catch (e) { res.status(500).json({ error: e.message }); }
        finally { setTimeout(() => { try { fs.unlinkSync(tmppath); } catch (e) { } }, 5000); }
    });

    // Boot Server
    router.post('/boot-server', (req, res) => {
        try {
            const projectRoot = join(__dirname, '../../..');
            const proc = spawn('./dev.sh', [], { cwd: projectRoot, detached: true, stdio: 'ignore' });
            proc.unref();
            res.json({ success: true, message: "Nexus Server Booting..." });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    router.post('/remote-scroll', async (req, res) => {
        const cdp = bridgeService.getConnection();
        if (!cdp) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await NexusService.remoteScroll(cdp, req.body);

        // Trigger fast update
        setTimeout(async () => {
            const snapshot = await NexusService.captureSnapshot(cdp);
            if (snapshot && !snapshot.error) {
                bridgeService.lastSnapshot = snapshot;
                bridgeService.broadcast({ type: 'snapshot_update' });
            }
        }, 300);
        res.json(result);
    });

    // Specialized Logic
    router.get('/local-img', (req, res) => {
        let p = req.query.path;
        if (!p) return res.status(400).send('No path');
        try {
            if (p.startsWith('file://')) p = new URL(p).pathname;
            else if (/^vscode-(?:file|webview-resource|resource|vfs|remote):\/\//.test(p)) {
                const match = p.match(/^vscode-(?:file|webview-resource|resource|vfs|remote):\/\/[^\/]+(\/.*)$/);
                if (match) p = match[1];
            }
            p = decodeURIComponent(p);
            if (fs.existsSync(p)) return res.sendFile(p);
            return res.status(404).send('Not found');
        } catch (e) { res.status(500).send(e.toString()); }
    });

    router.get('/debug-ui', async (req, res) => {
        const cdp = bridgeService.getConnection();
        if (!cdp) return res.status(503).json({ error: 'CDP not connected' });
        res.json(await inspectUI(cdp));
    });

    return router;
}
