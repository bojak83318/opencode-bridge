# Agent Task: Solution 1 - Blocking Mode Bridge

## Objective
Implement a blocking mode OpenCode bridge that uses `session.prompt()` without `noReply` to get complete responses.

## Context
- OpenCode server runs on `localhost:4096`
- Bridge should run on `localhost:8083`
- Model: `opencode/kimi-k2.5-free`

## Key Research Finding
`session.prompt()` WITHOUT `noReply: true` is a **BLOCKING call** that returns the complete `AssistantMessage` directly in `response.data.parts`.

## Implementation Steps

1. **Create** `opencode_bridge_solution1.js` with:
   - Express server on port 8083
   - `createOpencodeClient({ baseUrl: 'http://127.0.0.1:4096' })`
   - Session management with `opencode.session.create()`
   - Blocking prompt: `opencode.session.prompt()` without `noReply`
   - Extract content from `response.data.parts`

2. **Endpoints to implement**:
   - `GET /health` → `{ status: 'ok' }`
   - `GET /v1/models` → List models from `opencode.config.providers()`
   - `POST /v1/chat/completions` → Blocking prompt, return OpenAI format

3. **Critical code pattern**:
```javascript
const response = await opencode.session.prompt({
    path: { id: sessionId },
    body: { parts: [{ type: 'text', text: userMessage }] }
    // NO noReply parameter = blocking mode
});

const content = response.data.parts
    .filter(p => p.type === 'text')
    .map(p => p.text || '')
    .join('\n');
```

## Test Commands
```bash
# Kill existing processes
pkill -f "node opencode" || true

# Start OpenCode server (if not running)
opencode serve --port 4096 &
sleep 5

# Start Solution 1 bridge
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
node opencode_bridge_solution1.js &
sleep 3

# Test
curl -s http://localhost:8083/health
curl -s -X POST http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "kimi", "messages": [{"role": "user", "content": "What is 2+2?"}]}'
```

## Success Criteria
- [ ] Response contains non-empty `content` field
- [ ] No timeout (response < 60 seconds)
- [ ] Response is valid OpenAI chat completion format

## Git Commands
```bash
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
git add .
git commit -m "Solution 1: Blocking mode bridge"
```

## Rollback (if failed)
```bash
git checkout HEAD -- opencode_bridge_solution1.js
```
