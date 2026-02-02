#!/bin/bash
set -e

echo "=== KIMERA Stack: OpenCode + Codex TUI (Docker) ==="

# Ensure OpenCode server is running
echo "Starting OpenCode server on port 4096..."
opencode serve --port 4096 --hostname 0.0.0.0 &
OC_PID=$!

# Wait for it to start
sleep 3

# Start the bridge
echo "Starting OpenCode Bridge on port 8083..."
node opencode_bridge_solution4.js &
BRIDGE_PID=$!

# Wait for bridge to start
sleep 2

# Health check
echo "Performing health check..."
curl -s http://localhost:8083/health | jq . || echo "Health check failed, but continuing..."

echo "=== Stack is running ==="

# Wait for processes
wait $OC_PID $BRIDGE_PID
