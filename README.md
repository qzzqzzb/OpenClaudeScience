# OpenClaudeScience

High-fidelity desktop demo of an adapter-driven scientific AI workbench.

The UI intentionally does not copy Claude or Anthropic branding. It uses a Bio Lab Glass visual system while preserving the target product logic: three-column workspace, sessions, permissions, plans, tool cells, artifacts, provenance, annotations, reviewer findings, delegation tracks, notebook state, remote jobs, files, and settings.

## Stack

- Tauri v2 desktop shell
- React + Vite + TypeScript
- Zustand state store
- Framer Motion transitions
- lucide-react icons

## Adapter Contract

The frontend is built against the adapter contract in:

```text
/Users/shaozhang/Downloads/10-adapter-contract.md
```

Runtime dependencies such as OpenCode are hidden behind the adapter. The UI only stores adapter-level IDs such as `projectId`, `sessionId`, `messageId`, `artifactId`, `versionId`, `permissionId`, `annotationId`, `trackId`, and `jobId`.

## Modes

The demo defaults to mock adapter mode.

```bash
VITE_ADAPTER_MODE=mock
```

To connect a real adapter later:

```bash
VITE_ADAPTER_MODE=real
VITE_ADAPTER_HTTP_URL=http://127.0.0.1:4317
VITE_ADAPTER_WS_URL=ws://127.0.0.1:4317
```

The page components depend on `AdapterClient`, so swapping `MockAdapterTransport` for a real HTTP/WebSocket transport should not require UI rewrites.

## Development

Install dependencies:

```bash
pnpm install
```

Run the web UI:

```bash
npm run dev
```

Run the desktop shell:

```bash
npm run tauri -- dev
```

Build:

```bash
npm run build
```

## Project Layout

```text
src/adapter    Contract types, adapter client, real transport, mock transport
src/fixtures   Mock scientific workflows and adapter snapshots
src/features   Workspace store and feature state
src-tauri      Tauri desktop shell
```

## Validation

Current validation:

```bash
npm run build
npm run tauri -- --version
```
