# Agent Task: Solution 2 - Polling Mode Bridge (Streaming Support)

## Objective
Implement a polling mode OpenCode bridge that uses `noReply: true` + `session.messages()` polling for streaming support.

## Context
- OpenCode server runs on `localhost:4096`
- Bridge should run on `localhost:8083`
- Model: `opencode/kimi-k2.5-free`

## Key Research Finding
For streaming: use `noReply: true` to send prompt without blocking, then poll `session.messages()` to get incremental responses.

## Implementation Steps

1. **Create** `opencode_bridge_solution2.js` with:
   - Non-blocking prompt: `{ noReply: true }`
   - Poll `opencode.session.messages({ path: { id: sessionId } })`
   - Check `session.data.status === 'idle'` for completion
   - SSE streaming for `/v1/chat/completions?stream=true`

2. **Endpoints to implement**:
   - `GET /health` → `{ status: 'ok' }`
   - `GET /v1/models` → List models
   - `POST /v1/chat/completions` → Support both stream and non-stream

3. **Critical code pattern for streaming**:
```javascript
// Send prompt without waiting
await opencode.session.prompt({
    path: { id: sessionId },
    body: {
        parts: [{ type: 'text', text: userMessage }],
        noReply: true  // CRITICAL: Don't block
    }
});

// Poll for response
const pollInterval = setInterval(async () => {
    const msgs = await opencode.session.messages({ path: { id: sessionId } });
    const assistantMsgs = msgs.data.filter(m => m.info.role === 'assistant');
    
    if (assistantMsgs.length > prevCount) {
        const latest = assistantMsgs[assistantMsgs.length - 1];
        // Stream content from latest.parts
    }
    
    const session = await opencode.session.get({ path: { id: sessionId } });
    if (session.data.status === 'idle') {
        clearInterval(pollInterval);
        res.write('data: [DONE]\n\n');
        res.end();
    }
}, 300);
```

## Test Commands
```bash
# Kill existing processes
pkill -f "node opencode" || true

# Start OpenCode server (if not running)
opencode serve --port 4096 &
sleep 5

# Start Solution 2 bridge
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
node opencode_bridge_solution2.js &
sleep 3

# Test non-streaming
curl -s -X POST http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "kimi", "messages": [{"role": "user", "content": "Hi"}], "stream": false}'

# Test streaming
curl -N -X POST http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "kimi", "messages": [{"role": "user", "content": "Hi"}], "stream": true}'
```

## Success Criteria
- [ ] Non-streaming returns complete response
- [ ] Streaming returns SSE chunks ending with `[DONE]`
- [ ] No timeout (response < 60 seconds)

## Git Commands
```bash
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
git add .
git commit -m "Solution 2: Polling mode bridge with streaming"
```

## Rollback (if failed)
```bash
git checkout HEAD -- opencode_bridge_solution2.js
```
