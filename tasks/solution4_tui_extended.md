# Agent Task: Solution 4 Extended - Status Polling + TUI Integration

## Objective
Extend Solution 4 (Status API & Async Polling) to fully support Codex TUI by adding configuration and authentication bypass.

## Prerequisites
- Solution 4 bridge (`opencode_bridge_solution4.js`) implemented
- OpenCode server: `localhost:4096`
- Bridge: `localhost:8083`

---

## Phase 1: Configuration for TUI Auth Bypass

### Step 1.1: Update ~/.codex/config.toml
```bash
cat > ~/.codex/config.toml << 'EOF'
#:schema https://developers.openai.com/codex/config-schema.json

# CRITICAL: Use file-based auth to avoid keyring issues
cli_auth_credentials_store = "file"

# Disable remote model discovery
[features]
remote_models = false

# Allow environment variables
[shell_environment_policy]
inherit = "all"
ignore_default_excludes = true

# OSS mode default provider
oss_provider = "opencode_bridge"

# Define OpenCode bridge provider
[model_providers.opencode_bridge]
name = "OpenCode Kimi Bridge"
base_url = "http://127.0.0.1:8083/v1"
env_key = "OPENCODE_KEY"
requires_openai_auth = false
wire_api = "responses"
stream_idle_timeout_ms = 600000
request_max_retries = 3

# Profile for Kimi K2.5
[profiles.kimi]
model = "opencode/kimi-k2.5-free"
model_provider = "opencode_bridge"
model_context_window = 262144
sandbox_mode = "danger-full-access"
approval_policy = "never"

# Set as default
model = "opencode/kimi-k2.5-free"
model_provider = "opencode_bridge"
profile = "kimi"
EOF
```

### Step 1.2: Create minimal auth.json
```bash
mkdir -p ~/.codex

cat > ~/.codex/auth.json << 'EOF'
{
  "version": "1.0",
  "credentials": {},
  "providers": {
    "opencode_bridge": {
      "auth_method": "env_key"
    }
  },
  "last_updated": "2026-01-31T00:00:00Z"
}
EOF

chmod 600 ~/.codex/auth.json
```

---

## Phase 2: Verify Solution 4 Bridge Has Required Endpoints

### Step 2.1: Check `/v1/responses` endpoint exists
The bridge must have `/v1/responses` endpoint that emits these SSE events:
1. `response.created`
2. `response.output_item.added`
3. `response.output_text.delta`
4. `response.output_item.done`
5. `response.completed`

### Step 2.2: Verify SSE event format
```javascript
// Required SSE format for TUI:
res.write(`event: response.created\n`);
res.write(`data: ${JSON.stringify({
    type: 'response.created',
    response: { id: responseId, object: 'response', status: 'in_progress' }
})}\n\n`);

res.write(`event: response.output_text.delta\n`);
res.write(`data: ${JSON.stringify({
    type: 'response.output_text.delta',
    delta: "text content here"
})}\n\n`);

res.write(`event: response.completed\n`);
res.write(`data: ${JSON.stringify({
    type: 'response.completed',
    response: { id: responseId, status: 'completed' }
})}\n\n`);
```

---

## Phase 3: Testing Sequence

### Step 3.1: Start services
```bash
pkill -f "node opencode_bridge" || true
sleep 2

# Ensure OpenCode server is running
pgrep -f "opencode serve" || { opencode serve --port 4096 & sleep 3; }

# Start Solution 4 bridge
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
node opencode_bridge_solution4.js &
sleep 3
```

### Step 3.2: Test health
```bash
curl -s http://localhost:8083/health
# Expected: {"bridge":"online",...}
```

### Step 3.3: Test /v1/responses (SSE)
```bash
curl -N http://localhost:8083/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Say hello"}], "model": "kimi"}'

# Expected output:
# event: response.created
# data: {"type":"response.created",...}
#
# event: response.output_text.delta
# data: {"type":"response.output_text.delta","delta":"Hello!"}
#
# event: response.completed
# data: {"type":"response.completed",...}
```

### Step 3.4: Test exec mode (regression)
```bash
export OPENCODE_KEY="kimera"
codex exec "What is 2+2?" --model opencode/kimi-k2.5-free
# Expected: Returns response
```

### Step 3.5: Test TUI launch
```bash
export OPENCODE_KEY="kimera"
codex
# Expected: TUI launches WITHOUT login screen
```

### Step 3.6: Test TUI interaction
1. Type a query in TUI
2. Press Enter
3. Verify response appears with streaming text

---

## Phase 4: Create Startup Script

### Step 4.1: Create unified startup script
```bash
cat > /home/kasm-user/workspace/dspy/root/opencode-bridge/start_kimera_tui.sh << 'EOF'
#!/bin/bash
echo "=== KIMERA Stack: OpenCode + Codex TUI ==="

# Kill existing
pkill -f "node opencode_bridge" || true
sleep 1

# Ensure OpenCode server is running
if ! pgrep -f "opencode serve" > /dev/null; then
    echo "Starting OpenCode server on port 4096..."
    opencode serve --port 4096 &
    sleep 3
fi

# Start Solution 4 bridge
echo "Starting Solution 4 bridge (status polling) on port 8083..."
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
node opencode_bridge_solution4.js &
sleep 2

# Verify
echo ""
echo "Health check:"
curl -s http://localhost:8083/health | jq .

# Set env
export OPENCODE_KEY="kimera"

echo ""
echo "=== Ready! ==="
echo "Launch TUI: codex"
echo "Or exec mode: codex exec 'your prompt'"
EOF

chmod +x /home/kasm-user/workspace/dspy/root/opencode-bridge/start_kimera_tui.sh
```

---

## Success Criteria
- [ ] `~/.codex/config.toml` has `requires_openai_auth = false`
- [ ] `~/.codex/auth.json` exists
- [ ] Solution 4 bridge running with `/v1/responses` endpoint
- [ ] SSE events stream correctly (response.created → delta → completed)
- [ ] `codex exec` works (regression test)
- [ ] `codex` TUI launches without login screen
- [ ] TUI query returns streaming response

## Git Commit
```bash
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
git add .
git commit -m "Solution 4 Extended: TUI integration with status polling"
```

## Rollback
```bash
# Kill bridge
pkill -f "node opencode_bridge_solution4.js"

# Restore config
git checkout HEAD -- ~/.codex/config.toml
```
