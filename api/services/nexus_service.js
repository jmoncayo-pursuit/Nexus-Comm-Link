import { SecurityService } from './security_service.js';
const security = new SecurityService();

async function cdpEval(cdp, expression, opts = {}) {
    const contexts = cdp.contexts || [{ id: undefined }];
    for (const ctx of contexts) {
        try {
            const params = { expression, returnByValue: true, ...opts };
            if (ctx.id !== undefined) params.contextId = ctx.id;
            else delete params.contextId;
            const res = await cdp.call("Runtime.evaluate", params);
            if (res.result && Object.prototype.hasOwnProperty.call(res.result, 'value')) {
                return res.result.value;
            }
            if (res.exceptionDetails) continue;
        } catch (e) { }
    }
    return null;
}

export async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(() => {
        const q = (s) => document.querySelector(s);
        const qa = (s) => Array.from(document.querySelectorAll(s));
        
        let cascade = document.getElementById('conversation') || 
                      document.getElementById('chat') || 
                      document.getElementById('cascade') ||
                      q('[class*="conversation-area"]') ||
                      q('[class*="chat-container"]') ||
                      q('main div[class*="flex-col"]') ||
                      q('.cascade') ||
                      qa('div').find(d => (d.className + "").includes('message') || (d.className + "").includes('chat'))?.parentElement;

        if (!cascade) {
            return { error: 'chat container not found', title: document.title, url: window.location.href };
        }
        
        const cascadeStyles = window.getComputedStyle(cascade);
        const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
        const scrollInfo = {
            scrollTop: scrollContainer.scrollTop,
            scrollHeight: scrollContainer.scrollHeight,
            clientHeight: scrollContainer.clientHeight,
            scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
        };

        const isGenerating = !!(
            document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]') ||
            document.querySelector('button svg.lucide-square')
        );
        
        const clone = cascade.cloneNode(true);
        
        try {
            const interactionSelectors = [
                '.relative.flex.flex-col.gap-8',
                '.flex.grow.flex-col.justify-start.gap-8',
                'div[class*="interaction-area"]',
                '.p-1.bg-gray-500\\/10',
                '.outline-solid.justify-between',
                '[contenteditable="true"]'
            ];

            interactionSelectors.forEach(selector => {
                clone.querySelectorAll(selector).forEach(el => {
                    try {
                        if (selector === '[contenteditable="true"]') {
                            const area = el.closest('.relative.flex.flex-col.gap-8') || 
                                         el.closest('.flex.grow.flex-col.justify-start.gap-8') ||
                                         el.closest('div[id^="interaction"]') ||
                                         el.parentElement?.parentElement;
                            if (area && area !== clone) area.remove();
                            else el.remove();
                        } else {
                            el.remove();
                        }
                    } catch(e) {}
                });
            });

            const allElements = clone.querySelectorAll('*');
            allElements.forEach(el => {
                try {
                    const text = (el.innerText || '').toLowerCase();
                    if (text.includes('files with changes') || text.includes('context found')) {
                        if (el.children.length < 10 || el.querySelector('button') || el.classList?.contains('justify-between')) {
                            el.style.display = 'none';
                            el.remove();
                        }
                    }
                } catch (e) {}
            });

            const allDivs = Array.from(clone.querySelectorAll('div'));
            for (let i = allDivs.length - 1; i >= 0; i--) {
                const el = allDivs[i];
                try {
                    if (!el.textContent.trim() && el.querySelectorAll('img, svg').length === 0) {
                        el.remove();
                    }
                } catch(e) {}
            }

            clone.querySelectorAll('[class*="cursor"], [class*="cursor-container"], [style*="visibility: hidden"], .decorationsOverviewRuler').forEach(el => el.remove());

            clone.querySelectorAll('img, svg, i, span[class*="icon"], span[class*="codicon"]').forEach(el => {
                const attrStr = (el.outerHTML || '').toLowerCase();
                const isVSCode = attrStr.includes('vscode') || attrStr.includes('extension') || attrStr.includes('icon');
                
                if (el.tagName === 'IMG') {
                    const src = (el.getAttribute('src') || '').toLowerCase();
                    if (isVSCode || src.length < 500) { 
                        if (!src.startsWith('data:image/')) el.remove();
                    }
                } else if (!el.innerText.trim()) {
                    el.remove();
                } else if (isVSCode) {
                    el.style.backgroundImage = 'none';
                    el.style.maskImage = 'none';
                    el.style.webkitMaskImage = 'none';
                }
            });

            clone.querySelectorAll('[data-src]').forEach(el => {
                const src = el.getAttribute('data-src');
                if (src && !src.startsWith('data:') && !src.startsWith('blob:') && !src.startsWith('http')) {
                    el.setAttribute('src', '/local-img?path=' + encodeURIComponent(src));
                    el.setAttribute('data-src', '/local-img?path=' + encodeURIComponent(src));
                }
            });

            clone.querySelectorAll('.xterm, [class*="terminal"], [class*="console"]').forEach(term => {
                const innerText = (term.innerText || '').trim();
                const looksLikeCommand = innerText.includes('Exit code') || innerText.includes('Output') || term.classList.contains('xterm');
                if (!looksLikeCommand) return;

                let terminalText = term.innerText
                    .replace(/Always run/gi, '')
                    .replace(/Exit code\s*[0-9]*/gi, '')
                    .replace(/Copy contents/gi, '')
                    .trim();

                if (!terminalText || terminalText.length < 5) {
                    term.remove();
                    return;
                }

                term.innerHTML = '';
                const header = document.createElement('div');
                header.className = 'nexus-terminal-header';
                header.innerHTML = '<span style="font-family:Orbitron, sans-serif; font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-left: 12px;">' + (innerText.includes('Exit code') ? 'System Log' : 'Output') + '</span>';
                
                const contextBtn = document.createElement('div');
                contextBtn.className = 'nexus-terminal-context-btn';
                contextBtn.innerHTML = '<span>COUPLE CONTEXT</span>';
                contextBtn.setAttribute('data-context-payload', terminalText);
                header.appendChild(contextBtn);
                term.appendChild(header);

                const pre = document.createElement('pre');
                pre.style.cssText = 'color:#fff; background:#000; padding:16px; margin:0; font-family:"JetBrains Mono", monospace; font-size:13px; line-height:1.5; white-space:pre-wrap; word-break:break-all; border:1px solid #334155; border-top:none; border-radius:0 0 6px 6px;';
                pre.innerText = terminalText;
                term.appendChild(pre);
                term.style.cssText = 'display:block; background:#000; overflow:hidden; margin:12px 0; width:100%; box-sizing:border-box; position:relative !important;';
            });

            clone.querySelectorAll('button, div, span, p').forEach(el => {
                const txt = (el.innerText || '').trim().toLowerCase();
                if (txt === 'always run' || txt.includes('exit code') || (txt.includes('copy') && txt.length < 15)) {
                    if (!el.querySelector('pre, code, .nexus-terminal-header')) el.remove();
                }
            });

            clone.querySelectorAll('pre:not(.nexus-terminal-header + pre)').forEach(pre => {
                const txt = pre.innerText;
                if (txt.length > 10 && !pre.closest('.nexus-terminal-header')) {
                    pre.style.position = 'relative';
                    const trigger = document.createElement('div');
                    trigger.className = 'nexus-terminal-context-btn';
                    trigger.innerHTML = '<span>COUPLE</span>';
                    trigger.style.cssText = 'position:absolute; top:4px; right:4px; transform:scale(0.8); z-index:100;';
                    trigger.setAttribute('data-context-payload', txt);
                    pre.appendChild(trigger);
                }
            });

            clone.querySelectorAll('*').forEach(el => {
                if (el.children.length === 0) {
                    const txt = (el.innerText || '').toLowerCase();
                    if (txt.includes('copy') || txt.includes('paste') || (txt === 'contents' && el.previousElementSibling?.innerText?.toLowerCase().includes('copy'))) {
                        el.remove();
                    }
                }
            });

            clone.querySelectorAll('pre').forEach(el => {
                el.style.maxWidth = '100% !important';
                el.style.overflowX = 'auto !important';
                el.style.background = '#000 !important';
                el.style.color = '#fff !important';
                el.style.padding = '12px !important';
                el.style.borderRadius = '4px !important';
                el.style.boxSizing = 'border-box !important';
                el.style.whiteSpace = 'pre-wrap !important';
                el.style.wordBreak = 'break-all !important';
            });
        } catch (globalErr) { }

        try {
            clone.querySelectorAll('button, [role="button"], div[class*="btn"], span[class*="btn"]').forEach((btn, idx) => {
                const txt = (btn.textContent || '').trim();
                if (/^(Apply|Accept|Reject|Accept All|Reject All|Apply All|Apply Changes|Accept Changes|Reject Changes|Run|Approve)$/i.test(txt) ||
                    (txt.length < 40 && /\b(Apply|Accept|Reject)\b/i.test(txt) && !txt.includes('cookie') && !txt.includes('privacy'))) {
                    btn.setAttribute('data-nexus-action', txt);
                    btn.setAttribute('data-nexus-action-idx', String(idx));
                    const existingClass = btn.getAttribute('class') || '';
                    btn.setAttribute('class', existingClass + ' nexus-action-relay');
                }
            });
        } catch (actionErr) { }

        const html = clone.outerHTML;
        const rules = [];
        for (const sheet of document.styleSheets) {
            try {
                for (const rule of sheet.cssRules) { rules.push(rule.cssText); }
            } catch (e) { }
        }
        const allCSS = rules.join('\\n');
        
        return {
            html, css: allCSS,
            backgroundColor: cascadeStyles.backgroundColor,
            color: cascadeStyles.color,
            fontFamily: cascadeStyles.fontFamily,
            scrollInfo,
            stats: {
                nodes: clone.getElementsByTagName('*').length,
                htmlSize: html.length,
                cssSize: allCSS.length,
                isGenerating
            }
        };
    })()`;

    const val = await cdpEval(cdp, CAPTURE_SCRIPT);
    if (val && !val.error) {
        const rewrite = (str) => str.replace(/url\(['"]?(vscode-(?:file|webview-resource|remote|resource|vfs):\/\/[^'"]+)['"]?\)/gi, (m, url) => `url('/local-img?path=${encodeURIComponent(url)}')`)
            .replace(/src=['"](vscode-(?:file|webview-resource|remote|resource|vfs):\/\/[^'"]+)['"]/gi, (m, url) => `src="/local-img?path=${encodeURIComponent(url)}"`);
        if (val.css) val.css = rewrite(val.css);
        if (val.html) val.html = rewrite(val.html);
    }
    return val;
}

/**
 * Captures a visual screenshot of the IDE's current view.
 * Optimized for Gemini Live (JPEG, quality 40, ~768px width)
 */
export async function captureScreenshot(cdp) {
    try {
        // We get the viewport size first to scale it down (Gemini prefers ~768px for vision)
        const layout = await cdp.call("Page.getLayoutMetrics");
        const viewport = layout.cssVisualViewport;
        const width = viewport.clientWidth;
        const height = viewport.clientHeight;

        // Take the screenshot via CDP
        const res = await cdp.call("Page.captureScreenshot", {
            format: "jpeg",
            quality: 40, // Low quality for fast streaming
            optimizeForSpeed: true
        });

        if (res && res.data) {
            return {
                data: res.data, // Base64
                mimeType: "image/jpeg",
                width,
                height
            };
        }
    } catch (e) {
        console.error('[nexus-service] Screenshot failed:', e);
    }
    return null;
}

export async function getConversationTranscript(cdp) {
    const EXP = `(() => {
        const root = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade') ||
            document.querySelector('[class*="conversation-area"]') || document.querySelector('[class*="chat-container"]');
        if (!root) return { transcript: '', lastAssistant: '' };
        const full = root.innerText.trim().slice(0, 8000);
        let lastAssistant = '';
        const assistantSel = '[class*="assistant"], [class*="model"], [class*="bot"], [data-role="assistant"], [class*="ai-message"]';
        const blocks = root.querySelectorAll(assistantSel);
        if (blocks.length) {
            const last = blocks[blocks.length - 1];
            lastAssistant = (last.innerText || '').trim().slice(0, 6000);
        }
        if (!lastAssistant) {
            const parts = full.split(/\\n{2,}/);
            if (parts.length >= 2) lastAssistant = parts[parts.length - 1].trim().slice(0, 6000);
        }
        return { transcript: full, lastAssistant };
    })()`;
    const res = await cdpEval(cdp, EXP);
    return { transcript: res?.transcript ?? '', lastAssistant: res?.lastAssistant ?? '' };
}

export function isSafe(text) {
    return security.validatePrompt(text);
}

export async function injectMessage(cdp, text) {
    const safe = String(text ?? '');
    
    // BUNKER CHECK: Stop shell injection attempts
    if (!isSafe(safe)) {
        console.warn('🛡️ [BUNKER] Blocked potentially dangerous injection:', safe.substring(0, 100));
        return { ok: false, error: "security_violation", reason: "The request contains potentially destructive commands and was blocked for your protection." };
    }

    const safeText = JSON.stringify(safe);
    const EXPRESSION = `(async () => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy" };

        const roots = ['#conversation','#chat','#cascade','[class*="conversation-area"]','[class*="chat-container"]'];
        let editors = [];
        for (const sel of roots) {
            const root = typeof sel === 'string' && sel.startsWith('#') ? document.getElementById(sel.slice(1)) : document.querySelector(sel);
            if (root) {
                const list = root.querySelectorAll('[contenteditable="true"]');
                list.forEach(el => { if (el.offsetParent !== null) editors.push(el); });
            }
        }
        const editor = editors.length ? editors[editors.length - 1] : null;
        if (!editor) return { ok:false, error:"editor_not_found" };

        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);

        const toInsert = ${safeText};
        let inserted = false;
        try { inserted = !!document.execCommand?.("insertText", false, toInsert); } catch(e) {}
        if (!inserted) {
            editor.textContent = toInsert;
            editor.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data: toInsert }));
        }

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const submit = document.querySelector("svg.lucide-arrow-right")?.closest("button") ||
            document.querySelector("button[aria-label*='Send'], button[aria-label*='send']");
        if (submit && !submit.disabled) {
            submit.click();
            return { ok:true, method:"click_submit" };
        }
        editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key:"Enter", code:"Enter" }));
        return { ok:true, method:"enter_keypress" };
    })()`;

    const result = await cdpEval(cdp, EXPRESSION, { awaitPromise: true });
    return result || { ok: false, reason: "no_context" };
}

export async function setMode(cdp, mode) {
    const EXP = `(async () => {
        try {
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => el.children.length === 0 && (el.textContent.trim() === 'Fast' || el.textContent.trim() === 'Planning'));
            let modeBtn = null;
            for (const el of candidates) {
                let current = el;
                for (let i = 0; i < 4; i++) {
                    if (!current) break;
                    if (window.getComputedStyle(current).cursor === 'pointer' || current.tagName === 'BUTTON') {
                        modeBtn = current; break;
                    }
                    current = current.parentElement;
                }
                if (modeBtn) break;
            }
            if (!modeBtn) return { error: 'Mode button not found' };
            if (modeBtn.innerText.includes('${mode}')) return { success: true, alreadySet: true };
            modeBtn.click();
            await new Promise(r => setTimeout(r, 600));
            let dialog = Array.from(document.querySelectorAll('[role="dialog"], div'))
                .find(d => d.offsetHeight > 0 && d.innerText.includes('${mode}') && !d.innerText.includes('Files With Changes'));
            if (!dialog) return { error: 'Dialog not found' };
            const target = Array.from(dialog.querySelectorAll('*')).find(el => el.children.length === 0 && el.textContent.trim() === '${mode}');
            if (target) { target.click(); return { success: true }; }
            return { error: 'Option not found' };
        } catch(err) { return { error: err.toString() }; }
    })()`;

    return await cdpEval(cdp, EXP, { awaitPromise: true }) || { error: 'Context failed' };
}

export async function stopGeneration(cdp) {
    const EXP = `(() => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) { cancel.click(); return { success: true }; }
        const stopBtn = document.querySelector('button svg.lucide-square')?.closest('button');
        if (stopBtn && stopBtn.offsetParent !== null) { stopBtn.click(); return { success: true }; }
        return { error: 'No active generation' };
    })()`;

    const res = await cdpEval(cdp, EXP);
    return res || { error: 'Context failed' };
}

export async function clickElement(cdp, { selector, index, textContent }) {
    const EXP = `(() => {
        try {
            if ('${textContent}'.includes('Thought')) {
                const thoughtEl = [...document.querySelectorAll('summary, button, div')].find(el => el.textContent.includes('Thought') && el.offsetParent !== null);
                if (thoughtEl) return { success: !!thoughtEl.click() || true };
            }
            let elements = Array.from(document.querySelectorAll('${selector}'));
            const target = elements[${index}];
            if (target) return { success: !!target.click() || true };
            return { error: 'Element not found' };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    const res = await cdpEval(cdp, EXP);
    return res?.success ? res : { error: 'Click failed' };
}

// === REMOTE ACTION RELAY ===
// Robust button finder for Apply/Accept/Reject actions
export async function clickActionButton(cdp, actionText) {
    // BUNKER CHECK: Prevent clicking destructive UI buttons
    const dangerousActions = ['delete', 'wipe', 'format', 'erase', 'purge', 'destroy', 'terminate'];
    if (dangerousActions.some(d => String(actionText).toLowerCase().includes(d))) {
        console.warn('🛡️ [BUNKER] Blocked destructive action click:', actionText);
        return { error: 'security_violation', reason: 'Destructive clicks are disabled in bridged mode.' };
    }

    const safeText = JSON.stringify(actionText);
    const EXP = `(() => {
        try {
            const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
                .filter(b => b.offsetParent !== null && b.offsetHeight > 0);

            // Priority 1: Exact text match
            let target = allBtns.find(b => b.textContent.trim() === ${safeText});

            // Priority 2: Starts-with match (handles "Apply to file.js" patterns)
            if (!target) {
                target = allBtns.find(b => {
                    const t = b.textContent.trim();
                    return t.toLowerCase().startsWith(${safeText}.toLowerCase()) && t.length < 60;
                });
            }

            // Priority 3: Contains match (fuzzy)
            if (!target) {
                target = allBtns.find(b => {
                    const t = b.textContent.trim().toLowerCase();
                    return t.includes(${safeText}.toLowerCase()) && t.length < 60;
                });
            }

            // Priority 4: Aria-label match
            if (!target) {
                target = allBtns.find(b => {
                    const label = (b.getAttribute('aria-label') || '').toLowerCase();
                    return label.includes(${safeText}.toLowerCase());
                });
            }

            if (target) {
                target.scrollIntoView({ block: 'center', behavior: 'smooth' });
                target.click();
                return {
                    success: true,
                    clicked: target.textContent.trim().substring(0, 50),
                    method: 'text_match'
                };
            }

            // Not found — return diagnostic info
            const visible = allBtns.slice(0, 20).map(b => b.textContent.trim().substring(0, 40));
            return {
                error: 'Action button not found',
                searched: ${safeText},
                visibleButtons: visible
            };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    const res = await cdpEval(cdp, EXP);
    return res || { error: 'No CDP context available' };
}

export async function getScrollDebugInfo(cdp) {
    const EXP = `(() => {
        const root = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade');
        if (!root) return { error: 'No root' };
        const inner = root.querySelector('.overflow-y-auto, [data-scroll-area], [class*="overflow-y-auto"]');
        return {
            rootId: root.id || root.className?.slice(0, 50),
            rootScroll: { scrollTop: root.scrollTop, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight },
            innerFound: !!inner,
            innerScroll: inner ? { scrollTop: inner.scrollTop, scrollHeight: inner.scrollHeight, clientHeight: inner.clientHeight } : null
        };
    })()`;
    return await cdpEval(cdp, EXP);
}

export async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    const sp = scrollPercent;
    const st = scrollTop;
    const EXP = `(() => {
        try {
            const root = document.getElementById('conversation') || document.getElementById('chat') || document.getElementById('cascade') ||
                document.querySelector('[class*="conversation-area"]') || document.querySelector('[class*="chat-container"]') ||
                document.querySelector('main div[class*="flex-col"]');
            if (!root) return { error: 'No chat container' };
            let target = root.querySelector('.overflow-y-auto, [data-scroll-area], [class*="overflow-y-auto"], [class*="overflow"]');
            if (!target) target = root;
            let scrollables = [target];
            root.querySelectorAll('[class*="overflow-y-auto"], [class*="overflow-auto"], .overflow-y-auto, [data-scroll-area]').forEach(el => {
                if (el.scrollHeight > el.clientHeight + 20 && !scrollables.includes(el)) scrollables.push(el);
            });
            const maxSh = Math.max(...scrollables.map(el => el.scrollHeight));
            target = scrollables.find(el => el.scrollHeight === maxSh) || target;
            const max = target.scrollHeight - target.clientHeight;
            if (max <= 0) return { success: true };
            const newTop = ${sp} != null ? max * ${sp} : (${st ?? 0});
            target.scrollTop = Math.round(newTop);
            return { success: true };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    const res = await cdpEval(cdp, EXP);
    if (!res?.success) {
        console.warn('[remote-scroll] CDP failed:', res?.error);
    }
    return res?.success ? res : { error: res?.error || 'Scroll failed' };
}

export async function setModel(cdp, modelName) {
    const EXP = `(async () => {
        try {
            const btn = document.querySelector('[data-tooltip-id*="model"]') || Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Gemini') || b.innerText.includes('Claude'));
            if (!btn) return { error: 'Model button not found' };
            btn.click(); await new Promise(r => setTimeout(r, 600));
            const dialog = document.querySelector('[role="dialog"], [role="listbox"], [data-radix-popper-content-wrapper]');
            if (!dialog) return { error: 'Dialog not found' };
            const target = Array.from(dialog.querySelectorAll('*')).find(el => el.children.length === 0 && (el.textContent.trim() === '${modelName}' || el.textContent.includes('${modelName}')));
            if (target) { target.click(); return { success: true }; }
            return { error: 'Model not found' };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    return await cdpEval(cdp, EXP, { awaitPromise: true }) || { error: 'Context failed' };
}

export async function startNewChat(cdp) {
    const EXP = `(() => {
        const btn = document.querySelector('[data-tooltip-id="new-conversation-tooltip"]') || Array.from(document.querySelectorAll('button')).find(b => b.querySelector('svg.lucide-plus') && b.getBoundingClientRect().top < 200);
        if (btn) { btn.click(); return { success: true }; }
        return { error: 'New chat button not found' };
    })()`;

    const res = await cdpEval(cdp, EXP);
    return res?.success ? res : { error: 'Context failed' };
}

export async function getChatHistory(cdp) {
    const EXP = `(async () => {
        try {
            const btn = document.querySelector('[data-tooltip-id*="history"]') || Array.from(document.querySelectorAll('button')).find(b => b.querySelector('svg.lucide-clock'));
            if (!btn) return { error: 'History button not found' };
            
            // Re-open if closed or ensure it is open
            if (btn.getAttribute('aria-expanded') !== 'true') {
                btn.click(); await new Promise(r => setTimeout(r, 1000));
            }

            const search = Array.from(document.querySelectorAll('input')).find(i => i.placeholder?.toLowerCase().includes('conversation'));
            let panel = search?.parentElement;
            for(let i=0; i<10 && panel; i++) { if(panel.offsetHeight > 100) break; panel = panel.parentElement; }
            if (!panel) return { error: 'Panel not found', blocks: [] };
            
            const timeHeaders = /^(today|yesterday|previous|last|(\\d+\\s*(min|hr|day|wk|mo)s?\\s*ago)|current|other conversations|recent in .*)$/i;
            const blocks = []; const seen = new Set();
            
            // Capture all relevant title/header text elements in the panel in visual order
            const elements = Array.from(panel.querySelectorAll('span, div[class*="title"], div[class*="label"]'));
            
            for (const el of elements) {
                const text = el.textContent.trim();
                if (text.length < 2 || seen.has(text)) continue;
                
                // Identify headers (labels for groups)
                if (timeHeaders.test(text)) {
                    blocks.push({ type: 'header', title: text });
                    seen.add(text);
                    continue;
                }

                // Identify Chat Items
                const container = el.closest('div[role="button"]') || el.closest('div[class*="item"]');
                if (container && !text.includes('Show ') && !text.includes('more')) {
                    const isActive = container.className?.includes('selected') || 
                                     container.className?.includes('active') || 
                                     container.getAttribute('aria-selected') === 'true' ||
                                     container.style.background?.includes('rgb(2'); 

                    blocks.push({ 
                        type: 'chat', 
                        title: text, 
                        active: !!isActive,
                        project: container.querySelector('[class*="description"], [class*="desc"]')?.textContent.trim() || ''
                    });
                    seen.add(text);
                } else if (text.includes('Show ') && text.includes('more')) {
                    blocks.push({ type: 'action', title: text });
                    seen.add(text);
                }
                
                if (blocks.length >= 60) break;
            }
            return { success: true, blocks };
        } catch(e) { return { error: e.toString(), blocks: [] }; }
    })()`;

    const res = await cdpEval(cdp, EXP, { awaitPromise: true });
    return res || { error: 'Context failed', blocks: [] };
}

export async function selectChat(cdp, chatTitle) {
    const safeTitle = JSON.stringify(chatTitle);
    const EXP = `(async () => {
        try {
            const btn = document.querySelector('[data-tooltip-id*="history"]') || Array.from(document.querySelectorAll('button')).find(b => b.querySelector('svg.lucide-clock'));
            if (btn) { btn.click(); await new Promise(r => setTimeout(r, 600)); }
            const target = Array.from(document.querySelectorAll('*')).find(el => el.innerText?.trim().startsWith(${safeTitle}.substring(0, 20)) && el.children.length < 5);
            if (target) { target.click(); return { success: true }; }
            return { error: 'Chat not found' };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    const res = await cdpEval(cdp, EXP, { awaitPromise: true });
    return res || { error: 'Context failed' };
    return { error: 'Context failed' };
}

export async function getAppState(cdp) {
    const EXP = `(() => {
        try {
            let mode = 'Unknown';
            const modeEl = Array.from(document.querySelectorAll('*')).find(el => el.children.length === 0 && (el.innerText === 'Fast' || el.innerText === 'Planning'));
            if (modeEl) mode = modeEl.innerText;
            
            let model = 'Unknown';
            const modelKeywords = ['Gemini', 'Claude', 'GPT', 'Sonnet', 'o1', 'o3', 'gpt-4', 'Llama', 'DeepSeek'];
            
            const candidateSelectors = [
                '[data-tooltip-id*="model"]',
                'button[aria-haspopup]',
                '.model-selector',
                '[class*="model-picker"]'
            ];
            
            for (const sel of candidateSelectors) {
                const el = document.querySelector(sel);
                if (el && el.offsetHeight > 0) {
                    let txt = el.innerText.trim();
                    // IGNORE STATUS MESSAGES: Model names are usually short. 
                    // If it contains "...", "Checking", "Wait", or is > 30 chars, it's likely a toast/status.
                    if (txt.length > 30 || txt.includes('...') || /\b(Checking|Wait|Loading|Running|Saving|Signing)\b/i.test(txt)) continue;
                    
                    if (modelKeywords.some(k => txt.includes(k))) {
                        model = txt;
                        break;
                    }
                }
            }
            
            if (model === 'Unknown') {
                const allEls = Array.from(document.querySelectorAll('*'));
                const modelEl = allEls.find(el => {
                    const txt = (el.innerText || '').trim();
                    if (txt.length > 25 || txt.includes('...') || /\b(Checking|Wait|Loading|Running|Saving|Signing)\b/i.test(txt)) return false;
                    return el.children.length === 0 && modelKeywords.some(k => txt.includes(k)) && 
                           !txt.includes('/') && !txt.includes('*') && !txt.includes('{');
                });
                if (modelEl) model = modelEl.innerText.trim();
            }
            
            return { mode, model };
        } catch(e) { return { mode: 'Unknown', model: 'Unknown' }; }
    })()`;

    return await cdpEval(cdp, EXP) || { mode: 'Unknown', model: 'Unknown' };
}

export async function triggerUndo(cdp) {
    // 1. First try to find a physical Undo/Discard button in the chat UI
    const BTN_EXP = `(() => {
        try {
            const allBtns = Array.from(document.querySelectorAll('button, [role="button"]'))
                .filter(b => b.offsetParent !== null && b.offsetHeight > 0);
            
            // Look for "Undo", "Discard", "Revert", "Reject"
            const undoKeywords = ['Undo', 'Discard', 'Revert', 'Reject'];
            let target = allBtns.find(b => {
                const t = b.textContent.trim();
                return undoKeywords.some(k => t.includes(k)) && t.length < 20;
            });

            if (target) {
                target.click();
                return { success: true, method: 'ui_button', clicked: target.textContent.trim() };
            }
            return { success: false };
        } catch(e) { return { error: e.toString() }; }
    })()`;

    const uiResult = await cdpEval(cdp, BTN_EXP);
    if (uiResult && uiResult.success) return uiResult;

    // 2. Fallback: Dispatch Cmd+Z (Mac) or Ctrl+Z (Linux/Win)
    try {
        const isMac = process.platform === 'darwin';
        await cdp.call("Input.dispatchKeyEvent", {
            type: "keyDown",
            modifiers: isMac ? 4 : 2, // Cmd (4) on Mac, Ctrl (2) on others
            windowsVirtualKeyCode: 90, // 'Z'
            nativeVirtualKeyCode: 90,
            key: "z",
            code: "KeyZ"
        });
        await cdp.call("Input.dispatchKeyEvent", {
            type: "keyUp",
            modifiers: isMac ? 4 : 2,
            windowsVirtualKeyCode: 90,
            nativeVirtualKeyCode: 90,
            key: "z",
            code: "KeyZ"
        });
        return { success: true, method: 'keyboard_shortcut', note: isMac ? 'Dispatched Cmd+Z' : 'Dispatched Ctrl+Z' };
    } catch (e) {
        return { error: 'Keyboard undo failed: ' + e.message };
    }
}
