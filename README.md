# OpenClaudeScience

High-fidelity desktop/web demo of an adapter-driven scientific AI workbench.

The UI intentionally does not copy Claude or Anthropic branding. It uses a Bio Lab Glass visual system while preserving the target product logic: three-column workspace, sessions, permissions, plans, tool cells, artifacts, provenance, annotations, reviewer findings, delegation tracks, notebook state, remote jobs, files, and settings.

## Stack

- React + Vite + TypeScript web UI
- Tauri v2 desktop shell
- Fastify HTTP/WebSocket adapter
- OpenCode runtime via `@opencode-ai/sdk`
- Zustand state store
- Framer Motion transitions
- lucide-react icons

## Adapter Contract

The frontend is built against the adapter contract in:

```text
SuperMe-docs/10-adapter-contract.md
```

Runtime dependencies such as OpenCode are hidden behind the adapter. The UI uses adapter-level IDs such as `projectId`, `sessionId`, `messageId`, `artifactId`, `versionId`, `permissionId`, `annotationId`, `trackId`, and `jobId`.

## Runtime Modes

The adapter supports two OpenCode runtime modes.

| Mode | Use case | Behavior |
| --- | --- | --- |
| `managed` | Recommended for local full-stack development | Adapter starts `opencode serve` and stops it on normal shutdown. |
| `external` | You already started OpenCode yourself | Adapter connects to `OPENCODE_HOST:OPENCODE_PORT`. |

The frontend can run in:

| Mode | Behavior |
| --- | --- |
| `real` | Uses adapter HTTP/WebSocket endpoints. Required for OpenCode/model testing. |
| `mock` | Uses local fixture data only. Useful for UI-only work. |

## Prerequisites

Install Node.js and npm, then install project dependencies:

```powershell
npm.cmd install
```

Install the OpenCode command-line runtime:

```powershell
npm.cmd install -g opencode-ai@1.17.12
```

Check that the CLI is available:

```powershell
opencode.cmd --version
```

The adapter is tested with OpenCode `1.17.12`. Newer patch versions may work, but use `1.17.12` when reproducing the current test reports exactly.

## Environment

Create a local `.env` file from `.env.example`:

```powershell
Copy-Item .env.example .env
```

Fill in the provider values. For the current DeepSeek/OpenCode setup:

```dotenv
ADAPTER_HOST=127.0.0.1
ADAPTER_PORT=5178
ADAPTER_RUNTIME_MODE=managed
ADAPTER_STORAGE_ROOT=
ADAPTER_CORS_ORIGINS=http://127.0.0.1:5173,http://localhost:5173

OPENCODE_HOST=127.0.0.1
OPENCODE_PORT=4096
OPENCODE_COMMAND=opencode.cmd
OPENCODE_MODEL=deepseek/deepseek-chat

DEEPSEEK_API_KEY=your_deepseek_key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

VITE_ADAPTER_MODE=real
VITE_ADAPTER_HTTP_URL=http://127.0.0.1:5178
VITE_ADAPTER_WS_URL=ws://127.0.0.1:5178
```

Notes:

- `.env` is git-ignored and must not be committed.
- `ADAPTER_STORAGE_ROOT` must be outside the project root. If omitted, it defaults to a sibling directory named `.openclaudescience-adapter`.
- `OPENCODE_MODEL` uses OpenCode provider/model format. With the included `opencode.json`, use `deepseek/deepseek-chat`.

## Start The Full Stack

Use two terminals.

Terminal 1: start the adapter and managed OpenCode runtime:

```powershell
npm.cmd run dev:managed
```

Expected adapter URL:

```text
http://127.0.0.1:5178
```

Expected managed OpenCode URL:

```text
http://127.0.0.1:4096
```

Terminal 2: start the frontend:

```powershell
$env:VITE_ADAPTER_MODE = "real"
$env:VITE_ADAPTER_HTTP_URL = "http://127.0.0.1:5178"
$env:VITE_ADAPTER_WS_URL = "ws://127.0.0.1:5178"
npm.cmd run dev:web
```

Open:

```text
http://127.0.0.1:5173
```

The App Shell should show `connected` in the lower-left status area.

## Health Check

Verify the adapter and runtime:

```powershell
Invoke-RestMethod http://127.0.0.1:5178/v1/health | ConvertTo-Json -Depth 8
```

Expected highlights:

```json
{
  "healthy": true,
  "runtime": {
    "kind": "opencode",
    "mode": "managed",
    "connected": true,
    "version": "1.17.12"
  }
}
```

## External OpenCode Mode

If you want to start OpenCode manually:

Terminal 1:

```powershell
opencode.cmd serve --hostname 127.0.0.1 --port 4096 --cors http://127.0.0.1:5178
```

Terminal 2:

```powershell
$env:ADAPTER_RUNTIME_MODE = "external"
npm.cmd run dev:adapter
```

Terminal 3:

```powershell
$env:VITE_ADAPTER_MODE = "real"
npm.cmd run dev:web
```

## Mock UI Mode

For frontend-only UI work without OpenCode/model calls:

```powershell
$env:VITE_ADAPTER_MODE = "mock"
npm.cmd run dev:web
```

Mock mode does not call the real adapter, OpenCode, or model endpoint.

## Build And Validate

Type-check everything:

```powershell
npm.cmd run check
```

Run tests:

```powershell
npm.cmd test
```

Build adapter and web UI:

```powershell
npm.cmd run build
```

Run the production adapter build:

```powershell
npm.cmd run start:managed
```

## Project Layout

```text
src/adapter    Adapter server, contract mapping, real/mock frontend transports
src/features   Workspace store and feature state
src/fixtures   Mock scientific workflows and adapter snapshots
src-tauri      Tauri desktop shell
SuperMe-docs   Adapter contract, milestones, loop reports, implementation notes
```

## Test Reports

Current browser contract test report:

```text
SuperMe-docs/test-reports/2026-07-01-frontend-contract/combined-report.md
```

Those tests used the real frontend, real adapter HTTP/WebSocket contract, managed OpenCode, and DeepSeek model endpoint for chat turns. Adapter-owned flows such as plan, artifact, annotation, reviewer, and remote-job lifecycle were driven through the real adapter contract, not frontend mocks.
