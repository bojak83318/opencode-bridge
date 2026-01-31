// opencode_bridge.js
// OpenCode-to-OpenAI Bridge for Codex CLI
import express from 'express';
import { createOpencodeClient } from '@opencode-ai/sdk';

const app = express();
app.use(express.json());

// Initialize OpenCode client
const opencode = createOpencodeClient({
    baseUrl: 'http://127.0.0.1:4096'
});

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Session management
const sessions = new Map();

// Helper: Get or create OpenCode session
async function getOrCreateSession(conversationId = 'default') {
    if (sessions.has(conversationId)) {
        return sessions.get(conversationId);
    }

    console.log(`Creating session for ${conversationId}...`);
    const resp = await opencode.session.create({
        body: {
            name: `Codex-${conversationId}`,
            model: 'opencode/kimi-k2.5-free',
            agent: 'build'
        }
    });

    const session = resp.data || resp;
    if (!session.id) {
        throw new Error('Failed to create session: ' + JSON.stringify(resp));
    }

    sessions.set(conversationId, session.id);
    console.log(`Created OpenCode session: ${session.id}`);
    return session.id;
}

// Helper: Send prompt and wait for response via event stream
async function sendPromptAndWait(sessionId, text, timeoutMs = 60000) {
    console.log(`Sending prompt to ${sessionId}: "${text.substring(0, 50)}..."`);

    // Subscribe to events BEFORE sending prompt
    const eventHub = await opencode.event.subscribe();
    const eventStream = eventHub.stream;

    // Send the prompt
    await opencode.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: 'text', text }] }
    });

    // Collect response from event stream
    let responseText = '';
    const startTime = Date.now();

    for await (const event of eventStream) {
        // Timeout check
        if (Date.now() - startTime > timeoutMs) {
            console.log('Timeout waiting for response');
            break;
        }

        console.log(`Event: ${event.type}`);

        // Skip heartbeats
        if (event.type === 'server.heartbeat' || event.type === 'server.connected') {
            continue;
        }

        // Collect text deltas
        if (event.type === 'message.part.delta') {
            const delta = event.properties?.text || event.text || '';
            responseText += delta;
        }

        // Message complete
        if (event.type === 'message.done') {
            console.log('Message done, response collected');
            break;
        }

        // Also check for assistant message events
        if (event.type === 'session.message.created' && event.properties?.message?.role === 'assistant') {
            const parts = event.properties?.message?.parts || [];
            for (const part of parts) {
                if (part.type === 'text') {
                    responseText += part.text || '';
                }
            }
        }
    }

    console.log(`Response: "${responseText.substring(0, 100)}..."`);
    return responseText;
}

// ENDPOINT: /v1/models (Codex format)
app.get('/v1/models', async (req, res) => {
    try {
        const resp = await opencode.config.providers();
        const providers = resp.data?.providers || [];
        const models = [];

        for (const provider of providers) {
            const providerModels = provider.models || {};
            for (const modelId in providerModels) {
                const model = providerModels[modelId];
                models.push({
                    id: `${provider.id}/${modelId}`,
                    object: 'model',
                    created: 1234567890,
                    owned_by: provider.id,
                    context_window: model.limit?.context || 262144
                });
            }
        }

        res.json({
            object: 'list',
            models: models
        });
    } catch (error) {
        console.error('Error fetching models:', error);
        res.status(500).json({ error: error.message });
    }
});

// ENDPOINT: /v1/chat/completions
app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages, stream = false } = req.body;
        const conversationId = req.headers['x-conversation-id'] || 'default';
        const sessionId = await getOrCreateSession(conversationId);

        const userMessages = messages.filter(m => m.role === 'user');
        const lastMessage = userMessages[userMessages.length - 1];

        if (stream) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // Subscribe to events first
            const eventHub = await opencode.event.subscribe();
            const eventStream = eventHub.stream;

            // Send prompt
            await opencode.session.prompt({
                path: { id: sessionId },
                body: { parts: [{ type: 'text', text: lastMessage.content }] }
            });

            for await (const event of eventStream) {
                if (event.type === 'server.heartbeat' || event.type === 'server.connected') continue;

                if (event.type === 'message.part.delta') {
                    const chunk = {
                        id: `chatcmpl-${Date.now()}`,
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: 'kimi-k2.5',
                        choices: [{
                            index: 0,
                            delta: { content: event.properties?.text || event.text || '' },
                            finish_reason: null
                        }]
                    };
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                }
                if (event.type === 'message.done') {
                    res.write('data: [DONE]\n\n');
                    res.end();
                    break;
                }
            }
        } else {
            // Non-streaming: wait for complete response
            const content = await sendPromptAndWait(sessionId, lastMessage.content);

            res.json({
                id: `chatcmpl-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: 'kimi-k2.5',
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content
                    },
                    finish_reason: 'stop'
                }]
            });
        }
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ENDPOINT: /v1/responses (Codex wire API)
app.post('/v1/responses', async (req, res) => {
    try {
        const { messages } = req.body;
        const conversationId = req.headers['x-conversation-id'] || 'default';
        const sessionId = await getOrCreateSession(conversationId);
        const lastMessage = messages.filter(m => m.role === 'user').pop();

        res.setHeader('Content-Type', 'text/event-stream');

        const content = await sendPromptAndWait(sessionId, lastMessage.content);

        res.write('event: response.item.created\n');
        res.write(`data: ${JSON.stringify({ type: 'message', role: 'assistant' })}\n\n`);
        res.write('event: response.item.content_part.added\n');
        res.write(`data: ${JSON.stringify({ type: 'text', text: '' })}\n\n`);
        res.write('event: response.item.content_part.delta\n');
        res.write(`data: ${JSON.stringify({ type: 'text', text: content })}\n\n`);
        res.write('event: response.item.done\n');
        res.write(`data: ${JSON.stringify({ type: 'message' })}\n\n`);
        res.write('event: response.done\n');
        res.write(`data: ${JSON.stringify({ status: 'completed' })}\n\n`);
        res.end();
    } catch (error) {
        console.error('Responses error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ bridge: 'online', opencode: 'check log for details' });
});

const PORT = 8083;
app.listen(PORT, () => {
    console.log(`Bridge listening on http://localhost:${PORT}`);
});
