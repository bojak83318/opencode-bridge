// opencode_bridge_solution4.js
// Solution 4: Status API & Async Polling
import express from 'express';
import { createOpencodeClient } from '@opencode-ai/sdk';
import fetch from 'node-fetch';

const app = express();
app.use(express.json());

const OPENCODE_BASE = 'http://127.0.0.1:4096';
const opencode = createOpencodeClient({ baseUrl: OPENCODE_BASE });
const sessions = new Map();

async function getOrCreateSession(id = 'default') {
    if (sessions.has(id)) return sessions.get(id);

    const session = await opencode.session.create({
        body: { name: `Codex-${id}`, model: 'opencode/kimi-k2.5-free', agent: 'build' }
    });

    sessions.set(id, session.data.id);
    console.log(`Created session: ${session.data.id}`);
    return session.data.id;
}

app.get('/health', async (req, res) => {
    try {
        // Simple health check: can we reach the models endpoint?
        await opencode.config.providers();
        res.json({ status: 'ok', bridge: 'online', opencode: 'reachable' });
    } catch (e) {
        res.status(503).json({ status: 'error', reason: 'OpenCode server unreachable', error: e.message });
    }
});

app.get('/v1/models', async (req, res) => {
    try {
        const resp = await opencode.config.providers();
        const models = [];
        for (const provider of resp.data?.providers || []) {
            for (const modelId in provider.models || {}) {
                models.push({
                    id: `${provider.id}/${modelId}`,
                    object: 'model',
                    created: 1234567890
                });
            }
        }
        // Codex format often uses 'models' key
        res.json({ object: 'list', models: models });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Helper for polling and streaming
async function pollResponse(sessionId, userMessage, onDelta, onComplete) {
    // Trigger async prompt
    await fetch(`${OPENCODE_BASE}/session/${sessionId}/prompt_async`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            parts: [{ type: 'text', text: userMessage }]
        })
    });

    let lastLength = 0;
    let hasBeenBusy = false;
    let pollCount = 0;

    const pollInterval = setInterval(async () => {
        pollCount++;
        try {
            // 1. Check global status
            const statusResp = await fetch(`${OPENCODE_BASE}/session/status`);
            const statusMap = await statusResp.json();
            const sessionInfo = statusMap[sessionId];

            const isBusy = sessionInfo && (sessionInfo.status === 'busy' || sessionInfo.type === 'busy');
            if (isBusy) hasBeenBusy = true;

            // 2. Get incremental text deltas from session.messages()
            const msgs = await opencode.session.messages({ path: { id: sessionId } });
            const assistantMsg = msgs.data.filter(m => m.info.role === 'assistant').pop();

            // Detection logic for completion:
            // - Explicit 'idle' status
            // - Disappearance from map AFTER being busy
            // - Disappearance from map after some initial polls (if prompt was very fast)
            const isIdle = sessionInfo?.status === 'idle' || sessionInfo?.type === 'idle' || (!isBusy && (hasBeenBusy || pollCount > 10));

            if (assistantMsg) {
                const fullText = (assistantMsg.parts || [])
                    .filter(p => p.type === 'text')
                    .map(p => p.text || '')
                    .join('');

                if (fullText.length > lastLength) {
                    const delta = fullText.slice(lastLength);
                    lastLength = fullText.length;
                    onDelta(delta);
                }
            }

            if (isIdle) {
                clearInterval(pollInterval);
                onComplete();
            }
        } catch (err) {
            console.error('Polling error:', err);
            clearInterval(pollInterval);
            onComplete(err);
        }
    }, 300);
}

// OpenAI Chat Completions Endpoint
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, stream = false } = req.body;
        const sessionId = await getOrCreateSession('default');
        const lastMessage = messages.filter(m => m.role === 'user').pop();

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            pollResponse(
                sessionId,
                lastMessage.content,
                (delta) => {
                    const chunk = {
                        id: `chatcmpl-${sessionId}`,
                        object: 'chat.completion.chunk',
                        created: Date.now(),
                        model: 'kimi',
                        choices: [{ delta: { content: delta }, index: 0, finish_reason: null }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                },
                (err) => {
                    if (!err) {
                        res.write('data: [DONE]\n\n');
                    }
                    res.end();
                }
            );
        } else {
            let fullContent = '';
            pollResponse(
                sessionId,
                lastMessage.content,
                (delta) => { fullContent += delta; },
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({
                        id: `chatcmpl-${sessionId}`,
                        object: 'chat.completion',
                        created: Date.now(),
                        model: 'kimi',
                        choices: [{
                            index: 0,
                            message: { role: 'assistant', content: fullContent },
                            finish_reason: 'stop'
                        }]
                    });
                }
            );
        }
    } catch (error) {
        console.error('Error:', error);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

// Codex Wire API Endpoint (/v1/responses)
app.post('/v1/responses', async (req, res) => {
    try {
        // console.log('Body:', JSON.stringify(req.body));
        const messages = req.body.input || req.body.messages;
        if (!messages) {
            return res.status(400).json({ error: 'Missing input or messages in request body' });
        }
        const sessionId = await getOrCreateSession('default');

        let userPrompt = '';
        const lastMessage = messages.filter(m => m.role === 'user').pop();
        if (lastMessage) {
            if (typeof lastMessage.content === 'string') {
                userPrompt = lastMessage.content;
            } else if (Array.isArray(lastMessage.content)) {
                userPrompt = lastMessage.content
                    .filter(c => c.type === 'text' || c.type === 'input_text')
                    .map(c => c.text || c.content || '')
                    .join('');
            }
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const responseId = `resp_${Date.now()}`;

        // Codex TUI protocol events
        res.write(`event: response.created\n`);
        res.write(`data: ${JSON.stringify({ type: 'response.created', response: { id: responseId, status: 'in_progress' } })}\n\n`);

        res.write(`event: response.output_item.added\n`);
        res.write(`data: ${JSON.stringify({ type: 'response.output_item.added', item: { type: 'message', role: 'assistant', content: [] } })}\n\n`);

        let totalText = '';
        pollResponse(
            sessionId,
            userPrompt,
            (delta) => {
                totalText += delta;
                res.write(`event: response.output_text.delta\n`);
                res.write(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta })}\n\n`);
            },
            (err) => {
                if (err) {
                    res.write(`event: response.failed\n`);
                    res.write(`data: ${JSON.stringify({ type: 'response.failed', error: { message: err.message } })}\n\n`);
                } else {
                    res.write(`event: response.output_item.done\n`);
                    res.write(`data: ${JSON.stringify({ type: 'response.output_item.done', item: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: totalText }] } })}\n\n`);

                    res.write(`event: response.completed\n`);
                    res.write(`data: ${JSON.stringify({ type: 'response.completed', response: { id: responseId, status: 'completed' } })}\n\n`);
                }
                res.end();
            }
        );
    } catch (error) {
        console.error('Error:', error);
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});

app.listen(8083, () => console.log('Solution 4 Bridge (Status Polling) on http://localhost:8083'));
