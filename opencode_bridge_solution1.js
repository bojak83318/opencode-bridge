// opencode_bridge_solution1.js
// Solution 1: Blocking Mode Bridge - Uses default session.prompt() behavior
import express from 'express';
import { createOpencodeClient } from '@opencode-ai/sdk';

const app = express();
app.use(express.json());

const opencode = createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' });
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
        res.json({ object: 'list', models });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/v1/chat/completions', async (req, res) => {
    try {
        const { messages } = req.body;
        const sessionId = await getOrCreateSession('default');
        const lastMessage = messages.filter(m => m.role === 'user').pop();

        console.log(`Sending blocking prompt to ${sessionId}...`);

        // BLOCKING CALL - waits for complete response
        const response = await opencode.session.prompt({
            path: { id: sessionId },
            body: { parts: [{ type: 'text', text: lastMessage.content }] }
            // NO noReply = blocking mode (default)
        });

        console.log('Response received:', JSON.stringify(response.data, null, 2));

        // Extract text from response.data.parts
        const content = (response.data?.parts || [])
            .filter(p => p.type === 'text')
            .map(p => p.text || '')
            .join('\n');

        res.json({
            id: `chatcmpl-${sessionId}`,
            object: 'chat.completion',
            model: 'kimi-k2.5',
            choices: [{
                index: 0,
                message: { role: 'assistant', content },
                finish_reason: 'stop'
            }]
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(8083, () => console.log('Solution 1 Bridge on http://localhost:8083'));
