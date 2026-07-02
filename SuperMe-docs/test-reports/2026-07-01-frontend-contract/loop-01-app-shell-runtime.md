# Loop 01 - App Shell And Runtime Connection

## Test Task

Verify that the frontend App Shell loads and reflects adapter/runtime connectivity.

## Acceptance Criteria

- App Shell shows product name, project selector, New/Customize/Files entries, session filters, and connected runtime state.
- `GET /v1/health` reports healthy adapter and connected OpenCode runtime.

## Operations

1. Opened `http://127.0.0.1:5173` in the in-app browser.
2. Waited for initial adapter snapshots and WebSocket connection.
3. Queried `GET /v1/health`.

## Screenshot

![Loop 01 app shell](assets/loop-01-app-shell.png)

## Observed Result

- UI showed `OpenClaudeScience`, project selector, `New`, `Customize`, `Files`, `active/today/all`, and `connected`.
- Backend health returned `healthy: true`.
- Runtime reported `kind: opencode`, `mode: managed`, `connected: true`, `version: 1.17.12`.

## Verdict

Pass.

