#!/usr/bin/env node
import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { BridgeService } from './api/services/bridge_service.js';
import { killPortProcess, hashString, isLocalRequest, getAllLocalIPs } from './api/services/utils.js';
import { createRoutes } from './api/routes/app_routes.js';
import { VoiceService } from './api/services/voice_service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SERVER_PORT = process.env.PORT || 3131;
const APP_PASSWORD = process.env.APP_PASSWORD || 'nexus';
const COOKIE_SECRET = process.env.APP_SECRET || 'nexus_secret_key_v2';
const AUTH_COOKIE_NAME = 'nexus_auth_token';
const AUTH_TOKEN = hashString(APP_PASSWORD + 'nexus_salt_v2');

async function main() {
    console.log('🚀 Initializing Nexus Comm-Link...');

    // 1. Cleanup old processes
    await killPortProcess(SERVER_PORT);

    // 2. Setup Express & Middleware
    const app = express();
    const keyPath = join(__dirname, 'certs', 'server.key');
    const certPath = join(__dirname, 'certs', 'server.cert');
    const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

    const server = hasSSL
        ? https.createServer({ key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) }, app)
        : http.createServer(app);

    const wss = new WebSocketServer({ server });
    const bridge = new BridgeService(wss);
    const voiceService = new VoiceService(bridge);

    app.use(compression());
    app.use(express.json({ limit: '50mb' }));
    app.use(cookieParser(COOKIE_SECRET));

    // 3. Security & Auth Middleware
    app.use((req, res, next) => {
        res.setHeader('ngrok-skip-browser-warning', 'true');

        const publicPaths = ['/login', '/login.html', '/favicon.ico'];
        if (publicPaths.includes(req.path) || req.path.startsWith('/css/') || isLocalRequest(req)) {
            return next();
        }

        // Magic Link
        if (req.query.key === APP_PASSWORD && APP_PASSWORD !== 'nexus') {
            res.cookie(AUTH_COOKIE_NAME, AUTH_TOKEN, { httpOnly: true, signed: true, maxAge: 30 * 24 * 60 * 60 * 1000, sameSite: 'lax' });
            return res.redirect('/');
        }

        if (req.signedCookies[AUTH_COOKIE_NAME] === AUTH_TOKEN) return next();

        if (req.xhr || req.headers.accept?.includes('json')) return res.status(401).json({ error: 'Unauthorized' });
        res.redirect('/login.html');
    });

    // 4. Routes & Statics
    app.use(express.static(join(__dirname, 'public')));
    app.use('/', createRoutes(bridge, voiceService, APP_PASSWORD, AUTH_TOKEN, AUTH_COOKIE_NAME));

    // 5. WebSocket Handlers
    wss.on('error', (err) => console.error('👻 WebSocket Server Error:', err));

    wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress;
        console.log(`📡 New WebSocket connection attempt from: ${ip}`);

        ws.on('error', (err) => console.error('📱 WebSocket Peer Error:', err));

        if (!isLocalRequest(req)) {
            const rawCookies = req.headers.cookie || '';
            const token = rawCookies.split(';').find(c => c.trim().startsWith(AUTH_COOKIE_NAME))?.split('=')[1];
            const decoded = token ? cookieParser.signedCookie(decodeURIComponent(token), COOKIE_SECRET) : null;
            if (decoded !== AUTH_TOKEN) {
                console.log(`📡 WebSocket auth failed for ${ip} (remote access requires login)`);
                ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
                return setTimeout(() => ws.close(1008, 'Policy violation: authentication required'), 100);
            }
        }
        console.log('📱 Client connected (Authenticated)');

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                if (data.type !== 'voice_audio') console.log('📬', data.type);
                if (data.type === 'voice_start') {
                    voiceService.startSession(ws);
                } else if (data.type === 'voice_stop') {
                    voiceService.requestStop();
                } else if (data.type === 'voice_audio') {
                    voiceService.handleClientAudio(data.data);
                }
            } catch (e) {
                // Ignore non-JSON or other errors
            }
        });

        ws.on('close', () => {
            voiceService.stopSession();
        });
    });

    // 6. Start Services
    server.listen(SERVER_PORT, () => {
        const protocol = hasSSL ? 'https' : 'http';
        const ips = getAllLocalIPs();
        console.log(`📡 Server active at ${protocol}://localhost:${SERVER_PORT}`);
        ips.forEach(ip => {
            console.log(`📱 Mobile Link: ${protocol}://${ip}:${SERVER_PORT}`);
        });
    });

    bridge.startPolling();
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch(err => {
    console.error('💥 Fatal Crash:', err);
    process.exit(1);
});
