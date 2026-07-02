# Adapter Implementation Notes

## Current Status

The first adapter skeleton is implemented as a TypeScript Node service under `src/adapter/`.

Implemented surfaces:

- HTTP server with `GET /v1/health`.
- Project endpoints.
- Session create/list/get/delete/messages/stop endpoints.
- File tree/content/search endpoints routed through OpenCode.
- Artifact metadata endpoints with an in-memory placeholder store.
- Permission list/revoke endpoints with an in-memory placeholder store.
- Settings/catalog placeholder endpoints.
- WebSocket command envelope and event envelope.
- OpenCode runtime bridge using `@opencode-ai/sdk`.

The adapter is intentionally fail-fast around runtime dependency. If OpenCode is not reachable, runtime-backed routes return `RUNTIME_UNAVAILABLE` or health reports `runtime.connected=false`.

## OpenCode Version

Pinned OpenCode SDK version:

```text
@opencode-ai/sdk@1.17.12
```

Installed OpenCode CLI version:

```text
opencode-ai@1.17.12
```

NPM showed `1.17.12` as the `latest` stable dist-tag on 2026-07-01. The adapter avoids `next`, `dev`, `beta`, and snapshot dist-tags.

The project does not currently depend on `opencode-ai` CLI directly. The CLI is installed globally so project `npm install` stays focused on the adapter and SDK. On this Windows host, PowerShell cannot run the generated `opencode.ps1` shim because script execution is disabled. Use `opencode.cmd` from PowerShell.

Recommended runtime startup:

```powershell
opencode.cmd serve --hostname 127.0.0.1 --port 4096 --cors http://127.0.0.1:5178
```

If running from Command Prompt instead of PowerShell, `opencode serve ...` should also work.

If the CLI is moved to a different host/port, point the adapter to that host/port with:

```powershell
$env:OPENCODE_HOST = "127.0.0.1"
$env:OPENCODE_PORT = "4096"
```

## DeepSeek Provider

The project has a tracked `opencode.json` that selects:

```text
deepseek/deepseek-chat
```

Secrets stay in local `.env`, which is git-ignored. The adapter loads project `.env` before building runtime config, so managed OpenCode inherits provider credentials when the adapter starts it.

Required local `.env` keys:

```text
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
OPENCODE_MODEL=deepseek/deepseek-chat
```

Do not commit `.env`. `.env.example` contains the non-secret key names for onboarding.

## Adapter Commands

Install dependencies:

```powershell
npm.cmd install
```

Run type check:

```powershell
npm.cmd run check
```

Build:

```powershell
npm.cmd run build
```

Start adapter:

```powershell
npm.cmd run dev
```

Start adapter and let it manage `opencode serve`:

```powershell
npm.cmd run dev:managed
```

Default adapter URL:

```text
http://127.0.0.1:5178
```

Health check:

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:5178/v1/health
```

Expected result without OpenCode running:

```json
{
  "healthy": true,
  "runtime": {
    "kind": "opencode",
    "sdkVersion": "1.17.12",
    "connected": false,
    "baseUrl": "http://127.0.0.1:4096"
  }
}
```

## Implementation Boundaries

Current adapter state is in memory. This is suitable for early frontend contract integration, not for durable sessions, permissions, artifacts, or audit logs.

The first OpenCode bridge supports text-only `session.sendMessage`. Non-text message parts such as artifact refs, upload refs, historical session refs, and skill refs are rejected with `UNSUPPORTED_MESSAGE_PART` until the corresponding adapter services exist.

Milestone 1 message completion uses OpenCode's blocking `session.prompt` endpoint. The adapter does not emit `message.completed` from `promptAsync` enqueue acceptance.

Session responses and `GET /v1/sessions/:id/messages` return adapter-owned IDs and adapter-normalized message DTOs. OpenCode session IDs, raw OpenCode message IDs, and raw OpenCode message schemas remain internal.

OpenCode runtime and message errors are sanitized before they are published to the frontend. Public error payloads use stable adapter codes and messages, not raw provider IDs, provider response bodies, OpenCode error names, or SDK error JSON.

The adapter subscribes to OpenCode `/event` with the project directory query and normalizes runtime events into frontend events. The subscription is supervised: if the stream disconnects or errors, the adapter publishes `runtime.statusChanged` and reconnects with a short backoff.

Artifact preview rendering, automatic/full provenance capture, notebook kernels, real remote job execution, automatic reviewer orchestration, durable settings, durable artifact metadata persistence, and permission scope persistence remain future work.

## Runtime Modes

The adapter supports two runtime modes:

```text
external
managed
```

`external` is the default. The adapter connects to an already-running OpenCode server at `OPENCODE_HOST:OPENCODE_PORT`.

`managed` starts OpenCode with:

```powershell
opencode.cmd serve --hostname 127.0.0.1 --port 4096 --cors http://127.0.0.1:5178
```

The managed process is stopped when the adapter shuts down normally, for example with `Ctrl+C` in the foreground terminal. A hard Windows process kill, such as `Stop-Process -Force`, can bypass the adapter shutdown handler and leave the child OpenCode process running; clean it manually if that happens.

## Validation

- 2026-07-01 15:12 Asia/Shanghai: `npm.cmd install` completed after removing direct `opencode-ai` CLI dependency.
- 2026-07-01 15:13 Asia/Shanghai: `npm.cmd run check` passed.
- 2026-07-01 15:13 Asia/Shanghai: `npm.cmd run build` passed.
- 2026-07-01 15:14 Asia/Shanghai: started `node dist/adapter/server.js`, called `GET /v1/health`, and confirmed adapter healthy with OpenCode runtime disconnected.
- 2026-07-01 15:30 Asia/Shanghai: installed global `opencode-ai@1.17.12`, verified `opencode.cmd --version`, started `opencode.cmd serve` on `127.0.0.1:4096`, and confirmed `GET /global/health` returned healthy with version `1.17.12`.
- 2026-07-01 15:34 Asia/Shanghai: added `ADAPTER_RUNTIME_MODE=managed`, verified managed startup reported runtime connected with OpenCode version `1.17.12`, and cleaned up a test orphan left by forced process termination.
- 2026-07-01 16:39 Asia/Shanghai: hardened managed runtime startup.
  Evidence:
  - `npm.cmd run test` passed: 2 test files, 7 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  - Managed success smoke passed: `ADAPTER_RUNTIME_MODE=managed` started adapter and OpenCode, `/v1/health` reported `runtime.connected=true`, `manager.status=running`, and OpenCode version `1.17.12`.
  - Managed shutdown smoke passed: sending `SIGINT` to adapter cleaned port `4096`.
  - Managed failure smoke passed: invalid `OPENCODE_COMMAND=definitely-not-opencode.cmd` kept adapter healthy and exposed `manager.status=failed` through `/v1/health`.
  - Runtime health now requires OpenCode health to include the pinned version `1.17.12`; missing or mismatched version returns `connected=false`.
- 2026-07-01 16:45 Asia/Shanghai: completed Milestone 0 review.
  Evidence:
  - Initial review subagent found two issues: runtime health accepted missing/mismatched versions, and managed startup failures were not observable through `/v1/health`.
  - Both findings were fixed.
  - Final review subagent reported no findings.
  Residual risks:
  - Real `/v1/health` managed success/failure/shutdown behavior is smoke-tested but not yet covered by automated integration tests.
  - Successful global CLI resolution is smoke-verified on this Windows machine; automated tests cover failure behavior.
  - Forced process kills can still leave OpenCode orphaned; normal foreground shutdown is verified and hard-kill behavior is documented.
- 2026-07-01 17:00 Asia/Shanghai: connected DeepSeek provider and ran real model smoke tests.
  Evidence:
  - `opencode.cmd debug config` showed project config merged with `model=deepseek/deepseek-chat`, `enabled_providers=deepseek`, and provider key `deepseek`.
  - Direct DeepSeek chat completion returned `OK` for a minimal prompt using `DEEPSEEK_MODEL=deepseek-chat`.
  - `opencode.cmd run --model deepseek/deepseek-chat --format json "Reply exactly: OK"` returned assistant text `OK`.
  - Adapter end-to-end smoke passed: managed adapter started OpenCode `1.17.12`, `POST /v1/sessions` created a session, WebSocket `session.sendMessage` emitted `ack`, `session.statusChanged`, `message.created`, and `message.completed`, and `GET /v1/sessions/:id/messages` contained assistant text `OK`.
  - `npm.cmd run test` passed: 3 test files, 8 tests.
  - `npm.cmd run check` passed.
- 2026-07-01 17:22 Asia/Shanghai: completed Milestone 1 session/chat minimal loop.
  Evidence:
  - Replaced OpenCode `promptAsync` with blocking `session.prompt` for Milestone 1 message completion.
  - Kept OpenCode session IDs in an internal adapter store mapping; public session responses no longer include `runtimeSessionId`.
  - Normalized `GET /v1/sessions/:id/messages` into adapter message DTOs with adapter-owned `msg_*` and `part_*` IDs.
  - Added server integration tests with a fake OpenCode server covering session creation, WebSocket success lifecycle, unsupported-part failure lifecycle, OpenCode prompt failure sanitization, runtime message error sanitization, final error session status, public payload normalization, and `RUNTIME_UNAVAILABLE`.
  - Real managed adapter/OpenCode/DeepSeek smoke passed: success path emitted `ack`, `session.statusChanged`, `message.created`, `message.completed`, and final `session.statusChanged`; adapter message readback contained `OK` with public `msg_*` and `part_*` IDs.
  - Real failure smoke passed: unsupported `artifact_ref` emitted `ack`, `session.statusChanged`, `message.created`, `message.failed`, `session.statusChanged`, and `error`; final session status was `error`.
  - `npm.cmd run test` passed: 4 test files, 13 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  - Review subagents reported six total findings; all were fixed or addressed by this closeout: blocking completion, raw OpenCode leakage, automated lifecycle tests, docs/verification records, runtime message error sanitization, and OpenCode SDK error sanitization.
  - Final focused review subagent reported no findings.
  Residual risks:
  - Runtime message error mapping is intentionally coarse; unknown runtime errors collapse to `RUNTIME_MESSAGE_ERROR`.
  - Future use of WebSocket `details` must not include raw runtime/provider objects.
  - Streaming and detailed OpenCode event normalization remain Milestone 2 scope.
- 2026-07-01 17:53 Asia/Shanghai: completed Milestone 2 OpenCode event normalization.
  Evidence:
  - Added OpenCode `/event` subscription with `query.directory` set to the project root.
  - Added supervised event stream reconnect; disconnects/errors publish `runtime.statusChanged` and the adapter reconnects instead of silently losing events.
  - Normalized runtime text part updates into `message.delta`.
  - Normalized runtime tool part states into `tool.started`, `tool.output`, `tool.completed`, and `tool.failed`.
  - Normalized runtime permission updates into adapter-owned `permission.requested` records.
  - Normalized runtime session status and idle events into adapter `session.statusChanged`.
  - Unknown WebSocket replay cursors now return `EVENT_REPLAY_UNAVAILABLE` so the frontend can refresh snapshots.
  - Runtime `message.updated` completion events are not converted into `message.completed` in Milestone 2, avoiding duplicate empty completions while blocking prompt completion remains active.
  - Added integration tests for event stream normalization, replay, unknown replay cursor, event stream reconnect, project-directory event subscription, and duplicate completion prevention.
  - `npm.cmd run test` passed: 4 test files, 17 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  - Real managed adapter/OpenCode/DeepSeek smoke passed with `message.delta` events and assistant text `OK`.
  - Review subagents reported six total findings; all were fixed before closeout.
  - Final focused review subagent reported no findings.
  Residual risks:
  - `message.completed` remains prompt-owned; if completion moves fully to runtime events later, explicit ownership/de-duplication is required.
  - Tool event payloads are intentionally coarse until execution log/provenance work.
  - Permission cards are emitted, but scope persistence and enforcement are Milestone 3 scope.
- 2026-07-01 18:01 Asia/Shanghai: completed Milestone 3 Permission Broker v1.
  Evidence:
  - Runtime `permission.updated` events create adapter-owned permission records with `perm_*` IDs; raw runtime permission IDs remain internal.
  - `permission.respond` calls OpenCode permission reply using the internal runtime mapping.
  - Approve maps `once` to OpenCode `once`; `conversation`, `project`, and `global` map to OpenCode `always` while adapter grants preserve product scope.
  - Deny maps to OpenCode `reject`.
  - Adapter stores permission grants for approved scopes and auto-applies matching active grants to future runtime permission requests.
  - Revoke marks the permission and grants revoked; future matching requests become pending again.
  - Once approvals do not create active grants.
  - Revoking an auto-approved permission revokes the underlying grant that approved it.
  - Missing runtime permission mappings fail explicitly instead of publishing fake success.
  - `GET /v1/permissions` returns permission records and grant records for Settings > Permissions.
  - Added integration tests for approve/project grant, auto-apply, revoke, pending-after-revoke, auto-approved revoke, approve-without-scope once semantics, missing runtime mapping, and deny/reject.
  - `npm.cmd run test` passed: 4 test files, 22 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  - Review subagents reported six total findings; all were fixed.
  - Final focused review subagent reported no findings.
  Residual risks:
  - Permission persistence is still in-memory until a durable store milestone.
  - Runtime mapping failure currently surfaces as `INTERNAL_ERROR`; a more specific public error code may be useful later.
- 2026-07-01 18:14 Asia/Shanghai: completed Milestone 4 Artifact Store v1.
  Evidence:
  - Added adapter-native artifact registration endpoint.
  - Registering a project file creates an adapter-owned artifact and version with `art_*` and `ver_*` IDs.
  - Re-registering the same artifact name in the same session creates a new version and updates `currentVersionId`.
  - Artifact versions record size, sha256, mime type, and source message IDs in the public contract.
  - Registered file bytes are snapshotted into adapter-owned storage under `ADAPTER_STORAGE_ROOT/artifacts`, outside the project root by default, so historical downloads are stable if the source file changes.
  - Public artifact/version responses and events do not expose project file paths or adapter blob paths.
  - Added download endpoint for artifact versions.
  - Existing list/open/rename/star/delete endpoints and artifact WebSocket helpers operate on adapter-owned artifact records.
  - `artifact.open` emits `artifact.opened`; `artifact.downloadUrl` emits `artifact.downloadUrlCreated`.
  - `session.open` validates the session and emits `session.updated`; unsupported commands return `COMMAND_NOT_IMPLEMENTED`.
  - Paths outside the project root are rejected, including symlink targets that resolve outside the root.
  - `ADAPTER_STORAGE_ROOT` is validated at startup and rejected if it is inside `PROJECT_ROOT` or resolves through a symlink into it.
  - Deleted artifacts return 404 from version/provenance/download surfaces.
  - Added integration tests for register, version, list, versions, historical download snapshots, WebSocket open/download URL, rename, star, delete, lexical path escape rejection, symlink escape rejection, and storage-root validation.
  - `npm.cmd run test` passed: 5 test files, 29 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  - Initial review subagent reported five findings; all were fixed.
  - Follow-up review subagent reported two findings; both were fixed.
  - Final narrow review subagent reported one documentation finding; it was fixed.
  Residual risks:
  - Artifact metadata and blob references are still in-memory until a durable store milestone.
  - Artifact registration is explicit; automatic detection of generated files can be broadened later.
- 2026-07-01 18:41 Asia/Shanghai: completed Milestone 5 Provenance v1.
  Evidence:
  - Artifact registration accepts optional provenance context: `executionStepIds`, inline code entries, environment summary, and review records.
  - Adapter indexes normalized `tool.*` events into execution log records with adapter-owned `tool_*` IDs.
  - `GET /v1/artifacts/:artifactId/versions/:versionId/provenance` returns five tabs: Messages, Code, Execution Log, Environment, Review.
  - Provenance response includes `status`, `missing`, and per-tab `completeness` so absent evidence is explicit.
  - Execution log rows come from captured adapter tool events and are linked by `executionStepIds`; the adapter does not infer execution from chat text.
  - Source message IDs and execution step IDs are validated as known adapter IDs for the same session before registration.
  - Caller-provided environment fields are namespaced under `environment.provided` and cannot overwrite adapter-owned `adapter`, `runtime`, or `artifact` summaries.
  - Review provenance is typed; `not_run` records absence and does not count as linked reviewer evidence.
  - Tool events without a stable runtime identity are ignored for execution provenance so they cannot collide into a shared adapter step ID.
  - Public provenance does not expose raw OpenCode session IDs, message IDs, or call IDs.
  - Added integration tests for linked execution/code/environment provenance, explicit missing provenance, raw/cross-session provenance rejection, malformed tool event handling, and environment override protection.
  - `npm.cmd run test` passed: 5 test files, 32 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  Review:
  - Initial review subagent reported four findings; all were fixed.
  - Follow-up review subagent reported one finding; it was fixed.
  - Final narrow review subagent reported no findings.
  Residual risks:
  - Environment capture is partial: adapter/runtime/artifact metadata plus caller-provided fields, not full kernel/package snapshots.
  - Code provenance is inline metadata in v1; downloadable producer scripts/notebooks can be added later.
  - Provenance state is still in-memory until durable storage.
- 2026-07-01 18:58 Asia/Shanghai: completed Milestone 6 Plan Flow.
  Evidence:
  - Added adapter-owned plan records with `plan_*` and `pstep_*` IDs.
  - Added `POST /v1/plans` and `GET /v1/sessions/:sessionId/plans`.
  - Added WebSocket `plan.propose`, `plan.approve`, and `plan.requestRevision`.
  - Plan proposals enter `awaiting_approval`; steps stay pending before approval.
  - Plan revision creates a replacement plan version with `supersedesPlanId` and `revisionRequest`; plan text is not directly patched.
  - Approval emits `plan.approved` only; it does not imply execution success.
  - `plan.recordStepResult` requires known same-session adapter execution step IDs before emitting `plan.stepStarted` / `plan.stepCompleted`.
  - `plan.recordStepResult` rejects running or failed execution logs; step completion requires completed execution evidence.
  - `plan.completed` is emitted only after every step has evidence-backed completion.
  - Added integration tests for propose, no pre-approval step execution, revision replacement, approval, evidence-backed step lifecycle, invalid state transitions, HTTP snapshots, and rejected unverified execution links.
  - `npm.cmd run test` passed: 5 test files, 34 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  Review:
  - Initial review subagent reported three findings; all were fixed.
  - Follow-up review subagent reported one finding; it was fixed.
  - Final narrow review subagent reported no findings.
  Residual risks:
  - Milestone 6 v1 records plan lifecycle but does not automatically execute OpenCode prompts per step.
  - Plan state remains in-memory until durable storage.
- 2026-07-01 19:13 Asia/Shanghai: completed Milestone 7 Annotation Flow.
  Evidence:
  - Added adapter-owned annotation records with `ann_*` IDs and statuses: `staged`, `committed`, `discarded`.
  - Added anchor schemas for Markdown, code, PDF text, image points, and HTML elements.
  - Added WebSocket `annotation.stage`, `annotation.discard`, and `annotation.commitWithMessage`.
  - `session.sendMessage` validates provided `annotationIds`, emits staged annotation cards in `message.created`, and commits annotations only after runtime send succeeds.
  - Annotation commit revalidates artifact/version liveness after runtime send succeeds, before mutation/emission, to close in-flight delete races.
  - `annotation.committed` carries `clearedAnnotationIds`; failed runtime sends keep annotations staged and do not clear overlays.
  - Annotation commit/discard batches are validated before mutation to avoid partial commits/discards.
  - Stage and commit validate artifact/session ownership, effective artifact version IDs, and deleted artifact/version state.
  - Added `GET /v1/sessions/:sessionId/annotations` with all annotation history plus current staged annotations.
  - Added integration tests for staging multiple annotations, discarding one, successful commit with next message, failed send rollback, atomic batch validation, cross-session ownership rejection, effective version binding, deleted-artifact rejection, in-flight delete revalidation, clearing staged overlay state, and preserving committed/discarded history.
  - `npm.cmd run test` passed: 5 test files, 38 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  Review:
  - Initial review subagent reported five findings; all were fixed.
  - Follow-up review subagent reported one finding; it was fixed.
  - Final narrow review subagent reported no findings.
  Residual risks:
  - Annotation state remains in-memory until durable storage.
  - PDF/image/HTML anchors are schema-level v1 support; rendering validation belongs to frontend joint testing.
- 2026-07-01 19:55 Asia/Shanghai: completed Milestone 8 Reviewer Flow.
  Evidence:
  - Added adapter-owned review run records with `rev_*` IDs and finding records with `finding_*` IDs.
  - Added WebSocket `reviewer.run`.
  - Added `GET /v1/sessions/:sessionId/reviews`.
  - `reviewer.run` emits `review.started`, `review.findings`, and `review.completed` for successful runs.
  - Reviewer failures emit `review.started` followed by `review.completed` with `status: failed` and an explicit error.
  - Successful v1 reviewer runs require explicit findings or an explicit failure reason; empty successful runs are rejected before a review record or `review.started` event is created.
  - Finding inputs require transcript and provenance links. Transcript links must resolve to known same-session adapter message IDs. Artifact review provenance links must match the reviewed artifact version, and session review provenance links must match the session review snapshot.
  - Finding links are preserved in review snapshots and artifact provenance review tabs.
  - Artifact registration rejects client-supplied review findings; findings are created through `reviewer.run`, while registration may still record strict `not_run` or `summary` review context without silently stripping finding-like fields.
  - Artifact-targeted reviews validate same-session artifact version ownership and reject cross-session or sessionless artifact review targets.
  - `automatic` reviewer mode is rejected until real reviewer orchestration exists.
  - Added integration tests for successful artifact review findings, session-only review findings, repeated provenance linkage, review snapshots, explicit reviewer failure, cross-session artifact target rejection, sessionless artifact target rejection, missing finding links, unknown transcript links, mismatched provenance links, rejected registration-time findings, rejected disguised summary/not_run registration-time findings, rejected automatic mode, and empty reviewer run rejection.
  - `npm.cmd run test` passed: 5 test files, 41 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  Review:
  - Initial review subagent reported four findings; all were fixed.
  - Follow-up review subagent reported three findings; all were fixed.
  - Narrow final review subagent reported one finding; it was fixed.
  - Final confirmation review subagent reported no findings.
  Residual risks:
  - Milestone 8 v1 accepts explicit manual findings; automatic reviewer-agent execution is future work.
  - Review state remains in-memory until durable storage.
- 2026-07-01 20:12 Asia/Shanghai: completed Milestone 9 Delegation And Remote Jobs.
  Evidence:
  - Added adapter-owned track records with `track_*` IDs, parent track links, agent kind, transcript URL, statuses, messages, errors, and metadata.
  - Added WebSocket `track.spawn`, `track.update`, and `track.stop`.
  - Added `GET /v1/sessions/:sessionId/tracks`.
  - Track lifecycle emits `track.created`, `track.statusChanged`, `track.message`, and `track.completed`.
  - Added adapter-owned remote job records with `rjob_*` IDs, provider, title, command, external URL, status, logs, artifact IDs, and metadata.
  - Added WebSocket `remoteJob.submit`, `remoteJob.update`, and `remoteJob.appendLog`.
  - Added `GET /v1/sessions/:sessionId/remote-jobs`.
  - Remote job lifecycle emits `remoteJob.submitted`, `remoteJob.statusChanged`, and `remoteJob.logAppended`.
  - Remote job artifact collection validates same-session adapter-owned artifacts and rejects duplicate or cross-session artifact IDs.
  - Cross-session parent tracks, cross-session job tracks, cross-session job artifacts, and terminal track/job mutations are rejected.
  - `session.stop` and `POST /v1/sessions/:sessionId/stop` fan out to cancel active tracks and queued/running remote jobs before final session stopped status, even if runtime abort fails; runtime abort failure is still surfaced explicitly.
  - Terminal remote jobs reject further state updates and log appends.
  - Milestone 9 v1 records external/child work lifecycle but does not start real remote compute or synthesize job success.
  - `npm.cmd run test` passed: 5 test files, 46 tests.
  - `npm.cmd run check` passed.
  - `npm.cmd run build` passed.
  Review:
  - Initial review subagent reported three findings; all were fixed.
  - Follow-up review subagent reported no findings.
  Residual risks:
  - Track and remote job state remain in-memory until durable storage.
  - Real multi-agent transcript creation and external job provider submission are future integrations.
