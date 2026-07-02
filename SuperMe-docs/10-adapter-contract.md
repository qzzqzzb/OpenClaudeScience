# Adapter Contract

## Purpose

This document defines the frontend-facing contract for the OpenClaudeScience adapter and records how the adapter should interact with the backend agent runtime.

The initial runtime target is OpenCode. The frontend must depend on this adapter contract, not on OpenCode's raw API or event schema.

## Architecture

```text
Frontend
  <-> HTTP + WebSocket
Adapter Server
  <-> OpenCode SDK or OpenCode HTTP/SSE API
OpenCode Runtime
```

The adapter has three responsibilities:

- Translate frontend product commands into runtime operations.
- Normalize runtime events into stable frontend events.
- Own product state that OpenCode does not model directly, including artifact versions, provenance, annotation state, permission scopes, review findings, kernel state, and settings.

OpenCode should be treated as a runtime dependency, not as the product API.

## Transport

Use HTTP for request/response resources:

- project and session snapshots;
- file reads and search;
- artifact metadata, previews, uploads, downloads, and provenance;
- settings, connector, skill, specialist, credential, and permission management;
- historical pagination.

Use WebSocket for realtime interaction:

- sending user messages and commands;
- streaming assistant messages;
- runtime status;
- tool/cell execution events;
- permission requests and responses;
- plan approval flow;
- artifact updates;
- annotation commits;
- review findings;
- delegation track updates;
- remote job updates.

OpenCode exposes server APIs and event streams. The adapter may use the OpenCode SDK or direct HTTP/SSE calls, but it must hide those implementation details from the frontend.

## Stable Identifiers

The frontend should only store adapter IDs:

- `projectId`
- `sessionId`
- `messageId`
- `artifactId`
- `versionId`
- `permissionId`
- `annotationId`
- `trackId`
- `jobId`

If OpenCode exposes internal IDs, the adapter maps them internally and never requires the frontend to persist them.

## HTTP Contract

### Health And Projects

```http
GET  /v1/health
GET  /v1/projects
GET  /v1/projects/current
POST /v1/projects/select
```

### Sessions

```http
GET    /v1/sessions?projectId=...&group=active|today|all
POST   /v1/sessions
GET    /v1/sessions/:sessionId
PATCH  /v1/sessions/:sessionId
DELETE /v1/sessions/:sessionId
GET    /v1/sessions/:sessionId/messages
GET    /v1/sessions/:sessionId/tracks
GET    /v1/sessions/:sessionId/remote-jobs
POST   /v1/sessions/:sessionId/stop
```

### Files And Uploads

```http
GET  /v1/files/tree?projectId=...&path=...
GET  /v1/files/content?projectId=...&path=...
GET  /v1/files/search?projectId=...&q=...
POST /v1/uploads
```

### Artifacts

```http
GET    /v1/artifacts?projectId=...&sessionId=...
POST   /v1/artifacts/register
GET    /v1/artifacts/:artifactId
PATCH  /v1/artifacts/:artifactId
DELETE /v1/artifacts/:artifactId
GET    /v1/artifacts/:artifactId/versions
GET    /v1/artifacts/:artifactId/versions/:versionId/provenance
GET    /v1/artifacts/:artifactId/versions/:versionId/download
```

### Settings And Runtime Catalogs

```http
GET   /v1/permissions
POST  /v1/permissions/revoke
GET   /v1/settings
PATCH /v1/settings
GET   /v1/connectors
GET   /v1/skills
GET   /v1/specialists
```

## WebSocket Contract

Endpoint:

```text
WS /v1/ws?projectId=<projectId>&lastEventId=<optionalEventId>
```

The frontend sends command envelopes:

```json
{
  "type": "command",
  "requestId": "req_123",
  "command": "session.sendMessage",
  "payload": {}
}
```

The adapter returns acknowledgement envelopes:

```json
{
  "type": "ack",
  "requestId": "req_123"
}
```

The adapter pushes event envelopes:

```json
{
  "type": "event",
  "eventId": "evt_456",
  "seq": 42,
  "sessionId": "ses_1",
  "name": "message.delta",
  "payload": {}
}
```

The adapter returns error envelopes:

```json
{
  "type": "error",
  "requestId": "req_123",
  "code": "PERMISSION_DENIED",
  "message": "Shell command was denied"
}
```

On reconnect, the frontend should pass the last processed `eventId`. The adapter should either replay missed events or require the frontend to refresh HTTP snapshots.

If the frontend passes a `lastEventId` that is no longer available, the adapter sends:

```json
{
  "type": "error",
  "code": "EVENT_REPLAY_UNAVAILABLE",
  "message": "Event replay cursor is not available; refresh HTTP snapshots before continuing"
}
```

After this error, the frontend should refresh HTTP snapshots for the open project/session/artifacts before trusting realtime state again.

## WebSocket Commands

Supported command names:

```text
project.select
session.create
session.open
session.sendMessage
session.stop
permission.respond
plan.propose
plan.approve
plan.requestRevision
plan.recordStepResult
artifact.open
artifact.star
artifact.rename
artifact.delete
artifact.downloadUrl
annotation.stage
annotation.discard
annotation.commitWithMessage
reviewer.run
track.spawn
track.update
track.stop
remoteJob.submit
remoteJob.update
remoteJob.appendLog
settings.update
```

Commands that are not implemented for the current milestone return `COMMAND_NOT_IMPLEMENTED` after the ACK. `session.open` validates the session and emits `session.updated`.

Example message send command:

```json
{
  "type": "command",
  "requestId": "req_send_1",
  "command": "session.sendMessage",
  "payload": {
    "sessionId": "ses_1",
    "parts": [
      { "type": "text", "text": "Analyze this notebook" },
      { "type": "artifact_ref", "artifactId": "art_1", "versionId": "ver_2" },
      { "type": "session_ref", "sessionId": "ses_old" },
      { "type": "upload_ref", "uploadId": "upl_1" },
      { "type": "skill_ref", "skillId": "skill_rjob_ops" }
    ],
    "annotationIds": ["ann_1", "ann_2"]
  }
}
```

## Plan Contract

`plan.propose` creates an adapter-owned plan and emits `plan.proposed`. The plan enters `awaiting_approval`; steps remain `pending` and must not execute before `plan.approve`.

Plan proposal payload:

```json
{
  "sessionId": "ses_1",
  "title": "Analyze data",
  "summary": "Two step plan",
  "steps": [
    { "title": "Inspect inputs", "description": "Read project files" },
    { "title": "Write summary", "description": "Create output" }
  ]
}
```

Plan record:

```json
{
  "id": "plan_1",
  "sessionId": "ses_1",
  "version": 1,
  "title": "Analyze data",
  "status": "awaiting_approval",
  "steps": [
    {
      "id": "pstep_1",
      "planId": "plan_1",
      "index": 0,
      "title": "Inspect inputs",
      "status": "pending",
      "executionStepIds": []
    }
  ]
}
```

`plan.requestRevision` is conversational, not direct text editing. It marks the current plan `revision_requested` and emits `plan.updated` with a replacement plan version that records `supersedesPlanId` and `revisionRequest`.

`plan.approve` can only approve a plan in `awaiting_approval`. Approval emits `plan.approved`; it does not imply execution success and does not emit step completion by itself.

`plan.recordStepResult` records a completed step only after completed execution evidence exists. Its `executionStepIds` must be known adapter-owned tool step IDs for the same session, and each referenced execution log must have `status: "completed"`. Recording a step emits `plan.stepStarted` and `plan.stepCompleted`; when every step has completed evidence, the adapter emits `plan.completed`.

```json
{
  "planId": "plan_1",
  "stepId": "pstep_1",
  "executionStepIds": ["tool_1"]
}
```

Milestone 6 v1 records lifecycle and preserves explicit execution links; it does not yet ask OpenCode to run each step automatically.

HTTP snapshots:

```text
POST /v1/plans
GET  /v1/sessions/:sessionId/plans
```

## Frontend Events

The adapter should normalize runtime and product state changes into these event names:

```text
session.created
session.updated
session.statusChanged
message.created
message.delta
message.completed
message.failed
tool.started
tool.output
tool.completed
tool.failed
permission.requested
permission.resolved
plan.proposed
plan.updated
plan.approved
plan.stepStarted
plan.stepCompleted
plan.completed
artifact.created
artifact.versionCreated
artifact.updated
artifact.deleted
annotation.staged
annotation.committed
review.started
review.findings
review.completed
track.created
track.statusChanged
track.message
track.completed
runtime.statusChanged
remoteJob.submitted
remoteJob.statusChanged
remoteJob.logAppended
```

### Message Snapshot

`GET /v1/sessions/:sessionId/messages` returns adapter-normalized messages. It must not return raw OpenCode message objects, OpenCode session IDs, or OpenCode message IDs.

Example:

```json
{
  "messages": [
    {
      "id": "msg_2989e48904fed152",
      "sessionId": "ses_1",
      "role": "assistant",
      "status": "completed",
      "parts": [
        {
          "id": "part_075cc3a5dd0537ab",
          "type": "text",
          "text": "OK"
        }
      ],
      "createdAt": "2026-07-01T09:17:00.000Z",
      "completedAt": "2026-07-01T09:17:01.000Z"
    }
  ]
}
```

For Milestone 1, text parts are normalized for display. Non-text runtime parts may appear as `unsupported` until Milestone 2 expands OpenCode event and part normalization.

Message errors use stable adapter error objects:

```json
{
  "code": "PROVIDER_AUTH_ERROR",
  "message": "Model provider authentication failed"
}
```

Runtime provider IDs, raw OpenCode error names, raw provider response bodies, and OpenCode internal message/session IDs must not appear in public message snapshots or WebSocket events.

`message.completed` is emitted only after the runtime message call completes. `message.failed` is emitted before the WebSocket error envelope when adapter validation or runtime execution fails.

Runtime event stream normalization currently covers:

- `message.part.updated` text parts -> `message.delta`.
- `message.part.updated` tool parts -> `tool.started`, `tool.output`, `tool.completed`, or `tool.failed`.
- `permission.updated` -> `permission.requested` with an adapter-owned permission record.
- `session.status` and `session.idle` -> `session.statusChanged`.
- event stream disconnects/errors -> `runtime.statusChanged`.

Runtime `message.updated` completion events are intentionally not converted into `message.completed` in Milestone 2 to avoid duplicate or empty completion events while `session.sendMessage` still uses blocking prompt completion. A later streaming-first milestone may move completion ownership fully to the event stream with explicit de-duplication.

## Permission Contract

Permission requests are product-level objects, even when they originate from OpenCode permission prompts.

```json
{
  "id": "perm_1",
  "sessionId": "ses_1",
  "type": "shell",
  "title": "Run shell command",
  "summary": "npm install @opencode-ai/sdk",
  "details": {
    "command": "npm install @opencode-ai/sdk",
    "cwd": "/project"
  },
  "scopes": ["once", "conversation", "project", "global"],
  "recommendedScope": "once",
  "risk": "medium",
  "createdAt": "2026-07-01T00:00:00Z"
}
```

Permission response:

```json
{
  "type": "command",
  "requestId": "req_perm_1",
  "command": "permission.respond",
  "payload": {
    "permissionId": "perm_1",
    "decision": "approve",
    "scope": "conversation"
  }
}
```

Reject response:

```json
{
  "permissionId": "perm_1",
  "decision": "deny",
  "reason": "User denied"
}
```

Supported permission types:

```text
folder_access
python
shell
install_package
network_host
connector
remote_job
external_directory
credential
```

Scope semantics:

- `once`: approve this specific request only.
- `conversation`: approve matching requests in the current adapter session.
- `project`: approve matching requests for this project until revoked.
- `global`: approve matching requests across projects until revoked.

OpenCode currently has lower-level permission actions such as allow, ask, deny, once, always, and reject. The adapter must map adapter scopes to OpenCode-compatible runtime decisions and persist project/global scopes itself.

Milestone 3 behavior:

- Runtime permission IDs are internal. The frontend receives only adapter-owned `perm_*` IDs.
- `permission.respond` with `decision=approve` maps `scope=once` to OpenCode `once`; `conversation`, `project`, and `global` map to OpenCode `always` for the active runtime request while the adapter stores the narrower product scope.
- `permission.respond` with `decision=deny` maps to OpenCode `reject`.
- Approved `conversation`, `project`, and `global` scopes create adapter permission grants. Matching future runtime requests are resolved automatically and recorded as adapter permission records.
- Revoking a permission revokes grants created by that permission. If the permission was auto-approved by an existing grant, revoking that auto-approved permission also revokes the applied underlying grant. Future matching requests return to `pending`.
- `GET /v1/permissions` returns both permission records and grant records for Settings > Permissions.

## Artifact Contract

Artifact metadata:

```json
{
  "id": "art_1",
  "projectId": "proj_1",
  "sessionId": "ses_1",
  "kind": "notebook",
  "name": "analysis.ipynb",
  "currentVersionId": "ver_3",
  "mimeType": "application/x-ipynb+json",
  "starred": false,
  "createdAt": "2026-07-01T00:00:00Z",
  "updatedAt": "2026-07-01T00:00:00Z"
}
```

Supported artifact kinds:

```text
figure
pdf
markdown
notebook
table
code
environment
review
html
unknown
```

Same-name saves create new versions unless the user explicitly renames or replaces an artifact.

Artifact registration:

```json
{
  "sessionId": "ses_1",
  "path": "outputs/result.md",
  "kind": "markdown",
  "sourceMessageIds": ["msg_1"]
}
```

The adapter resolves paths under the project root, records file metadata on the artifact version, and returns adapter-owned `art_*` and `ver_*` IDs. Paths outside the project root are rejected. Frontend download should use `/v1/artifacts/:artifactId/versions/:versionId/download` rather than reading local file paths.

Artifact versions returned to the frontend are public metadata only:

```json
{
  "id": "ver_3",
  "artifactId": "art_1",
  "version": 3,
  "createdAt": "2026-07-01T00:00:00Z",
  "sourceMessageIds": ["msg_1"],
  "size": 2048,
  "sha256": "...",
  "mimeType": "text/markdown"
}
```

The adapter snapshots registered file content into adapter-owned storage. Public artifact/version payloads do not expose project file paths or adapter blob paths. Downloading an older version returns the snapshotted content for that version, even if the original project file later changes.

Adapter blob storage lives under `ADAPTER_STORAGE_ROOT/artifacts` and defaults outside the project root. It is adapter-owned state, not project file content. Frontend and runtime file browsing should continue to use project file APIs for source files and artifact download URLs for version bytes.

Artifact WebSocket helpers:

- `artifact.open` payload: `{ "artifactId": "art_1", "versionId": "ver_1", "mode": "primary" }`
  Emits `artifact.opened` with `{ artifact, version, mode }`.
- `artifact.downloadUrl` payload: `{ "artifactId": "art_1", "versionId": "ver_1" }`
  Emits `artifact.downloadUrlCreated` with `{ artifactId, versionId, downloadUrl }`. If `versionId` is omitted, the current version is used.

Artifact menu operations:

- Open.
- Open beside session.
- View in context.
- Provenance.
- Versions.
- Copy link.
- Star.
- Rename.
- Download.
- Delete.

## Provenance Contract

Each artifact version has five provenance tabs:

- `messages`
- `code`
- `executionLog`
- `environment`
- `review`

Example:

```json
{
  "artifactId": "art_1",
  "versionId": "ver_3",
  "status": "partial",
  "missing": ["review"],
  "completeness": {
    "messages": { "status": "linked" },
    "code": { "status": "linked" },
    "executionLog": { "status": "linked" },
    "environment": {
      "status": "partial",
      "reason": "Adapter/runtime/artifact summary is present; full kernel or package environment capture is not implemented yet"
    },
    "review": {
      "status": "missing",
      "reason": "No reviewer output is linked to this artifact version"
    }
  },
  "tabs": {
    "messages": [
      { "messageId": "msg_1" }
    ],
    "code": [
      {
        "id": "code_1",
        "language": "python",
        "content": "print('hello')",
        "description": "Script that produced the artifact"
      }
    ],
    "executionLog": [
      {
        "stepId": "tool_1",
        "sessionId": "ses_1",
        "kind": "python",
        "tool": "python",
        "title": "Run Python",
        "input": {},
        "stdout": "...",
        "stderr": "",
        "exitCode": 0,
        "status": "completed",
        "startedAt": "2026-07-01T00:00:00Z",
        "completedAt": "2026-07-01T00:00:01Z"
      }
    ],
    "environment": {
      "adapter": { "version": "0.1.0", "storage": "adapter-owned" },
      "runtime": { "kind": "opencode", "sdkVersion": "1.17.12" },
      "artifact": { "kind": "markdown", "mimeType": "text/markdown", "size": 2048, "sha256": "..." },
      "provided": { "python": "3.12" }
    },
    "review": [
      {
        "type": "finding",
        "findingId": "rev_1",
        "severity": "warning"
      }
    ]
  }
}
```

The execution log is the authoritative record for claims about what ran. The adapter only returns execution rows that were captured from adapter-normalized tool events and explicitly linked to the artifact version at registration time. Linked `sourceMessageIds` and `executionStepIds` must already be known adapter IDs for the same session; raw OpenCode IDs or cross-session IDs are rejected.

Missing provenance is explicit. A tab with no captured evidence is marked `missing` in `completeness` and listed in `missing`; it must not be displayed as complete evidence. `environment` is `partial` in v1 because kernel/package-level capture is not implemented yet.

The `environment.adapter`, `environment.runtime`, and `environment.artifact` fields are adapter-owned and cannot be overwritten by registration input. Caller-provided environment fields appear under `environment.provided`.

Review provenance is typed. `finding` and `summary` entries count as linked review evidence. `not_run` records why review is absent and keeps the review tab marked missing. Artifact registration can attach initial `not_run` or `summary` review context, but it cannot create `finding` records; findings must be created by `reviewer.run` so the adapter can bind them to a known session, transcript message, and reviewed target.

Artifact registration can attach initial provenance context:

```json
{
  "path": "outputs/result.md",
  "sourceMessageIds": ["msg_1"],
  "provenance": {
    "executionStepIds": ["tool_1"],
    "code": [{ "language": "python", "content": "print('hello')" }],
    "environment": { "python": "3.12" },
    "review": [{ "type": "not_run", "reason": "Reviewer not requested" }]
  }
}
```

## Annotation Contract

Annotations are adapter-owned records. They start as `staged` overlay state, can be discarded, and become `committed` message history when sent.

Supported anchors:

```text
markdown
code
pdf_text
image_point
html_element
```

`annotation.stage` payload:

```json
{
  "sessionId": "ses_1",
  "artifactId": "art_1",
  "versionId": "ver_1",
  "body": "Please check this paragraph",
  "anchor": {
    "type": "markdown",
    "path": "report.md",
    "startLine": 10,
    "endLine": 12,
    "text": "selected text"
  }
}
```

`annotation.stage` emits `annotation.staged` with the created `ann_*` record and current staged list. `annotation.discard` accepts `{ "annotationIds": ["ann_1"] }` and emits `annotation.discarded`.

The next message can commit annotations by sending `annotationIds` with `session.sendMessage`. The adapter first validates all annotation IDs, ownership, status, and artifact/version liveness. `message.created` includes annotation cards while they are still staged. After the runtime send succeeds, the adapter revalidates artifact/version liveness before marking them `committed` and emitting `annotation.committed` with `clearedAnnotationIds`, so the frontend can remove transient artifact overlays without losing history. If runtime send or post-send validation fails, annotations remain staged and overlays should not be cleared.

Annotation batch operations are atomic: mixed valid/invalid IDs, duplicate IDs, discarded annotations, cross-session annotations, or annotations pointing to deleted artifacts are rejected without partial mutation.

`annotation.commitWithMessage` is a convenience command with `{ sessionId, annotationIds, parts }`; it follows the same message/commit flow as `session.sendMessage`.

HTTP snapshot:

```text
GET /v1/sessions/:sessionId/annotations
```

The response contains all annotation history plus a `staged` list for the composer chip.

## Reviewer Contract

`reviewer.run` starts a review against either a session or a specific artifact version. Milestone 8 v1 records adapter-owned manual review runs and accepts explicit linked findings or an explicit failure reason. Automatic reviewer-agent generation is not implemented yet and is rejected instead of returning a synthetic successful review.

Payload:

```json
{
  "sessionId": "ses_1",
  "artifactId": "art_1",
  "versionId": "ver_1",
  "mode": "manual",
  "findings": [
    {
      "severity": "warning",
      "claim": "The summary says X",
      "evidence": "Execution log does not contain X",
      "transcriptUrl": "#msg_1",
      "provenanceUrl": "/v1/artifacts/art_1/versions/ver_1/provenance"
    }
  ]
}
```

Events:

- `review.started` with the `rev_*` record.
- `review.findings` with `finding_*` records.
- `review.completed` with `status: "completed"` or `status: "failed"`.

Successful v1 reviewer runs must include at least one finding. Each finding must include `claim`, `evidence`, `severity`, `transcriptUrl`, and `provenanceUrl`; these links are preserved in session review snapshots and artifact provenance review tabs.

Link validation in v1:

- `transcriptUrl` must be `#msg_*`, and the message ID after `#` must be known adapter message history for the same session.
- For artifact-targeted review, `provenanceUrl` must exactly match `/v1/artifacts/:artifactId/versions/:versionId/provenance` for the reviewed artifact version.
- For session-only review, `provenanceUrl` must exactly match `/v1/sessions/:sessionId/reviews`.

Reviewer failure is explicit:

```json
{
  "sessionId": "ses_1",
  "failReason": "Reviewer service unavailable"
}
```

Artifact-targeted review validates that the artifact version exists and is owned by the same session. Sessionless artifacts are not accepted as artifact-targeted review inputs in v1. Completed artifact review findings are attached to that artifact version's provenance `review` tab.

HTTP snapshot:

```text
GET /v1/sessions/:sessionId/reviews
```

## Delegation And Remote Job Contract

Tracks are adapter-owned status records for parallel agent work. They do not imply a separate OpenCode session unless a later runtime integration explicitly creates one.

`track.spawn` creates a running track:

```json
{
  "sessionId": "ses_1",
  "title": "Analyze dataset",
  "parentTrackId": "track_parent",
  "agentKind": "specialist",
  "transcriptUrl": "/v1/sessions/ses_1/tracks/analysis"
}
```

Events:

- `track.created`
- `track.statusChanged`

`track.update` records explicit progress, blocking, completion, or failure. It may emit `track.message` when `message` is present and `track.completed` when the new status is `completed` or `failed`. `track.stop` marks a track `cancelled` and emits `track.statusChanged` plus `track.completed` with `status: "cancelled"`.

Remote jobs are adapter-owned lifecycle records for external compute. Milestone 9 v1 does not start real remote compute by itself and must not mark a job successful without an explicit `remoteJob.update`.

`remoteJob.submit` records a queued job:

```json
{
  "sessionId": "ses_1",
  "trackId": "track_1",
  "provider": "external-hpc",
  "title": "Run simulation",
  "command": "python simulate.py"
}
```

Events:

- `remoteJob.submitted`
- `remoteJob.statusChanged`
- `remoteJob.logAppended`

`remoteJob.update` moves a job through `queued`, `running`, `succeeded`, `failed`, or `cancelled`. Collected `artifactIds` must be adapter artifacts owned by the same session. `remoteJob.appendLog` appends `stdout`, `stderr`, or `system` log entries.

Snapshots:

```text
GET /v1/sessions/:sessionId/tracks
GET /v1/sessions/:sessionId/remote-jobs
```

`session.stop` fans out to active tracks and remote jobs. It cancels `running`/`blocked` tracks and `queued`/`running` remote jobs before emitting the final `session.statusChanged`.

## Capability Ownership

### Adapter Connects To OpenCode

These features should primarily be backed by OpenCode APIs or events:

| Frontend capability | Adapter interaction |
| --- | --- |
| New session | Create an OpenCode session and map its ID. |
| Active / Today sessions | Read OpenCode sessions and combine them with adapter metadata. |
| Chat message send | Convert frontend message parts into an OpenCode prompt/message. |
| Agent running status | Subscribe to OpenCode events and session status. |
| Stop | Cancel or dispose runtime work, then stop adapter-managed tracks. |
| Files | Use OpenCode file tree, content, search, and status APIs. |
| `@` file references | Use OpenCode file search for file references. |
| `#` session references | Read OpenCode sessions, with adapter indexing. |
| `/` commands or skills | Use OpenCode commands, agents, or skills when available. |
| Tool step display | Normalize OpenCode tool events and message parts. |
| Shell execution | Use OpenCode shell/tool execution when appropriate. |
| Network/web tools | Use OpenCode tool and permission paths when configured. |
| Connectors/MCP | Use OpenCode MCP status, registration, and tool events where possible. |
| Specialists base list | Use OpenCode agent list/config as the runtime source. |
| Provider/model/auth subset | Use OpenCode provider, auth, and config APIs. |

### Adapter Owns Product State Around OpenCode

These features use OpenCode outputs but need adapter-owned state machines:

| Frontend capability | Adapter responsibility |
| --- | --- |
| Permission cards | Convert runtime prompts into cards; store scopes; support revoke and audit. |
| Plan flow | Maintain draft, awaiting approval, running, completed, and blocked states. |
| Execution flow | Normalize runtime tool calls into expandable cells and execution logs. |
| Artifact flow | Detect generated files, version artifacts, and expose artifact operations. |
| Provenance panel | Bind messages, code, execution logs, environment snapshots, and reviews. |
| Reviewer flow | Run reviewer agents or services and emit findings with evidence links. |
| Delegation flow | Maintain track graph, child transcripts, status markers, and cancellation fan-out. |
| Settings permissions | Persist product scopes and compile them to runtime rules as needed. |
| Settings connectors | Map OpenCode MCP/provider config plus adapter-native connector config. |
| Settings skills | Combine runtime skills/commands with product enablement metadata. |
| Network allowlist | Store policy, audit changes, and map to runtime permissions when possible. |
| Specialists | Map runtime agents to frontend specialist cards and default policies. |

### Adapter Implements Independently Of OpenCode

These features should not depend on OpenCode internals:

| Frontend capability | Adapter responsibility |
| --- | --- |
| App shell state | Project selection, sidebars, right-panel open item, and UI preferences. |
| Artifact preview service | Render previews, thumbnails, downloads, and content-type-specific viewers. |
| Artifact version store | Metadata, version chain, soft delete, star, rename, and links. |
| Annotation flow | Store selections, image points, HTML element anchors, composer chips, and sent records. |
| Notebook live panel | Own Jupyter/R kernel lifecycle, console, outputs, and variable continuity. |
| Environment snapshots | Record packages, interpreter/runtime versions, working directory, git info, and resources. |
| Remote job lifecycle | Submit jobs, poll status, stream logs, collect outputs, and map to artifacts. |
| Storage | Manage blobs, caches, retention, cleanup, and storage backends. |
| Memory | Store project/user memory and retrieval indexes. |
| Credentials vault | Store non-OpenCode connector, compute, and storage credentials. |
| General settings | Theme, notifications, default views, and right-panel behavior. |
| Audit log | Record permission, artifact, settings, job, annotation, and review events. |

## OpenCode Interaction Logic

The adapter should follow this runtime flow:

1. Start or connect to an OpenCode server for the selected project.
2. Check runtime health before routing commands.
3. Create or open an OpenCode session when the frontend creates or opens an adapter session.
4. Subscribe to OpenCode's event stream.
5. Convert OpenCode messages, parts, session status, tool calls, and permission prompts into adapter events.
6. Persist adapter-owned session metadata, event offsets, permissions, artifacts, and provenance.
7. Route frontend `session.sendMessage` commands to OpenCode prompt/message APIs.
8. Route frontend `session.stop` to runtime cancellation/disposal and stop adapter-owned tracks, kernels, and jobs where applicable.
9. Detect file outputs and explicit save operations, then register or version artifacts.
10. Attach messages, code, execution logs, environment snapshots, and reviews to artifact versions.

The adapter must not silently fall back to another runtime, model, provider, permission policy, or execution backend. Any fallback must be explicit, visible, and recorded.

## Frontend Usage Flow

1. App startup:
   - Call `GET /v1/projects/current`.
   - Call `GET /v1/sessions`.
   - Call `GET /v1/settings`.
   - Open `WS /v1/ws`.
2. Session open:
   - Call `GET /v1/sessions/:sessionId/messages`.
   - Call `GET /v1/artifacts?sessionId=...`.
   - Render future updates from WebSocket events.
3. User message:
   - Send `session.sendMessage` over WebSocket.
   - Update UI from `message.*`, `tool.*`, `permission.*`, `artifact.*`, and `runtime.*` events.
4. Permission card:
   - Render `permission.requested`.
   - Send `permission.respond` with decision and scope.
   - Update Settings > Permissions from HTTP snapshots.
5. Artifact open:
   - Use HTTP for metadata, preview, versions, provenance, and downloads.
   - Do not infer artifact file paths from chat text.
6. Annotation:
   - Stage selections or coordinates through `annotation.stage`.
   - Include `annotationIds` in the next `session.sendMessage`.
   - After send, render annotations as message cards and remove transient overlay state from the artifact.

## Open Questions

- Exact persistence backend for adapter metadata and artifact blobs.
- Whether notebook kernels run in the adapter process, a separate service, or remote compute.
- How reviewer claims are extracted from final assistant messages.
- Exact mapping between adapter permission scopes and OpenCode runtime permission updates.
- Whether delegation tracks map to OpenCode child sessions, subagents, or adapter-native workers.

## Timeline

- 2026-07-01 14:55 Asia/Shanghai: Created initial adapter contract and OpenCode interaction design from frontend requirements.
  Reason: The frontend team needs a stable adapter-facing API before implementing the three-column agent workspace.
  Impact: Frontend should build against this document instead of OpenCode raw APIs.
