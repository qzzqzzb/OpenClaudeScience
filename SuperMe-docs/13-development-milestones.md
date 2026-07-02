# Development Milestones

## Purpose

This document defines the OpenClaudeScience adapter development milestones. Milestones are organized by frontend integration value, not by backend module boundaries, so each loop can produce a testable product surface.

## Milestone Policy

- Each milestone must have an explicit objective, scope, and acceptance criteria before implementation starts.
- Loop work should target one milestone at a time unless the user explicitly changes priority.
- Loop execution follows `14-development-loop.md`.
- A milestone may contain multiple automatic loops after the user approves entry into that milestone.
- Moving from one milestone to the next requires explicit user review and approval.
- A milestone is not complete until its acceptance criteria are verified and the validation evidence is recorded in project docs.
- Do not silently substitute runtime, provider, model, permission policy, execution backend, or persistence layer to make a milestone appear complete.
- If a milestone is partially complete, record what works, what is missing, and what risks remain.

## Milestone 0: Runtime Foundation

Objective: The adapter can reliably start, connect to, or manage the OpenCode runtime and expose accurate health state to the frontend.

Scope:

- `external` and `managed` runtime modes.
- `/v1/health` reports adapter and OpenCode status.
- Windows PowerShell command behavior is explicit, especially `opencode.cmd`.
- Runtime startup failure, port conflict, shutdown, and cleanup behavior are explicit and logged.

Acceptance Criteria:

- `npm.cmd run dev:managed` starts the adapter and OpenCode runtime.
- `GET /v1/health` reports `runtime.connected=true` with OpenCode version.
- Normal foreground shutdown, such as `Ctrl+C`, cleans up the managed runtime.
- Runtime failure returns an explicit error state; no silent fallback is used.
- Type check and build pass.

Current Status:

- Complete as of 2026-07-01 16:45 Asia/Shanghai.
- Managed runtime startup, health, version validation, failure visibility, and shutdown cleanup have been implemented and verified.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.
- Final review subagent reported no findings.

## Milestone 1: Session And Chat Minimal Loop

Objective: The frontend can create a session, send a text message, and observe session/message lifecycle events.

Scope:

- `POST /v1/sessions`
- `GET /v1/sessions`
- `GET /v1/sessions/:id/messages`
- WebSocket `session.sendMessage`
- Events:
  - `session.created`
  - `session.statusChanged`
  - `message.created`
  - `message.completed`
  - `message.failed`
- Adapter session IDs map to OpenCode session IDs internally. Raw OpenCode IDs must not be required by the frontend.

Acceptance Criteria:

- A script or frontend client can create a session through the adapter.
- A WebSocket client can send one text prompt through `session.sendMessage`.
- OpenCode receives and executes the prompt.
- The frontend receives clear lifecycle events.
- If runtime is offline, the adapter returns `RUNTIME_UNAVAILABLE`.

Current Status:

- Complete as of 2026-07-01 17:22 Asia/Shanghai.
- The adapter now uses blocking OpenCode `session.prompt` for Milestone 1 completion semantics.
- Public session/message responses are adapter-normalized and do not expose raw OpenCode IDs or message schema.
- Success, failure, and runtime-offline lifecycle paths are covered by automated integration tests.
- Runtime prompt failures and runtime message errors are sanitized before reaching public HTTP/WS payloads.
- Real managed adapter/OpenCode/DeepSeek success and failure smoke tests passed.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.
- Review subagent findings were fixed.

## Milestone 2: OpenCode Event Normalization

Objective: The adapter converts OpenCode runtime events into stable frontend events.

Scope:

- Subscribe to OpenCode event stream.
- Normalize assistant message deltas and message part updates.
- Normalize tool start/output/completion/failure.
- Normalize initial permission request events.
- Normalize session idle/running/error states.
- Define and implement WebSocket reconnect behavior using `lastEventId`.

Acceptance Criteria:

- The frontend can display assistant streaming output in realtime.
- Tool steps can be rendered as expandable execution cells.
- Permission requests can appear as frontend events.
- Reconnect either replays missed events or returns an explicit snapshot refresh instruction.
- Raw OpenCode event schema does not leak into the frontend contract.

Current Status:

- Complete as of 2026-07-01 17:53 Asia/Shanghai.
- OpenCode `/event` is subscribed with project directory scoping and supervised reconnect.
- Runtime text deltas, tool states, permission requests, session status, and stream status are normalized into adapter events.
- Unknown replay cursors return `EVENT_REPLAY_UNAVAILABLE`.
- Runtime completion ownership remains with blocking prompt completion for Milestone 2 to avoid duplicate completion events.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.

## Milestone 3: Permission Broker v1

Objective: Permission card flow is usable and auditable.

Scope:

- Runtime permission prompt to adapter permission card.
- WebSocket `permission.respond`.
- Scope model:
  - `once`
  - `conversation`
  - `project`
  - `global`
- Settings > Permissions query and revoke.
- Persist project/global permission scopes.
- Map adapter scopes to OpenCode `once`, `always`, and `reject` behavior.

Acceptance Criteria:

- Shell, network, file, connector, and package-install permission requests can be represented as cards.
- Approve and deny decisions continue or block runtime execution as expected.
- Revoking a permission causes future matching requests to prompt again.
- Permission decisions are recorded with enough detail for audit.

Current Status:

- Complete as of 2026-07-01 18:01 Asia/Shanghai.
- Runtime permission requests are represented as adapter-owned permission records.
- Approve/deny decisions are routed back to OpenCode.
- Product scopes are stored as adapter permission grants and auto-applied to matching future requests.
- Revocation marks permission grants revoked and causes future matching requests to prompt again.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.

## Milestone 4: Artifact Store v1

Objective: Files generated or saved by Claude/runtime become frontend artifacts.

Scope:

- Artifact metadata.
- Artifact versions.
- Initial artifact kinds:
  - `markdown`
  - `code`
  - `pdf`
  - `figure`
  - `notebook`
  - `table`
  - `unknown`
- Operations:
  - Open
  - Rename
  - Star
  - Delete
  - Download
- Same-name saves create new versions.
- Artifacts link to session and message context.

Acceptance Criteria:

- The adapter can register generated or modified files as artifacts.
- The frontend can list, open, download, rename, star, and delete artifacts.
- Saving an artifact with the same name creates a new version instead of overwriting history.
- Artifact IDs and version IDs are adapter-owned.

Current Status:

- Complete as of 2026-07-01 18:14 Asia/Shanghai.
- Adapter can register project files as artifacts and create same-name versions.
- Artifact version metadata exposed to the frontend includes size, sha256, mime type, and source message IDs; file/blob paths stay internal to the adapter.
- Registered file content is snapshotted into adapter-owned storage under `ADAPTER_STORAGE_ROOT/artifacts`, outside the project root by default, so historical version downloads are stable.
- Frontend operations are adapter-owned: list, open, versions, download, rename, star, and soft delete.
- Paths outside the project root are rejected, including symlink targets that resolve outside the root.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.

## Milestone 5: Provenance v1

Objective: Each artifact version can explain how it was produced.

Scope:

- Provenance tabs:
  - Messages
  - Code
  - Execution Log
  - Environment
  - Review
- Execution log is the authoritative record.
- Initial coverage for shell/tool/code-driven artifact generation.

Acceptance Criteria:

- Each artifact version can return provenance.
- Provenance links to relevant messages, tool steps, file versions, and environment summary.
- Claims about execution are backed by execution log entries, not inferred from chat text.
- Missing provenance is explicit and does not appear as complete provenance.

Current Status:

- Complete as of 2026-07-01 18:41 Asia/Shanghai.
- Artifact versions can return five provenance tabs plus `status`, `missing`, and per-tab `completeness`.
- Execution log rows are captured from adapter-normalized tool events and linked explicitly by `executionStepIds`.
- Message and execution links are validated as known adapter IDs for the same session before registration.
- Caller-provided environment data is nested under `provided` and cannot override adapter-owned environment summary fields.
- Missing message/code/execution/review provenance is marked `missing`; environment is marked `partial` until full kernel/package capture exists.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.

## Milestone 6: Plan Flow

Objective: Complex tasks can produce a plan, wait for approval, and execute steps after approval.

Scope:

- `plan.proposed`
- `plan.approve`
- `plan.requestRevision`
- Plan step lifecycle events.
- Plan text is not directly editable.
- Plan changes happen through conversation-driven revision.
- Plan steps link to execution/provenance records.

Acceptance Criteria:

- The adapter can enter `awaiting approval` state.
- Plan steps do not execute before approval.
- A revision creates a new plan version or explicit replacement record.
- Step execution results appear in the conversation and provenance.

Current Status:

- Complete as of 2026-07-01 18:58 Asia/Shanghai.
- Adapter-owned plan records and step records exist in memory.
- `plan.propose` creates an awaiting-approval plan; `plan.approve` approves without claiming execution; `plan.recordStepResult` emits step lifecycle only with validated execution evidence; `plan.requestRevision` creates a replacement version.
- Milestone 6 v1 records lifecycle and explicit execution links; automatic OpenCode execution per plan step remains future work.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.

## Milestone 7: Annotation Flow

Objective: Artifact annotations can be staged in the composer and sent with the next user message.

Scope:

- `annotation.stage`
- `annotation.discard`
- `annotation.commitWithMessage`
- Anchor schemas for:
  - Markdown
  - code
  - PDF text
  - image points
  - HTML elements
- Composer "N comments" chip maps to adapter state.
- Sent annotations become message cards and are removed from transient artifact overlay state.

Acceptance Criteria:

- The frontend can stage multiple annotations.
- The next user message can include `annotationIds`.
- The adapter persists annotation records and binds them to the message.
- Artifact overlay state clears after send without losing annotation history.

Current Status:

- Complete as of 2026-07-01 19:13 Asia/Shanghai.
- Adapter-owned annotation records support staged, committed, and discarded states.
- `annotation.stage`, `annotation.discard`, `annotation.commitWithMessage`, and `session.sendMessage` with `annotationIds` are implemented.
- `annotation.committed` carries `clearedAnnotationIds` so the frontend can clear overlays while preserving message history.
- Runtime send failures keep annotations staged and do not clear overlays.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.

## Milestone 8: Reviewer Flow

Objective: Reviewer can run manually in v1 and produce findings cards. Automatic reviewer execution is a later extension and must be rejected until a real reviewer service is connected.

Scope:

- `reviewer.run`
- Review findings schema.
- Claim/evidence/transcript links.
- Reviewer result artifact/provenance tab.
- Follow-up path for Claude self-correction.

Acceptance Criteria:

- A manual reviewer result can run against a session or owned artifact version.
- Findings include claim, evidence, severity, and transcript/provenance links.
- Findings remain visible as session history and artifact provenance.
- Reviewer failures are reported explicitly.

Current Status:

- Complete as of 2026-07-01 19:55 Asia/Shanghai.
- Adapter-owned review runs and findings are implemented.
- `reviewer.run` emits started/findings/completed events and supports explicit failure reporting.
- Successful v1 runs require explicit linked findings; transcript and provenance links are validated against same-session evidence.
- `automatic` mode is rejected until real reviewer orchestration exists.
- Client-supplied review findings are rejected during artifact registration; strict review context parsing prevents finding-like fields from being silently stripped.
- Artifact review findings are attached to artifact provenance review tabs with transcript and provenance links preserved.
- Artifact-targeted reviews require same-session artifact ownership; sessionless artifacts are rejected as artifact review targets.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.
- Final confirmation review subagent reported no findings.

## Milestone 9: Delegation And Remote Jobs

Objective: The product supports parallel agent tracks and remote job lifecycle visibility.

Scope:

- Track graph.
- Subagent transcript links.
- Track status markers.
- Stop fan-out for the whole session.
- Remote job submission/status/logs.
- Remote job artifact collection and registration.

Acceptance Criteria:

- Multiple tracks can run with visible independent status.
- Clicking a track can show the child transcript.
- Stop halts the whole session, including relevant tracks and jobs.
- Remote job success, failure, cancellation, logs, and collected artifacts are represented clearly.

Current Status:

- Complete as of 2026-07-01 20:12 Asia/Shanghai.
- Adapter-owned tracks can be spawned, updated, stopped, listed, and nested through parent track IDs.
- Remote jobs can be submitted as queued records, updated explicitly, receive logs, and link same-session artifacts.
- `session.stop` cancels active tracks and queued/running remote jobs even when runtime abort fails, while surfacing the runtime error explicitly.
- Terminal tracks/jobs reject further mutation.
- Milestone 9 v1 does not start real remote compute or synthesize job success.
- Validation evidence is recorded in `SuperMe-docs/11-adapter-implementation.md`.
- Follow-up review subagent reported no findings.

## Suggested Loop Order

1. Harden Milestone 0.
2. Implement Milestone 1.
3. Implement Milestone 2.
4. Implement Milestone 3.
5. Implement Milestone 4 and Milestone 5 together only where artifact/provenance work naturally overlaps; otherwise keep them separate.
6. Continue with Plan, Annotation, Reviewer, then Delegation/Remote Jobs.

## Timeline

- 2026-07-01 15:50 Asia/Shanghai: Created milestone roadmap.
  Reason: The project is preparing for loop-driven adapter development and needs explicit milestone scope and acceptance criteria.
  Impact: Future implementation loops should reference this document when choosing scope and verifying completion.
- 2026-07-01 16:00 Asia/Shanghai: Linked milestones to milestone-gated loop development.
  Reason: The user defined automatic loops inside a milestone with user approval required between milestones.
  Impact: Codex may continue loop work inside an approved milestone but must stop for user review before starting the next milestone.
- 2026-07-01 16:45 Asia/Shanghai: Marked Milestone 0 complete.
  Reason: Runtime foundation acceptance criteria were verified, review-agent findings were fixed, and final review reported no blockers.
  Impact: Codex must stop at this milestone boundary and wait for user review before starting Milestone 1.
- 2026-07-01 17:22 Asia/Shanghai: Marked Milestone 1 complete.
  Reason: Session/chat minimal loop acceptance criteria were verified by automated integration tests, real managed runtime smoke tests, and review-agent findings were fixed.
  Impact: Codex must stop at this milestone boundary and wait for user review before starting Milestone 2.
- 2026-07-01 17:53 Asia/Shanghai: Marked Milestone 2 complete.
  Reason: OpenCode event stream normalization acceptance criteria were verified by automated integration tests, real managed runtime smoke tests, and review-agent findings were fixed.
  Impact: Codex may continue to Milestone 3 under the user's standing approval, unless frontend joint testing becomes required.
- 2026-07-01 18:01 Asia/Shanghai: Marked Milestone 3 complete.
  Reason: Permission broker acceptance criteria were verified by automated integration tests.
  Impact: Codex may continue to Milestone 4 under the user's standing approval, unless frontend joint testing becomes required.
- 2026-07-01 18:14 Asia/Shanghai: Marked Milestone 4 complete.
  Reason: Artifact Store v1 acceptance criteria were verified by automated integration tests.
  Impact: Codex may continue to Milestone 5 under the user's standing approval, unless frontend joint testing becomes required.
