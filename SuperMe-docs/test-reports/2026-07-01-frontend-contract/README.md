# Frontend Contract Browser Test Report

Date: 2026-07-01

Target:

- Frontend: `http://127.0.0.1:5173`
- Adapter: `http://127.0.0.1:5178`
- Runtime: managed OpenCode `1.17.12`

Scope:

- Tested against `SuperMe-docs/10-adapter-contract.md`, `SuperMe-docs/13-development-milestones.md`, and the Claude Science frontend behavior requested by product.
- Tests used the real frontend in the in-app browser, real adapter HTTP/WebSocket contract, and managed OpenCode for chat turns.

## Summary

| Loop | Area | Verdict | Notes |
| --- | --- | --- | --- |
| 01 | App shell/runtime connection | Pass | UI and `/v1/health` both show connected runtime. |
| 02 | No-session chat send | Pass | Frontend auto-created a session, retained user message, and received OpenCode reply. |
| 03 | Refresh/session replay | Pass with caveat | Reload lands on Active with no idle session selected; selecting All restores messages. |
| 04 | Files/settings catalogs | Pass with caveat | Files and Settings render; Files also displays ignored/sensitive entries such as `.env`. |
| 05 | Artifact registration/preview/provenance | Pass with caveat | Artifact opens after reopening session; `artifact.created` alone does not activate it from Settings. |
| 06 | Artifact provenance/star | Pass | Five provenance tabs render and star operation syncs to backend. |
| 07 | Plan flow | Pass with caveat | Approve works; UI still shows Approve/Request revision after approved. |
| 08 | Annotation flow | Pass with caveat | Staging and commit work; message order showed assistant before user for the committed turn. |
| 09 | Reviewer flow | Fail | Backend/provenance receives manual finding, but frontend does not render findings card. |
| 10 | Delegation/remote jobs | Pass with caveat | Backend `succeeded` appears as frontend `completed`; logs render. |
| 11 | Permission cards | Blocked | Settings snapshot works, but no deterministic real permission prompt was available in managed OpenCode. |

Full compact machine-readable result: [results-summary.json](results-summary.json)

## Combined Report

- [All loops inline report](combined-report.md)

## Reports

- [Loop 01 - App Shell Runtime](loop-01-app-shell-runtime.md)
- [Loop 02 - No Session Chat](loop-02-no-session-chat.md)
- [Loop 03 - Refresh Snapshot](loop-03-refresh-snapshot.md)
- [Loop 04 - Files Settings](loop-04-files-settings.md)
- [Loop 05 - Artifact Preview Provenance](loop-05-artifact-preview-provenance.md)
- [Loop 06 - Artifact Operations](loop-06-artifact-operations.md)
- [Loop 07 - Plan Flow](loop-07-plan-flow.md)
- [Loop 08 - Annotation Flow](loop-08-annotation-flow.md)
- [Loop 09 - Reviewer Flow](loop-09-reviewer-flow.md)
- [Loop 10 - Delegation Remote Jobs](loop-10-delegation-remote-jobs.md)
- [Loop 11 - Permission Cards](loop-11-permission-cards.md)
