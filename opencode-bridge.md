# OpenCode Bridge Rules

## Purpose
The OpenCode Bridge translates **OpenAI-compatible API requests** (from Codex CLI) into **OpenCode Session API calls** and vice versa.

## Architecture
```
Codex CLI (port 8083) → OpenCode Bridge → OpenCode Server (port 4096) → Kimi K2.5 Free
```

## Critical Requirements

### 1. Request Format
OpenCode SDK requires **discriminator fields** in all part objects:
```javascript
// ❌ WRONG
{ parts: [{ text: "Hello" }] }

// ✅ CORRECT
{ parts: [{ type: 'text', text: "Hello" }] }
```

### 2. Response Unwrapping
OpenCode SDK wraps responses in `.data`:
```javascript
const response = await opencode.session.prompt(...);
// Access actual data via response.data
const parts = response.data?.parts || response.parts || [];
```

### 3. Session Management
- Each conversation must have a persistent session ID
- Sessions are created via `opencode.session.create()`
- Prompts are sent via `opencode.session.prompt()`

### 4. Event Stream (Streaming)
For streaming responses:
1. Subscribe to events: `await opencode.event.subscribe()`
2. Access the stream: `eventHub.stream`
3. Filter by session ID: `event.sessionId === sessionId`
4. Look for `message.part.delta` and `message.done` events

### 5. Model Endpoint
Codex CLI v0.92.0 expects:
```json
{
  "object": "list",
  "models": [...]  // NOT "data"
}
```

### 6. Blocking vs Non-Blocking
- **Non-streaming (`stream: false`)**: `opencode.session.prompt()` returns BEFORE the response is complete
- **Solution**: For non-streaming, use the event stream to wait for `message.done`

## Known Issues

### Issue 1: Empty Content in Non-Streaming Mode
**Cause**: `opencode.session.prompt()` returns the *request echo*, not the assistant response.
**Fix**: Must subscribe to event stream and wait for `message.done` event to get the actual response.

### Issue 2: `requires_openai_auth` Not Working
**Cause**: Codex TUI ignores this for certain model prefixes.
**Workaround**: Use `codex exec` instead of TUI.

### Issue 3: Event Stream Not Async Iterable
**Cause**: SDK returns `{ stream: AsyncIterable }`, not a direct AsyncIterable.
**Fix**: Access via `eventHub.stream`.

## Endpoints to Implement

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/models` | GET | List available models (Codex format) |
| `/v1/chat/completions` | POST | Chat endpoint (streaming/non-streaming) |
| `/v1/responses` | POST | Codex's new wire API format |
| `/health` | GET | Health check |

## Testing
```bash
# Test models
curl http://localhost:8083/v1/models | jq '.models[].id'

# Test chat (non-streaming)
curl -X POST http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "opencode/kimi-k2.5-free", "messages": [{"role": "user", "content": "Hi"}], "stream": false}'

# Test with Codex exec
export DUMMY_KEY="any" && codex exec "Hello" -c model_provider=opencode_bridge
```
