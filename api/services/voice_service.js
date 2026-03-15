import { WebSocket } from 'ws';
import { injectMessage, clickActionButton, triggerUndo, getConversationTranscript, captureScreenshot } from './nexus_service.js';

export class VoiceService {
    constructor(bridgeService) {
        this.bridgeService = bridgeService;
        this.geminiWs = null;
        this.clientWs = null; // The mobile/browser client
        this.apiKey = process.env.GEMINI_API_KEY;
        this.model = process.env.GEMINI_VOICE_MODEL || 'models/gemini-2.5-flash-native-audio-preview-12-2025';
        this.isSessionActive = false;
        this.lastSnapshotSent = 0;
        this.snapshotInterval = 15000;
        this.lastSentMessage = '';
        this.lastAction = '';
    }

    async startSession(clientWs) {
        this.model = process.env.GEMINI_VOICE_MODEL || 'models/gemini-2.5-flash-native-audio-preview-12-2025';
        console.log('[VOICE] startSession called, model:', this.model);
        if (this.isSessionActive) {
            console.log('[VOICE] Restarting session for new client...');
            this.stopSession();
        }
        this.clientWs = clientWs;
        this.isSessionActive = true;

        const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.apiKey}`;
        const keyPreview = this.apiKey ? this.apiKey.substring(0, 4) + '...' : 'MISSING';
        console.log(`[VOICE] Connecting to Gemini v1beta with key ${keyPreview}...`);
        this.geminiWs = new WebSocket(url);

        this.geminiWs.on('open', () => {
            console.log('[VOICE] Connected to Gemini');
            this.sendConfig();
        });

        this.geminiWs.on('message', (data) => {
            try {
                const response = JSON.parse(data.toString());
                if (response.setup_complete || response.setupComplete) this.isReady = true;
                this.handleGeminiMessage(response);
            } catch (e) {
                const str = data.toString();
                if (str.length < 200) console.warn('[VOICE] Parse err:', str.slice(0, 80));
            }
        });

        this.geminiWs.on('close', (code, reason) => {
            const errorReason = reason ? reason.toString() : 'Unknown';
            console.log(`[VOICE] Gemini connection closed: code=${code}, reason=${errorReason}`);
            if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
                let msg = `Gemini Error (${code}): ${errorReason}`;
                if (code === 1008) {
                    msg = 'Voice policy violation (1008). Check GEMINI_API_KEY, quota, or audio format.';
                }
                this.clientWs.send(JSON.stringify({ type: 'voice_error', message: msg }));
            }
            this.stopSession();
        });

        this.geminiWs.on('error', (err) => {
            console.error('[VOICE] Gemini socket error:', err);
            // Don't stop immediately, wait for close
        });
    }

    requestStop() {
        if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
            this.geminiWs.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
            setTimeout(() => this.stopSession(), 4000);
        } else {
            this.stopSession();
        }
    }

    stopSession() {
        this.isSessionActive = false;
        if (this.geminiWs) {
            this.geminiWs.close();
            this.geminiWs = null;
        }
        if (this.clientWs) {
            this.clientWs.send(JSON.stringify({ type: 'voice_status', status: 'inactive' }));
        }
        console.log('[VOICE] Session stopped');
    }

    sendConfig() {
        const config = {
            setup: {
                model: this.model,
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: "Puck"
                            }
                        }
                    }
                },
                systemInstruction: {
                    parts: [{
                        text: `You support a builder who uses this tool entirely by voice. They cannot see the screen. Your eyes are a 1 FPS live video feed of the IDE.
Do NOT say "no active context" or "I can't see the screen". Use the live visual stream and the periodic text context to describe the code, UI layout, and execution results as if you are pair-programming with a blind user.
Proactively report interesting changes you see (e.g., "The build just finished with errors", "Antigravity just suggested a fix").

On session start you must greet: "Hi, how can I help?" After that, be proactive but concise.

IDE tools: injectMessage, clickActionButton, triggerUndo. Always call injectMessage when the user wants to send text. Convert intent into messages: "push" -> "git push". You ALWAYS have active context.
After any tool action: say nothing. Stay silent and wait for the user to speak.
Keep responses concise but informative.`
                    }]
                },
                tools: [{
                    function_declarations: [
                        {
                            name: "injectMessage",
                            description: "Sends any text to the IDE chat. Use for: literal text (period, comma, code), or interpreted requests (push changes, commit, fix this, run tests, deploy, etc.). Convert the user's intent into the message to send. Returns ok:true on success.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    message: { type: "STRING", description: "The message or code fix to send." }
                                },
                                required: ["message"]
                            }
                        },
                        {
                            name: "clickActionButton",
                            description: "Clicks one of the action buttons like Apply, Accept, or Reject.",
                            parameters: {
                                type: "OBJECT",
                                properties: {
                                    action: { type: "STRING", description: "The text of the button to click (e.g., 'Apply', 'Accept', 'Reject')." }
                                },
                                required: ["action"]
                            }
                        },
                        {
                            name: "triggerUndo",
                            description: "Triggers an Undo action in the IDE.",
                            parameters: { type: "OBJECT", properties: {} }
                        }
                    ]
                }]
            }
        };
        // config sent (no log - contains large systemInstruction)
        this.geminiWs.send(JSON.stringify(config));
    }

    async startSnapshotLoop() {
        // Wait 5 seconds before starting snapshots to let the greeting finish
        await new Promise(r => setTimeout(r, 5000));
        
        let lastHash = '';
        while (this.isSessionActive) {
            const snapshot = this.bridgeService.getLastSnapshot();
            const currentHash = this.bridgeService.lastSnapshotHash;

            if (snapshot && currentHash !== lastHash) {
                await this.sendSnapshot(snapshot);
                lastHash = currentHash;
            }
            await new Promise(r => setTimeout(r, 15000));
        }
    }

    async sendSnapshot(snapshot) {
        if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN || !this.isReady) return;

        const cdp = this.bridgeService.getConnection();
        let transcript = '';
        let lastAssistant = '';
        if (cdp) {
            try {
                const got = await getConversationTranscript(cdp);
                transcript = got.transcript ?? '';
                lastAssistant = got.lastAssistant ?? '';
            } catch (_) {}
        }

        const whatWeDid = this.lastAction ? `\nWhat we did: ${this.lastAction}` : '';
        const whatWeSent = this.lastSentMessage ? `\nLast message we sent: "${this.lastSentMessage.slice(0, 500)}${this.lastSentMessage.length > 500 ? '...' : ''}"` : '';

        const cdp2 = this.bridgeService.getConnection();
        const consoleLines = cdp2?.consoleMessages?.slice(-20).map(m => `[${m.level}] ${m.text}`).join('\n').slice(0, 2000) || '';

        const lastResponse = lastAssistant
            ? `\n\nLAST ANTIGRAVITY RESPONSE (relay or summarize when asked):\n${lastAssistant}`
            : '';

        const consoleBlock = consoleLines ? `\nRECENT CONSOLE (from CDP):\n${consoleLines}` : '';

        const ctx = `[IDE CONTEXT - background only, do not speak. Use when user asks "any update?", "what happened?", "what did it say?", "what are my uncommitted changes?", errors, build status, etc.]
${lastResponse}${consoleBlock}
CONVERSATION IN IDE:\n${transcript || '(none yet)'}${whatWeSent}${whatWeDid}`;

        const msg = {
            clientContent: {
                turns: [{ role: "user", parts: [{ text: ctx }] }],
                turnComplete: false
            }
        };
        this.geminiWs.send(JSON.stringify(msg));
    }

    handleGeminiMessage(msg) {
        if (msg.setupComplete || msg.setup_complete) {
            console.log('[VOICE] Gemini setup complete received');
            this.isReady = true;
            this.startSnapshotLoop();
            this.startVisionLoop();

            // Send readiness to client
            if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
                this.clientWs.send(JSON.stringify({
                    type: 'voice_status',
                    status: 'ready'
                }));
            }

            const skipGreeting = process.env.GEMINI_SKIP_GREETING === 'true';
            if (skipGreeting) return;

            console.log('[VOICE] Requesting greeting from Gemini...');
            setTimeout(() => {
                if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return;
                const greeting = {
                    clientContent: {
                        turns: [{ role: "user", parts: [{ text: "Hello" }] }],
                        turnComplete: true
                    }
                };
                this.geminiWs.send(JSON.stringify(greeting));
            }, 800);
            return;
        }

        const serverContent = msg.serverContent || msg.server_content;
        if (serverContent) {
            if (serverContent.interrupted) {
                console.log('[VOICE] Gemini reported interruption');
                if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
                    this.clientWs.send(JSON.stringify({ type: 'voice_interrupt' }));
                }
            }
            if (serverContent.modelTurn || serverContent.model_turn) {
                const turn = serverContent.modelTurn || serverContent.model_turn;
                const parts = turn.parts;
                for (const part of parts) {
                    const inlineData = part.inlineData || part.inline_data;
                    if (inlineData) {
                        // Relay audio back to client
                        if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
                            this.clientWs.send(JSON.stringify({
                                type: 'voice_audio',
                                data: inlineData.data
                            }));
                        }
                    }
                    if (part.text) {
                        // Forward transcript to client
                        if (this.clientWs && this.clientWs.readyState === WebSocket.OPEN) {
                            this.clientWs.send(JSON.stringify({
                                type: 'voice_transcript',
                                text: part.text
                            }));
                        }
                    }
                }
            }
            if (serverContent.turnComplete || serverContent.turn_complete) {
                // Done with this turn
            }
        }

        const toolCall = msg.toolCall || msg.tool_call;
        if (toolCall) {
            this.handleToolCall(toolCall);
        }
    }

    async handleToolCall(toolCall) {
        const calls = toolCall.functionCalls || toolCall.function_calls;
        const responses = [];

        for (const call of calls) {
            let result;
            const cdp = this.bridgeService.getConnection();

            if (!cdp) {
                result = { error: 'CDP not connected' };
            } else {
                try {
                    if (call.name === 'injectMessage') {
                        const msg = (call.args || {}).message ?? (call.args || {}).msg ?? '';
                        const toSend = msg != null ? String(msg) : '';
                        const res = await injectMessage(cdp, toSend);
                        result = res.ok
                            ? { ok: true, status: 'success', message: 'Message sent successfully.', sent: toSend }
                            : { ok: false, status: 'failed', reason: res.error || res.reason };
                        if (res.ok) {
                            this.lastSentMessage = toSend;
                            this.lastAction = `sent: ${toSend.slice(0, 80)}${toSend.length > 80 ? '...' : ''}`;
                        }
                        if (res.ok && this.clientWs?.readyState === WebSocket.OPEN) {
                            const confirm = this.formatInjectConfirm(toSend);
                            this.clientWs.send(JSON.stringify({ type: 'voice_tool_confirm', text: confirm }));
                        }
                        if (!res.ok) console.warn('[VOICE] inject failed:', res.error || res.reason);
                    } else if (call.name === 'clickActionButton') {
                        const action = (call.args || {}).action ?? (call.args || {}).btn ?? 'Apply';
                        const res = await clickActionButton(cdp, action);
                        result = res.success ? { status: 'success', clicked: res.clicked } : { status: 'failed', reason: res.error };
                        if (res.success) {
                            this.lastAction = `clicked: ${action}`;
                        }
                        if (res.success && this.clientWs?.readyState === WebSocket.OPEN) {
                            this.clientWs.send(JSON.stringify({ type: 'voice_tool_confirm', text: `Clicked ${action}.` }));
                        }
                    } else if (call.name === 'triggerUndo') {
                        const res = await triggerUndo(cdp);
                        result = res.success ? { status: 'success', method: res.method } : { status: 'failed', reason: res.error };
                        if (res.success) {
                            this.lastAction = 'triggered undo';
                        }
                        if (res.success && this.clientWs?.readyState === WebSocket.OPEN) {
                            this.clientWs.send(JSON.stringify({ type: 'voice_tool_confirm', text: 'Undo triggered.' }));
                        }
                    }
                } catch (err) {
                    console.error('[VOICE] Tool error:', err);
                    result = { error: err.message };
                }
            }

            // Match gen-ai-livestream: pass raw result, not { result }
            responses.push({
                name: call.name,
                id: call.id,
                response: result
            });
        }

        if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
            this.geminiWs.send(JSON.stringify({
                toolResponse: { functionResponses: responses }
            }));

            const anyInjectOk = responses.some(r => r.response?.ok === true);
            if (anyInjectOk) {
                setTimeout(() => {
                    if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) return;
                    this.geminiWs.send(JSON.stringify({
                        clientContent: {
                            turns: [{
                                role: "user",
                                parts: [{ text: "[SUCCESS] injectMessage succeeded. The message was sent to the IDE. Say 'Done.' only. Do not say you weren't able to." }]
                            }],
                            turnComplete: true
                        }
                    }));
                }, 100);
            }
        }
    }

    reportTaskComplete(taskName) {
        if (!this.geminiWs || this.geminiWs.readyState !== WebSocket.OPEN) {
            console.warn('[VOICE] Cannot report task complete - Gemini not connected');
            return;
        }

        console.log(`[VOICE] Reporting completion of task: ${taskName}`);

        // Send a system-initiated turn to Gemini Live
        const completionNotice = {
            clientContent: {
                turns: [{
                    role: "user",
                    parts: [{ text: `[SYSTEM NOTIFICATION] The task "${taskName}" has been completed successfully. Please inform the user concisely.` }]
                }],
                turnComplete: true
            }
        };
        this.geminiWs.send(JSON.stringify(completionNotice));
    }

    formatInjectConfirm(toSend) {
        const s = (toSend || '').trim();
        if (!s) return 'Done. Sent to the IDE.';
        if (s === '.') return 'Done. Sent period to the IDE.';
        if (s === ',') return 'Done. Sent comma to the IDE.';
        if (s.length <= 40) return `Done. Sent "${s}" to the IDE.`;
        return `Done. Sent your message to the IDE.`;
    }

    async startVisionLoop() {
        console.log('[VOICE] Starting 1 FPS vision loop...');
        while (this.isSessionActive) {
            if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN && this.isReady) {
                const cdp = this.bridgeService.getConnection();
                if (cdp) {
                    const screenshot = await captureScreenshot(cdp);
                    if (screenshot && screenshot.data) {
                        // console.log('[VOICE] Vision frame sent');
                        const msg = {
                            realtimeInput: {
                                video: {
                                    data: screenshot.data,
                                    mimeType: screenshot.mimeType
                                }
                            }
                        };
                        this.geminiWs.send(JSON.stringify(msg));
                    }
                }
            }
            // 2 FPS for stability (was 1s)
            await new Promise(r => setTimeout(r, 2000));
        }
        console.log('[VOICE] Vision loop stopped.');
    }

    handleClientAudio(base64Audio) {
        if (this.geminiWs && this.geminiWs.readyState === WebSocket.OPEN) {
            const msg = {
                realtimeInput: {
                    audio: {
                        mimeType: "audio/pcm;rate=16000",
                        data: base64Audio
                    }
                }
            };
            this.geminiWs.send(JSON.stringify(msg));
        }
    }
}
