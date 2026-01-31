# Agent Task: Solution 3 - Complete Production Bridge

## Objective
Implement the complete production-ready bridge from the research answer, combining blocking and polling modes.

## Context
- OpenCode server runs on `localhost:4096`
- Bridge should run on `localhost:8083`
- Model: `opencode/kimi-k2.5-free`
- Must work with Codex CLI

## Implementation Steps

1. **Copy the complete working bridge** from research answer (lines 362-469 of `perplexity/research/opencode_sdk_event_stream-ans.md`)

2. **Modify port** from 8081 to 8083

3. **Fix models endpoint** to handle the actual providers structure

4. **Endpoints**:
   - `GET /health`
   - `GET /v1/models` 
   - `POST /v1/chat/completions` (stream + non-stream)

5. **Key features**:
   - Non-stream: Blocking `session.prompt()`
   - Stream: `noReply: true` + polling `session.messages()`
   - 60 second timeout
   - Proper SSE format

## Reference Implementation
See: `/home/kasm-user/workspace/dspy/root/perplexity/research/opencode_sdk_event_stream-ans.md` lines 362-469

## Test Commands
```bash
# Kill existing processes
pkill -f "node opencode" || true

# Start OpenCode server
opencode serve --port 4096 &
sleep 5

# Start Solution 3 bridge
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
node opencode_bridge_solution3.js &
sleep 3

# Test health
curl -s http://localhost:8083/health

# Test models
curl -s http://localhost:8083/v1/models | jq '.models[].id'

# Test chat
curl -s -X POST http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "kimi", "messages": [{"role": "user", "content": "What is 2+2?"}]}'

# Test with Codex exec
export DUMMY_KEY="any"
codex exec "Say hello" -c model_provider=opencode_bridge --model opencode/kimi-k2.5-free
```

## Success Criteria
- [ ] Health check returns ok
- [ ] Models endpoint lists kimi-k2.5-free
- [ ] Chat returns non-empty response
- [ ] Codex exec works without timeout

## Git Commands
```bash
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
git add .
git commit -m "Solution 3: Complete production bridge"
```

## Rollback (if failed)
```bash
git checkout HEAD -- opencode_bridge_solution3.js
```

## Final Step: Replace Main Bridge
If Solution 3 works:
```bash
cp opencode_bridge_solution3.js opencode_bridge.js
git add . && git commit -m "Replace main bridge with working solution"
```
