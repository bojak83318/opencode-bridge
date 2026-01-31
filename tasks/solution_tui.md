# Agent Task: Codex TUI with OpenCode Bridge

## Objective
Enable Codex TUI (interactive mode) to work with the local OpenCode bridge, bypassing OpenAI authentication.

## Prerequisites
- Solution 1 (blocking mode) working: ✅
- Git branch: `solution1-working`
- OpenCode server: `localhost:4096`
- Bridge: `localhost:8083`

---

## Phase 1: Configuration Setup

### Step 1.1: Update config.toml
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

### Step 1.3: Git checkpoint
```bash
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
git checkout -b solution-tui
```

---

## Phase 2: Bridge Implementation

### Step 2.1: Create TUI bridge
Create file: `/home/kasm-user/workspace/dspy/root/opencode-bridge/opencode_bridge_tui.js`

**Source**: Copy from `perplexity/research/codex_tui_opencode_bridge-ans.md` lines 71-380

**Key endpoints:**
- `GET /health` - Health check
- `GET /v1/models` - List models (Codex format)
- `POST /v1/responses` - TUI format with SSE events
- `POST /v1/chat/completions` - Exec mode compatibility

**SSE Events for `/v1/responses`:**
1. `response.created`
2. `response.output_item.added`
3. `response.output_text.delta`
4. `response.output_item.done`
5. `response.completed`

### Step 2.2: Git commit
```bash
git add opencode_bridge_tui.js
git commit -m "Add TUI-compatible bridge with /v1/responses SSE endpoint"
```

---

## Phase 3: Testing Sequence

### Step 3.1: Start services
```bash
pkill -f "node opencode" || true
pkill -f "opencode serve" || true
sleep 2

opencode serve --port 4096 &
sleep 5

cd /home/kasm-user/workspace/dspy/root/opencode-bridge
node opencode_bridge_tui.js &
sleep 3
```

### Step 3.2: Test health
```bash
curl -s http://localhost:8083/health
# Expected: {"bridge":"online",...}
```

### Step 3.3: Test models
```bash
curl -s http://localhost:8083/v1/models | jq '.models[].id'
# Expected: includes "opencode/kimi-k2.5-free"
```

### Step 3.4: Test /v1/responses (SSE)
```bash
curl -N http://localhost:8083/v1/responses \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Say hello"}], "model": "kimi"}'
# Expected: SSE events (response.created, response.output_text.delta, etc.)
```

### Step 3.5: Test exec mode (regression)
```bash
export OPENCODE_KEY="kimera"
codex exec "What is 2+2?" --model opencode/kimi-k2.5-free
# Expected: Returns "4" or similar
```

### Step 3.6: Test TUI launch
```bash
export OPENCODE_KEY="kimera"
codex
# Expected: TUI launches WITHOUT login screen
```

### Step 3.7: Test TUI interaction
- Type a query in TUI
- Press Enter
- Verify response appears

---

## Phase 4: Startup Script

### Step 4.1: Create script
```bash
cat > /home/kasm-user/workspace/dspy/root/opencode-bridge/start_codex_tui.sh << 'EOF'
#!/bin/bash
echo "=== Starting OpenCode + Codex TUI Stack ==="

# Kill existing
pkill -f "node opencode_bridge" || true
pkill -f "opencode serve" || true
sleep 2

# Start OpenCode server
echo "Starting OpenCode server on port 4096..."
opencode serve --port 4096 &
sleep 3

# Start bridge
echo "Starting TUI-compatible bridge on port 8083..."
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
node opencode_bridge_tui.js &
sleep 2

# Verify
curl -s http://localhost:8083/health | jq .

# Set env
export OPENCODE_KEY="kimera"

echo ""
echo "Ready! Launch with: codex"
echo "Or with --oss flag: codex --oss"
EOF

chmod +x /home/kasm-user/workspace/dspy/root/opencode-bridge/start_codex_tui.sh
```

### Step 4.2: Final commit
```bash
cd /home/kasm-user/workspace/dspy/root/opencode-bridge
git add .
git commit -m "Complete TUI solution with startup script"
```

---

## Success Criteria
- [ ] Config updated with `wire_api = "responses"`
- [ ] `auth.json` created
- [ ] `opencode_bridge_tui.js` implemented
- [ ] `/v1/responses` returns SSE events
- [ ] `/v1/chat/completions` still works (regression)
- [ ] `codex` TUI launches without login
- [ ] TUI query returns response

## Rollback
```bash
git checkout solution1-working
```
