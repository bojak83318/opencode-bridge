# KIMERA Stack: OpenCode Bridge

## Project Overview
This project implements the **OpenCode Bridge**, a critical component of the KIMERA Stack. It acts as a translation layer, converting OpenAI-compatible API requests from the **Codex CLI** into **OpenCode Session API** calls. This enables the Codex CLI (and TUI) to utilize the **Kimi K2.5 Free** model via the OpenCode platform.

## Architecture
The system operates as a chain of local proxies:
```
Codex CLI (TUI) -> [OpenCode Bridge :8083] -> [OpenCode Server :4096] -> [Kimi K2.5 Free]
```
1.  **Codex CLI:** Sends standard OpenAI chat completion requests to `http://localhost:8083`.
2.  **OpenCode Bridge:**
    *   Intercepts requests.
    *   Manages OpenCode sessions (`create`, `prompt`).
    *   Translates responses back to OpenAI format.
3.  **OpenCode Server:** Handles the actual connection to the Kimi model.

## key Files

### Source Code
*   **`opencode_bridge_solution1.js`**: ✅ **Verified Working (Blocking Mode)**. Uses simple blocking calls to `opencode.session.prompt()`. Reliable but slower UX (no streaming).
*   **`opencode_bridge_solution4.js`**: 🔄 **Current Active Solution**. Attempting to implement status polling or event streaming for better UX. Referenced by the startup script.
*   **`opencode_bridge.js`**: Development version, likely containing experimental streaming logic (`sendPromptAndWait` with event stream subscription).
*   **`opencode_bridge_tui.js`**: Variant optimized for TUI interactions.

### Configuration & Scripts
*   **`start_kimera_tui.sh`**: Main entry point script. Kills existing instances, ensures OpenCode server is running (`:4096`), and starts the bridge (`:8083`).
*   **`package.json`**: Node.js dependencies (`express`, `@opencode-ai/sdk`, `node-fetch`).
*   **`opencode-bridge-codex-cli.md`**: detailed documentation on the integration, known issues, and architecture diagrams.

## Usage

### Prerequisites
*   Node.js installed.
*   OpenCode CLI installed and authenticated.
*   Codex CLI installed.

### Quick Start
Use the provided shell script to spin up the entire stack:
```bash
./start_kimera_tui.sh
```

### Manual Start
1.  **Start OpenCode Server:**
    ```bash
    opencode serve --port 4096
    ```
2.  **Start Bridge (choose one):**
    ```bash
    # For stable, blocking mode:
    node opencode_bridge_solution1.js

    # For active development version:
    node opencode_bridge_solution4.js
    ```

### Testing
**Health Check:**
```bash
curl http://localhost:8083/health
```

**Chat Test (Blocking):**
```bash
curl -X POST http://localhost:8083/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "opencode/kimi-k2.5-free", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Development Status
*   **Solution 1 (Blocking):** Verified working. It waits for the full response before replying to the CLI.
*   **Solution 4 (Polling/Streaming):** Currently under active testing/development to support real-time token streaming.
*   **Known Issues:**
    *   Streaming responses (`stream: true`) can be tricky due to OpenCode SDK event stream behavior.
    *   Codex CLI expects specific error formats and model list structures.

## Convention
*   **Port 8083:** Reserved for the OpenCode Bridge.
*   **Port 4096:** Reserved for the OpenCode Server.
*   **Model Name:** `opencode/kimi-k2.5-free`.
