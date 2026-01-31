# Agent Task: Solution 4 - Status API & Async Polling

## Objective
Implement a high-fidelity OpenCode bridge using the discovered `/session/status` and `/prompt_async` HTTP endpoints to enable robust streaming and the `/v1/responses` wire API.

## Context
- OpenCode server runs on `localhost:4096`
- Bridge should run on `localhost:8083`
- Solution 1 (Blocking) is currently working but lacks sophisticated streaming/status handling.
- Key Finding: SDK lacks `prompt_async` and `session.status` helpers; must use direct HTTP calls to the OpenCode server.

## Implementation Steps

1. **Create** `opencode_bridge_solution4.js` with:
   - `fetch` for direct HTTP calls to `http://127.0.0.1:4096`.
   - `getSessionStatus(sessionId)` helper using `GET /session/status`.
   - `promptAsync(sessionId, text)` helper using `POST /session/:id/prompt_async`.
   - Polling loop for `/v1/responses` that emits `response.output_text.delta` events.

2. **Endpoints to implement**:
   - `GET /health` → Check bridge + OpenCode server health.
   - `GET /v1/models` → Standard model list.
   - `POST /v1/chat/completions` → Support `stream: true` using the polling logic.
   - `POST /v1/responses` → Full Codex Wire API support with SSE.

3. **Critical code pattern for polling**:
```javascript
// Trigger response asynchronously
await fetch(`${OPENCODE_BASE}/session/${sessionId}/prompt_async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        parts: [{ type: 'text', text: userMessage }]
    })
});

// Polling interval
const pollInterval = setInterval(async () => {
    // 1. Check global status
    const statusResp = await fetch(`${OPENCODE_BASE}/session/status`);
    const statusMap = await statusResp.json();
    const isIdle = statusMap[sessionId]?.status === 'idle';

    // 2. Get incremental text deltas from session.messages()
    const msgs = await opencode.session.messages({ path: { id: sessionId } });
    const assistantMsg = msgs.data.filter(m => m.info.role === 'assistant').pop();
    
    if (assistantMsg) {
        // Calculate and emit deltas...
    }

    if (isIdle) {
        clearInterval(pollInterval);
        // Finalize response...
    }
}, 300);
```

## Test Commands
```bash
# Start Solution 4 bridge
node opencode_bridge_solution4.js > solution4.log 2>&1 &
sleep 2

# Test blocking (via chat completions)
curl -s -X POST http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "kimi", "messages": [{"role": "user", "content": "2+2?"}]}'

# Test streaming delta flow (via responses API)
curl -N -X POST http://localhost:8083/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Count to 3"}]}'
```

## Success Criteria
- [x] `/v1/responses` emits `response.output_text.delta` events.
- [x] `stream: true` works correctly for `/v1/chat/completions`.
- [x] Status polling correctly detects the `idle` state of the session.

## Rollback
```bash
pkill -f "node opencode_bridge_solution4.js"
```
