import express from 'express';
import { createOpencodeClient } from '@opencode-ai/sdk';

const app = express();
app.use(express.json());

const opencode = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });
const sessions = new Map();

async function getOrCreateSession(id = 'default') {
    if (sessions.has(id)) return sessions.get(id);

    const session = await opencode.session.create({
        body: {
            name: `Codex-${id}`,
            model: 'opencode/kimi-k2.5-free',
            agent: 'build'
        }
    });

    sessions.set(id, session.data.id);
    console.log(`Created session: ${session.data.id}`);
    return session.data.id;
}

// ENDPOINT: /v1/models (Codex format)
app.get('/v1/models', async (req, res) => {
    try {
        const providers = await opencode.config.providers();
        const models = [];

        for (const provider of providers.data.providers) {
            for (const model of provider.models || []) {
                models.push({
                    id: `${provider.id}/${model.id}`,
                    object: 'model',
                    created: 1234567890,
                    owned_by: provider.id
                });
            }
        }

        // Codex expects 'models' key, not 'data'
        res.json({ object: 'list', models });
    } catch (error) {
        console.error('Models error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ENDPOINT: /v1/responses (TUI format - SSE)
app.post('/v1/responses', async (req, res) => {
    try {
        const { messages, model } = req.body;
        const sessionId = await getOrCreateSession('default');

        const lastMessage = messages.filter(m => m.role === 'user').pop();
        if (!lastMessage) {
            return res.status(400).json({ error: 'No user message' });
        }

        console.log(`[/v1/responses] Session: ${sessionId}, Query: ${lastMessage.content}`);

        // Set SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // Generate response ID
        const responseId = `resp_${Date.now()}`;

        // Event 1: response.created
        res.write(`event: response.created\n`);
        res.write(`data: ${JSON.stringify({
            type: 'response.created',
            response: {
                id: responseId,
                object: 'response',
                status: 'in_progress'
            }
        })}\n\n`);

        // Send prompt with noReply to enable polling
        await opencode.session.prompt({
            path: { id: sessionId },
            body: {
                parts: [{ type: 'text', text: lastMessage.content }],
                noReply: true
            }
        });

        // Poll for assistant response
        let previousMessageCount = 0;
        let isComplete = false;
        let totalText = '';

        const pollInterval = setInterval(async () => {
            try {
                const messages = await opencode.session.messages({
                    path: { id: sessionId }
                });

                const assistantMessages = messages.data.filter(m => m.info.role === 'assistant');

                // Check for new messages
                if (assistantMessages.length > previousMessageCount) {
                    const latestMessage = assistantMessages[assistantMessages.length - 1];

                    // Event 2: response.output_item.added (first time only)
                    if (previousMessageCount === 0) {
                        res.write(`event: response.output_item.added\n`);
                        res.write(`data: ${JSON.stringify({
                            type: 'response.output_item.added',
                            item: {
                                type: 'message',
                                role: 'assistant',
                                content: []
                            }
                        })}\n\n`);
                    }

                    // Event 3: response.output_text.delta (incremental text)
                    for (const part of latestMessage.parts) {
                        if (part.type === 'text' && part.text) {
                            const newText = part.text.substring(totalText.length);
                            if (newText) {
                                res.write(`event: response.output_text.delta\n`);
                                res.write(`data: ${JSON.stringify({
                                    type: 'response.output_text.delta',
                                    delta: newText
                                })}\n\n`);
                                totalText = part.text;
                            }
                        }
                    }

                    previousMessageCount = assistantMessages.length;
                }

                // Check session status
                const session = await opencode.session.get({ path: { id: sessionId } });

                if (session.data.status === 'idle' || session.data.status === 'error') {
                    isComplete = true;
                    clearInterval(pollInterval);

                    // Event 4: response.output_item.done
                    res.write(`event: response.output_item.done\n`);
                    res.write(`data: ${JSON.stringify({
                        type: 'response.output_item.done',
                        item: {
                            type: 'message',
                            role: 'assistant',
                            content: [{
                                type: 'output_text',
                                text: totalText
                            }]
                        }
                    })}\n\n`);

                    // Event 5: response.completed
                    res.write(`event: response.completed\n`);
                    res.write(`data: ${JSON.stringify({
                        type: 'response.completed',
                        response: {
                            id: responseId,
                            object: 'response',
                            status: 'completed',
                            usage: {
                                input_tokens: 0,
                                output_tokens: 0,
                                total_tokens: 0
                            }
                        }
                    })}\n\n`);

                    res.end();
                }
            } catch (error) {
                console.error('Polling error:', error);
                clearInterval(pollInterval);

                // Event: response.failed
                res.write(`event: response.failed\n`);
                res.write(`data: ${JSON.stringify({
                    type: 'response.failed',
                    response: {
                        id: responseId,
                        error: {
                            code: 'internal_error',
                            message: error.message
                        }
                    }
                })}\n\n`);

                res.end();
            }
        }, 300); // Poll every 300ms

        // Timeout after 60 seconds
        setTimeout(() => {
            if (!isComplete) {
                clearInterval(pollInterval);
                res.write(`event: response.completed\n`);
                res.write(`data: ${JSON.stringify({
                    type: 'response.completed',
                    response: { id: responseId, status: 'completed' }
                })}\n\n`);
                res.end();
            }
        }, 60000);

    } catch (error) {
        console.error('Responses error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ENDPOINT: /v1/chat/completions (for exec mode compatibility)
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, stream = false } = req.body;
        const sessionId = await getOrCreateSession('default');
        const lastMessage = messages.filter(m => m.role === 'user').pop();

        console.log(`[/v1/chat/completions] Session: ${sessionId}, Query: ${lastMessage.content}`);

        if (!stream) {
            // Blocking mode
            const response = await opencode.session.prompt({
                path: { id: sessionId },
                body: { parts: [{ type: 'text', text: lastMessage.content }] }
            });

            const content = response.data.parts
                .filter(p => p.type === 'text')
                .map(p => p.text || '')
                .join('\n');

            return res.json({
                id: `chatcmpl-${sessionId}`,
                object: 'chat.completion',
                model: 'kimi-k2.5',
                choices: [{
                    index: 0,
                    message: { role: 'assistant', content },
                    finish_reason: 'stop'
                }]
            });
        }

        // Streaming mode (same as responses but OpenAI format)
        res.setHeader('Content-Type', 'text/event-stream');

        await opencode.session.prompt({
            path: { id: sessionId },
            body: { parts: [{ type: 'text', text: lastMessage.content }], noReply: true }
        });

        let prevCount = 0;
        const poll = setInterval(async () => {
            const msgs = await opencode.session.messages({ path: { id: sessionId } });
            const assistantMsgs = msgs.data.filter(m => m.info.role === 'assistant');

            if (assistantMsgs.length > prevCount) {
                const latest = assistantMsgs[assistantMsgs.length - 1];
                for (const part of latest.parts) {
                    if (part.type === 'text') {
                        res.write(`data: ${JSON.stringify({
                            id: `chatcmpl-${sessionId}`,
                            object: 'chat.completion.chunk',
                            choices: [{ index: 0, delta: { content: part.text }, finish_reason: null }]
                        })}\n\n`);
                    }
                }
                prevCount = assistantMsgs.length;
            }

            const session = await opencode.session.get({ path: { id: sessionId } });
            if (session.data.status === 'idle') {
                clearInterval(poll);
                res.write('data: [DONE]\n\n');
                res.end();
            }
        }, 300);

        setTimeout(() => { clearInterval(poll); res.end(); }, 60000);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', async (req, res) => {
    try {
        const health = await opencode.global.health();
        res.json({ bridge: 'online', opencode: health });
    } catch (error) {
        res.status(503).json({ bridge: 'online', opencode: 'unreachable' });
    }
});

const PORT = process.env.BRIDGE_PORT || 8083;
app.listen(PORT, () => {
    console.log(`🌉 OpenCode Bridge (TUI-compatible) on :${PORT}`);
    console.log(`📡 OpenCode server: http://localhost:4096`);
    console.log(`🔌 Codex CLI connect: OPENCODE_KEY=dummy codex`);
});
