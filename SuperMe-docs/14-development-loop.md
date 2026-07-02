# Development Loop

## Purpose

This document defines the loop-driven development process for OpenClaudeScience. It complements `13-development-milestones.md`.

Milestones define product gates. Loops define the automatic work cycle inside a milestone.

## Core Rule

A milestone is user-gated. A loop is agent-automated.

After the user approves entry into a milestone, the current Codex conversation may run as many loops as needed inside that milestone. Codex must not move into the next milestone until the current milestone has been marked complete and the user has reviewed and approved the transition.

The current Codex conversation owns loop execution. Do not create a separate thread, worker, automation, or background agent to own the loop unless the user explicitly asks. The review subagent used in Stage 3 is independent review support, not the loop executor.

## Loop Stages

### Stage 1: Scope, Context, And Acceptance

At the start of every loop, Codex must produce a loop brief with:

- task objective;
- milestone being advanced;
- relevant context index;
- acceptance criteria;
- expected verification evidence.

The context index should point to the smallest sufficient set of files or docs. Typical entries include:

- `AGENTS.md`
- `SuperMe-policies/project-policy.md`
- `SuperMe-policies/default-workflow.md`
- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- relevant source files under `src/adapter/`
- relevant package or test files

If Stage 1 determines that the milestone objective and acceptance criteria are already complete, Codex must:

1. stop the loop before implementation;
2. record the completion evidence in project docs;
3. mark the milestone complete in `13-development-milestones.md` or a linked status doc;
4. hand off to the user for review;
5. wait for explicit user approval before starting the next milestone.

### Stage 2: Implementation

Codex implements only the Stage 1 objective.

Rules:

- Keep changes scoped to the loop objective.
- Use the adapter contract and milestone acceptance criteria as the boundary.
- Keep OpenCode runtime details behind the adapter.
- Do not introduce silent fallback.
- Do not treat frontend state as authoritative for adapter-owned state.
- Update docs when durable project state, contract, milestone status, or validation changes.

### Stage 3: Review Agent Verification

After implementation, Codex must run the project review subagent skill when available:

```text
$review-pr-subagent
```

The review target may be:

- the current uncommitted workspace;
- a branch diff;
- a PR;
- a named loop milestone.

The review must check implementation against:

- project policy;
- adapter contract;
- milestone acceptance criteria;
- runtime boundary rules;
- validation evidence.

When the review returns:

- close or terminate the subagent if a close mechanism exists;
- report if the subagent auto-closed or no close tool exists;
- fix findings before considering the loop complete;
- if a finding is intentionally deferred, record the rationale and remaining risk.

## Loop Completion

A loop is complete only when:

- Stage 1 objective has been implemented or determined unnecessary because the milestone is already complete;
- relevant checks have been run;
- review agent findings are fixed or explicitly deferred;
- project docs record material state changes and validation evidence;
- remaining risks are explicit.

## Milestone Completion

A milestone is complete only when:

- all acceptance criteria in `13-development-milestones.md` are satisfied;
- verification evidence is recorded;
- the review agent has reviewed the completed milestone or final loop;
- unresolved findings are fixed or explicitly accepted by the user;
- Codex has handed off to the user for review.

Codex must not begin the next milestone without explicit user approval.

## Loop Brief Template

```md
## Loop Brief

Milestone:

Objective:

Relevant Context:
- ...

Acceptance Criteria:
- ...

Expected Verification:
- ...

Milestone Completion Check:
- Complete already? yes/no
- Evidence:
```

## Loop Closeout Template

```md
## Loop Closeout

Milestone:

Objective Completed: yes/no

Changes:
- ...

Verification:
- ...

Review Agent:
- Started: yes/no
- Closed: yes/no
- Findings fixed/deferred:

Docs Updated:
- ...

Remaining Risk:
- ...
```

## Timeline

- 2026-07-01 16:00 Asia/Shanghai: Created milestone-gated loop development process.
  Reason: The project will use automatic loops within a milestone, while requiring user review before advancing to the next milestone.
  Impact: Future development should begin each loop with a scoped brief, implement, run review-agent verification, fix findings, and stop at milestone boundaries for user approval.
- 2026-07-01 16:05 Asia/Shanghai: Clarified loop execution ownership.
  Reason: The user specified that loops are executed by the current Codex conversation.
  Impact: Codex should not hand loop ownership to a separate worker, thread, automation, or background agent unless explicitly asked; only Stage 3 review uses an independent review subagent.
- 2026-07-01 16:45 Asia/Shanghai: Completed first Milestone 0 loop.
  Reason: Runtime foundation hardening was implemented, verified, reviewed by subagent, fixed, and re-reviewed with no findings.
  Impact: Milestone 0 is complete and Codex must wait for user approval before starting Milestone 1.
- 2026-07-01 17:22 Asia/Shanghai: Completed Milestone 1 loop.
  Reason: Session/chat minimal loop was implemented, verified with automated and real runtime tests, reviewed by subagent, and all findings were fixed.
  Impact: Milestone 1 is complete and Codex must wait for user approval before starting Milestone 2.
- 2026-07-01 17:53 Asia/Shanghai: Completed Milestone 2 loop.
  Reason: OpenCode event normalization was implemented, verified with automated and real runtime tests, reviewed by subagent, and all findings were fixed.
  Impact: Under the user's standing approval, Codex may continue to Milestone 3 unless frontend joint testing is required.
- 2026-07-01 18:01 Asia/Shanghai: Completed Milestone 3 loop.
  Reason: Permission broker v1 was implemented and verified with automated runtime-adapter tests.
  Impact: Under the user's standing approval, Codex may continue to Milestone 4 unless frontend joint testing is required.
- 2026-07-01 18:14 Asia/Shanghai: Completed Milestone 4 loop.
  Reason: Artifact Store v1 was implemented and verified with automated adapter tests.
  Impact: Under the user's standing approval, Codex may continue to Milestone 5 unless frontend joint testing is required.

## Loop Closeouts

### Milestone 0 Runtime Foundation - Loop 1

Objective Completed: yes.

Changes:

- Hardened OpenCode runtime health validation to require pinned version `1.17.12`.
- Made managed runtime state explicit: `idle`, `starting`, `running`, `attached`, `stopped`, `failed`.
- Prevented managed mode from attaching to an occupied port unless OpenCode health validates.
- Resolved Windows `opencode.cmd` to the real `opencode.exe` to avoid shell-proxy process ownership.
- Changed server startup so adapter listens even when managed runtime startup fails, exposing failure through `/v1/health`.
- Added runtime manager and health validation tests.

Verification:

- `npm.cmd run test` passed: 2 files, 7 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.
- Managed success smoke passed.
- Managed shutdown smoke passed; `SIGINT` cleaned port `4096`.
- Managed failure smoke passed; invalid `OPENCODE_COMMAND` left adapter healthy with `manager.status=failed`.

Review Agent:

- Started: yes.
- Closed: yes.
- First pass findings: 2.
- Findings fixed: 2.
- Final pass: no findings.

Docs Updated:

- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Real server-path smoke checks are not yet automated integration tests.
- Successful global CLI resolution is smoke-tested on this machine but not automated.
- Forced process kills can still leave OpenCode orphaned; normal shutdown is verified.

### Milestone 1 Session And Chat Minimal Loop - Loop 1

Objective Completed: yes.

Changes:

- Switched text message sends from OpenCode `promptAsync` to blocking `session.prompt` before emitting `message.completed`.
- Kept OpenCode session IDs in an internal adapter mapping instead of returning them to the frontend.
- Removed raw OpenCode session data from `session.created` events.
- Normalized HTTP message snapshots into adapter-owned message IDs, part IDs, roles, statuses, and text parts.
- Added `message.failed` publication and session `error` status on send failures.
- Sanitized OpenCode runtime errors and runtime message errors before publishing them to frontend HTTP/WS payloads.
- Added server integration tests covering session creation, WebSocket success, WebSocket failure, OpenCode prompt failure sanitization, runtime message error sanitization, runtime offline, and public payload normalization.

Verification:

- `npm.cmd run test` passed: 4 files, 13 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.
- Real managed adapter/OpenCode/DeepSeek success smoke passed with assistant text `OK`.
- Real managed failure smoke passed with `message.failed` and final session status `error`.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 6 across initial review and follow-up review.
- Findings fixed: 6.
- Final focused review: no findings.
- Final focused review: no findings.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Milestone 2 still needs streaming/event normalization; Milestone 1 only returns completed message snapshots.
- Non-text runtime parts are represented as `unsupported` until Milestone 2 expands part normalization.
- Runtime message error mapping is intentionally coarse.
- Future use of WebSocket `details` must avoid raw runtime/provider objects.

### Milestone 2 OpenCode Event Normalization - Loop 1

Objective Completed: yes.

Changes:

- Added OpenCode event stream subscription through the runtime bridge.
- Added supervised reconnect and explicit `runtime.statusChanged` disconnect/error events.
- Added project-directory scoping to event subscription.
- Added runtime event normalization for text deltas, tool states, permission requests, session status, and stream status.
- Added explicit `EVENT_REPLAY_UNAVAILABLE` for stale or unknown WebSocket replay cursors.
- Kept `message.completed` ownership with blocking prompt completion for now, avoiding duplicate completion from runtime `message.updated`.
- Added integration tests for live event normalization, replay, unknown cursor handling, reconnect, directory scoping, and duplicate-completion prevention.

Verification:

- `npm.cmd run test` passed: 4 files, 17 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.
- Real managed adapter/OpenCode/DeepSeek smoke passed with `message.delta` events and assistant text `OK`.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 6 across initial review and follow-up review.
- Findings fixed: 6.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Completion is still prompt-owned, not fully event-owned; a future streaming-first loop should add explicit message lifecycle de-duplication if ownership moves.
- Tool payloads are sufficient for expandable cells but still coarse; richer execution logs are Milestone 5 scope.
- Permission events create adapter permission cards, but decision persistence and scope enforcement remain Milestone 3 scope.

### Milestone 3 Permission Broker v1 - Loop 1

Objective Completed: yes.

Changes:

- Added internal runtime permission mappings for adapter permission records.
- Added permission grant storage for approved scopes.
- Implemented `permission.respond` runtime reply integration.
- Implemented approve/deny mapping to OpenCode `once`, `always`, and `reject`.
- Implemented auto-approval for matching active conversation/project/global grants.
- Implemented revoke semantics that deactivate grants created by a permission and the underlying applied grant for auto-approved permissions.
- Updated `GET /v1/permissions` to return permission and grant records.
- Added integration tests for approve, deny, auto-apply, revoke, and prompt-after-revoke behavior.
- Added integration tests for auto-approved revoke, approve-without-scope as `once`, and missing runtime mapping failures.

Verification:

- `npm.cmd run test` passed: 4 files, 22 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 6 across initial review and follow-up review.
- Findings fixed: 6.
- Final focused review: no findings.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Permission grant matching is intentionally conservative and based on type/title/details signature.
- Permission persistence is still in-memory until a durable store milestone.
- Runtime mapping failure currently surfaces as `INTERNAL_ERROR`; a more specific public error code may be useful later.

### Milestone 4 Artifact Store v1 - Loop 1

Objective Completed: yes.

Changes:

- Added `POST /v1/artifacts/register`.
- Added artifact version metadata with version number, source message IDs, size, sha256, and mime type.
- Snapshotted registered file bytes into adapter-owned `ADAPTER_STORAGE_ROOT/artifacts` storage for stable historical downloads.
- Removed project/blob paths from public artifact version payloads and artifact events.
- Added same-name versioning within a session.
- Added artifact version download endpoint.
- Added WebSocket `artifact.open` and `artifact.downloadUrl` helpers.
- Made `session.open` validate and emit `session.updated`; unsupported commands now return `COMMAND_NOT_IMPLEMENTED`.
- Kept artifact IDs and version IDs adapter-owned.
- Rejected artifact paths outside the project root, including symlink targets that resolve outside the root.
- Added startup validation that rejects `ADAPTER_STORAGE_ROOT` inside `PROJECT_ROOT`, including symlink targets that resolve into the project.
- Added integration tests for artifact register/version/list/open/download snapshot/rename/star/delete/path escape behavior.

Verification:

- `npm.cmd run test` passed: 5 files, 29 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 9 across initial, follow-up, and final narrow review.
- Findings fixed: 9.
- Final narrow review: documentation-only finding fixed.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Artifact metadata and blob references are still in-memory until a durable store milestone.
- Artifact registration is explicit; automatic detection of generated files can be broadened later.

### Milestone 5 Provenance v1 - Loop 1

Objective Completed: yes.

Stage 1 Context:

- Milestone target: each artifact version can explain how it was produced.
- Contract surface: `GET /v1/artifacts/:artifactId/versions/:versionId/provenance`.
- Relevant implementation context:
  - Runtime tool events are normalized in `src/adapter/runtime/normalize.ts`.
  - Adapter events and artifact versions are stored in `src/adapter/store.ts`.
  - Artifact registration and provenance endpoint live in `src/adapter/server.ts`.

Acceptance Criteria:

- Each artifact version can return provenance with Messages, Code, Execution Log, Environment, and Review tabs.
- Execution claims are backed by captured tool events, not inferred from chat text.
- Artifact registration can link source messages, execution steps, code, environment, and review context.
- Missing provenance is explicit through `missing` and `completeness`.
- Raw OpenCode IDs and schemas do not leak through provenance.

Changes:

- Added optional provenance context to artifact registration.
- Indexed adapter-normalized `tool.*` events into execution log records.
- Added provenance response `status`, `missing`, `completeness`, and five tab payloads.
- Added execution log fields for tool, kind, title, input, stdout, stderr, exit code, status, and timestamps.
- Kept execution linkage explicit through `executionStepIds`.
- Validated source message IDs and execution step IDs as known adapter IDs for the same session.
- Namespaced caller-provided environment fields under `environment.provided`.
- Made review provenance typed; `not_run` records absence and does not count as linked reviewer evidence.
- Ignored malformed tool events without stable runtime identity so they cannot become provenance evidence.
- Added integration tests for linked provenance, explicit missing provenance, raw/cross-session provenance rejection, malformed tool event handling, and environment override protection.

Verification:

- `npm.cmd run test` passed: 5 files, 32 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 5 across initial and follow-up review.
- Findings fixed: 5.
- Final narrow review: no findings.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Environment capture is partial until live kernel/package environment capture exists.
- Code provenance is inline metadata in v1; downloadable producer scripts/notebooks remain future work.
- Provenance state is still in-memory until durable storage.

### Milestone 6 Plan Flow - Loop 1

Objective Completed: yes.

Stage 1 Context:

- Milestone target: complex tasks can produce a plan, wait for approval, and execute steps after approval.
- Contract surface: `plan.propose`, `plan.approve`, `plan.requestRevision`, `plan.*` lifecycle events, `POST /v1/plans`, `GET /v1/sessions/:sessionId/plans`.
- Relevant implementation context:
  - Plan state is adapter-owned in `src/adapter/store.ts`.
  - Plan command handling is in `src/adapter/server.ts`.
  - Plan schemas are in `src/adapter/schemas.ts`.

Acceptance Criteria:

- Plans enter `awaiting_approval`.
- Steps do not start before approval.
- Approval emits ordered step lifecycle events.
- Revision creates a replacement plan version instead of direct plan text editing.
- Plan IDs and step IDs are adapter-owned.

Changes:

- Added plan records and step records.
- Added `plan.propose`, `plan.approve`, and `plan.requestRevision`.
- Added `plan.recordStepResult` for evidence-backed step completion.
- Added HTTP plan proposal and session plan snapshot endpoints.
- `plan.approve` emits `plan.approved` only and does not fake execution success.
- Added ordered `plan.stepStarted`, `plan.stepCompleted`, and `plan.completed` lifecycle events only after validated execution evidence is recorded.
- Required plan step result evidence to reference completed same-session execution logs.
- Added revision replacement semantics with `supersedesPlanId` and `revisionRequest`.
- Added integration tests for proposal, no pre-approval execution, revision, approval, evidence-backed step lifecycle, invalid state transitions, HTTP snapshots, and rejected unverified execution links.

Verification:

- `npm.cmd run test` passed: 5 files, 34 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 4 across initial and follow-up review.
- Findings fixed: 4.
- Final narrow review: no findings.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Milestone 6 v1 records plan lifecycle but does not automatically execute OpenCode prompts per step.
- Plan state is still in-memory until durable storage.

### Milestone 7 Annotation Flow - Loop 1

Objective Completed: yes.

Stage 1 Context:

- Milestone target: artifact annotations can be staged in the composer and sent with the next user message.
- Contract surface: `annotation.stage`, `annotation.discard`, `annotation.commitWithMessage`, `session.sendMessage.annotationIds`, `GET /v1/sessions/:sessionId/annotations`.
- Relevant implementation context:
  - Annotation state is adapter-owned in `src/adapter/store.ts`.
  - Annotation commands and send-message commit flow are in `src/adapter/server.ts`.
  - Anchor schemas are in `src/adapter/schemas.ts`.

Acceptance Criteria:

- Multiple annotations can be staged.
- The next user message can include `annotationIds`.
- Adapter persists annotation records and binds committed annotations to a message.
- Artifact overlay state clears after send without losing annotation history.

Changes:

- Added annotation records with `ann_*` IDs and staged/committed/discarded statuses.
- Added Markdown, code, PDF text, image point, and HTML element anchor schemas.
- Added `annotation.stage`, `annotation.discard`, and `annotation.commitWithMessage`.
- Updated `session.sendMessage` to validate annotation batches, emit staged annotation cards on `message.created`, and commit annotations only after runtime send succeeds.
- Added post-send annotation revalidation before committing to avoid in-flight artifact delete races.
- Added atomic commit/discard validation to prevent partial mutation.
- Added artifact/session ownership, effective version, and deleted artifact checks for stage/commit.
- Added annotation snapshot endpoint for staged/history state.
- Added integration tests for staging, discarding, committing with next message, failed send rollback, atomic invalid batches, cross-session ownership, effective version binding, deleted artifact rejection, in-flight delete revalidation, clearing staged overlays, and preserving history.

Verification:

- `npm.cmd run test` passed: 5 files, 38 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 6 across initial and follow-up review.
- Findings fixed: 6.
- Final narrow review: no findings.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Annotation state is still in-memory until durable storage.
- PDF/image/HTML anchor rendering needs frontend joint testing later.

### Milestone 8 Reviewer Flow - Loop 1

Objective Completed: yes.

Stage 1 Context:

- Milestone target: reviewer can run manually in v1 and produce findings cards; automatic reviewer execution is rejected until a real reviewer service is connected.
- Contract surface: `reviewer.run`, `review.started`, `review.findings`, `review.completed`, `GET /v1/sessions/:sessionId/reviews`.
- Relevant implementation context:
  - Review run state is adapter-owned in `src/adapter/store.ts`.
  - Reviewer command handling is in `src/adapter/server.ts`.
  - Artifact provenance review tab is assembled in `src/adapter/server.ts`.

Acceptance Criteria:

- Manual reviewer results can run against a session or owned artifact version.
- Findings include claim, evidence, severity, transcript links, and provenance links.
- Findings remain visible in review snapshots and artifact provenance.
- Reviewer failures are reported explicitly.

Changes:

- Added review run records and finding records.
- Added `reviewer.run` command.
- Added review snapshot endpoint.
- Added `review.started`, `review.findings`, and `review.completed` events.
- Required successful v1 reviewer runs to provide explicit linked findings.
- Validated reviewer transcript links against known same-session adapter message IDs.
- Validated reviewer provenance links against the reviewed artifact version or session review snapshot.
- Rejected `automatic` reviewer mode until real reviewer orchestration exists.
- Attached artifact review findings to artifact provenance review tabs, preserving transcript and provenance links.
- Rejected client-supplied review findings during artifact registration; strict review context parsing prevents finding-like fields from being silently stripped.
- Added explicit reviewer failure path.
- Required same-session artifact ownership for artifact-targeted review and rejected sessionless artifact targets.
- Added integration tests for successful artifact review findings, session-only review findings, repeated provenance linkage, review snapshots, explicit failure, cross-session artifact target rejection, sessionless artifact target rejection, missing finding links, unknown transcript links, mismatched provenance links, rejected registration-time findings, rejected disguised summary/not_run registration-time findings, rejected automatic mode, and empty reviewer run rejection.

Verification:

- `npm.cmd run test` passed: 5 files, 41 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 8 across initial, follow-up, and narrow final review.
- Findings fixed: 8.
- Final confirmation review: no findings.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Reviewer findings are explicit manual input in v1; automatic reviewer-agent execution remains future work.
- Review state is still in-memory until durable storage.

### Milestone 9 Delegation And Remote Jobs - Loop 1

Objective Completed: yes.

Stage 1 Context:

- Milestone target: parallel agent tracks and remote job lifecycle visibility.
- Contract surface: `track.spawn`, `track.update`, `track.stop`, `remoteJob.submit`, `remoteJob.update`, `remoteJob.appendLog`, `GET /v1/sessions/:sessionId/tracks`, `GET /v1/sessions/:sessionId/remote-jobs`.
- Relevant implementation context:
  - Track and remote job state is adapter-owned in `src/adapter/store.ts`.
  - WebSocket command handling and stop fan-out are in `src/adapter/server.ts`.
  - Payload schemas are in `src/adapter/schemas.ts`.

Acceptance Criteria:

- Multiple tracks can run with visible independent status.
- Track records can carry child transcript links and parent track links.
- Stop halts the whole session, including relevant active tracks and jobs.
- Remote job success, failure, cancellation, logs, and collected artifacts are represented clearly.

Changes:

- Added track records with running, blocked, completed, failed, and cancelled statuses.
- Added `track.spawn`, `track.update`, and `track.stop`.
- Added track snapshot endpoint.
- Added remote job records with queued, running, succeeded, failed, and cancelled statuses.
- Added `remoteJob.submit`, `remoteJob.update`, and `remoteJob.appendLog`.
- Added remote job snapshot endpoint.
- Added `remoteJob.submitted`, `remoteJob.statusChanged`, and `remoteJob.logAppended` events.
- Added strict remote job artifact collection validation for same-session adapter artifacts.
- Added `session.stop` fan-out to cancel active tracks and queued/running remote jobs even when runtime abort fails, while surfacing the runtime error explicitly.
- Rejected terminal remote job log appends and terminal track/job state mutation.
- Kept v1 as lifecycle recording only; real remote execution and automatic success remain future integrations.

Verification:

- `npm.cmd run test` passed: 5 files, 46 tests.
- `npm.cmd run check` passed.
- `npm.cmd run build` passed.

Review Agent:

- Started: yes.
- Closed: yes.
- Findings: 3.
- Findings fixed: 3.
- Follow-up review: no findings.

Docs Updated:

- `SuperMe-docs/10-adapter-contract.md`
- `SuperMe-docs/11-adapter-implementation.md`
- `SuperMe-docs/13-development-milestones.md`
- `SuperMe-docs/14-development-loop.md`

Remaining Risk:

- Track and remote job state is still in-memory until durable storage.
- Real multi-agent transcript creation and external job provider submission are future integrations.
