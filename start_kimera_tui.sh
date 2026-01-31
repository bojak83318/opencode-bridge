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
