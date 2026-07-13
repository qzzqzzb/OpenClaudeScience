# Domain Adapter Contracts Phase 1 Follow-up

This document is the concrete contract checklist for the current `ui/src/server/domains/*` adapters. It complements `adapter-contracts.md` by naming the TypeScript interfaces now exported by each domain.

## Stable Contract Rules

- Services call adapter objects with structured input objects; route-facing wrappers may keep positional compatibility without owning infrastructure logic.
- Adapter outputs are domain DTOs, never raw SDK, SSH stdout, process handles, or local filesystem internals.
- Remote/process adapters normalize timeout, cancellation, progress, and error behavior before invoking domain-owned infrastructure modules.
- Adapter errors should use domain-safe messages and must not include API keys, `.env` contents, SSH private key paths, tokens, or passwords.
- Concrete adapters and services must not import `ui/src/app/api/**/_lib`; bottom implementations live under their owning server domain or shared adapter package.

## Workspace Adapter

Implemented contract: `WorkspaceDirectoryAdapter` and `WorkspaceFileAdapter` in `ui/src/server/domains/workspace/workspace.types.ts`.

Responsibilities:

- `WorkspaceDirectoryAdapter.listEntries(input)` returns `{ path, entries }` for local or remote workspace directories.
- `WorkspaceDirectoryAdapter.searchFiles(input)` returns normalized `WorkspaceEntry[]` search results.
- `WorkspaceFileAdapter.readFile(input)` returns preview metadata/content for a file.
- `WorkspaceFileAdapter.readRawFile(input)` returns a bounded in-memory raw file buffer.
- `WorkspaceFileAdapter.streamLocalRawFile(input)` returns a local raw stream with optional byte range.
- `WorkspaceFileAdapter.writeRawFile(input)` writes only under the selected workspace boundary.

Side effects:

- Read/list/search methods do not write files.
- `writeRawFile` may write workspace files only.
- Local desktop open operations remain in `localDesktop.adapter.ts`, not in the file adapter.

Current concrete adapters:

- `workspaceDirectoryAdapter` in `workspaceDirectory.adapter.ts`.
- `workspaceFileAdapter` in `workspaceFile.adapter.ts`.
- `workspaceRootAdapter` in `ui/src/server/shared/adapters/workspaceRoot.adapter.ts` owns cross-domain application-root resolution.
- Filesystem, office preview, and desktop-open implementations now live under `ui/src/server/domains/workspace/adapters`.

Migration status:

- Workspace services and adapters no longer import API route `_lib` modules.
- `workspaceFs.adapter.ts` owns local/remote workspace filesystem protocol; `officePreview.adapter.ts` and `openFolder.adapter.ts` own their platform integrations.

## Runtime Adapter

Implemented contract: `RuntimeAdapter` in `ui/src/server/domains/runtime/runtime.types.ts`.

Responsibilities:

- `isReady(input)` performs a local backend readiness probe.
- `getStatus(input)` returns backend busy/interrupted status.
- `restart(input)` restarts the managed backend process and applies restart de-duplication.
- `getDesktopConfig()` returns the browser bootstrap runtime configuration.

Side effects:

- `isReady` and `getStatus` must not restart processes.
- `restart` may stop/start backend processes and write pid/log/runtime metadata through the concrete backend implementation.

Current concrete adapter:

- `runtimeAdapter` in `runtime.service.ts` fronts health, status, restart, and desktop config adapters.

Migration status:

- `backendStatus.adapter.ts` and `backendRestart.adapter.ts` call the domain-owned `backendProcess.adapter.ts` implementation.
- The former `runtime/_lib/backend` implementation has been removed.

## Remote Adapter

Implemented contract: `RemoteAdapter` in `ui/src/server/domains/remote/remote.types.ts`.

Responsibilities:

- `listSshHosts()` lists configured SSH aliases.
- `testConnection(input)` probes SSH reachability.
- `ensureBackend(input, onLog)` synchronizes backend runtime for an existing remote resource.
- `setupBackend(input, onLog)` provisions a remote runtime resource.
- `pushBackendCli(input, onLog)` pushes the backend CLI bundle.

Side effects:

- May open SSH connections, write remote files, start remote backend processes, and update resource configuration through the concrete adapter.
- Must stream progress as domain `RemoteStreamEvent` records, not raw stdout chunks.

Current concrete adapter:

- `remoteAdapter` in `remote.service.ts` centralizes remote capability calls for the route-facing stream helpers.

Migration status:

- SSH probing uses the shared `sshCliAdapter` contract.
- Runtime provisioning and backend CLI synchronization are domain-owned by `remoteInfrastructure.adapter.ts`, reached only through `remoteRuntime.adapter.ts` and `remoteBackendCli.adapter.ts`.
- The former `remote-connections/_lib/remote-connections` implementation has been removed.

## Compute Adapter

Implemented contract: `ComputeAdapter` in `ui/src/server/domains/compute/compute.types.ts`.

Responsibilities:

- `listHosts()` returns registered SSH compute hosts.
- `upsertHost(input)` validates/probes and persists a host.
- `listJobs()` returns stored remote job records.
- `submitJob(input)` creates and starts a remote job.
- `getJob({ jobId })` refreshes and returns a job snapshot.

Side effects:

- Host mutation writes `.internagents/compute/ssh-hosts.json`.
- Job submission writes local job state and may create remote scratch directories/processes.
- Job snapshot may SSH to the host to harvest stdout, stderr, exit status, and bounded output files.

Current concrete adapter:

- `computeAdapter` in `compute.service.ts` fronts host/store/job protocol adapters.
- `workspaceRootAdapter` is used for compute state paths.
- Obsolete `compute/_lib/compute-auth.ts` and `compute/_lib/ssh-remote-jobs.ts` duplicates have been removed; compute behavior is owned by `computeAuth`, `computeHost`, `computeStore`, `computeJob`, and `computeRemoteJobProtocol` adapters.

## Remaining Domain Migrations

- Skills import/config/frontmatter implementations now live under `ui/src/server/domains/skills/adapters`.
- Update check/install/rollback/state implementations now live under `ui/src/server/domains/update/adapters`.
- Local folder selection is a shared platform adapter at `ui/src/server/shared/adapters/localFolderPicker.adapter.ts`.
- Config, resources, and workspaces adapters consume server-domain modules rather than API route internals.
- `domain-adapter-contracts.test.mts` scans production TypeScript and fails if an API route `_lib` implementation or import is reintroduced.

## Chat Runtime Facade

Implemented client-side facade: `ChatRuntimeFacade` in `ui/src/lib/chat-runtime-facade.ts`.

Responsibilities:

- Owns main-thread reads, runtime-thread reads, pending-run preview lookup, runtime run listing, runtime stream join, thread metadata updates, and state updates for `useChat.ts`.
- Keeps `useChat.ts` focused on UI state orchestration while the facade owns LangGraph main/runtime client routing.

Current migration scope:

- `loadThreadSnapshot`, runtime run snapshot polling, runtime live stream joining, file state updates, thread skills updates, and thread title persistence now go through the facade.
- The actual stream submission hook remains unchanged because it still depends on `useAgentRuntimeStream` lifecycle behavior.

## OpenCode Protocol Assessment

Sources checked July 10, 2026:

- OpenCode CLI documents `opencode run` non-interactive mode, `--session`, `--continue`, `--fork`, `--file`, `--format json`, and `--attach` to a running `opencode serve` server. It also documents `opencode serve` as an HTTP API surface and `opencode acp` as an Agent Client Protocol server over stdin/stdout nd-json. See [OpenCode CLI docs](https://opencode.ai/docs/cli/).
- OpenCode config documents per-project `opencode.json`, merged config precedence, server config, MCP servers, plugins, instructions, agents, permissions, and watcher settings. See [OpenCode config docs](https://opencode.ai/docs/config/).
- OpenCode plugins expose custom tools with Zod schemas and execution context containing `directory` and `worktree`. See [OpenCode plugins docs](https://opencode.ai/docs/plugins/).
- Promptfoo's OpenCode SDK integration documents session reuse/resumption and native skill/tool metadata normalization for evaluation use cases. See [Promptfoo OpenCode SDK docs](https://www.promptfoo.dev/docs/providers/opencode-sdk/).

Recommendation:

- Treat OpenCode as a candidate `RuntimeAdapter` only through `opencode serve` or `opencode acp`, not through plain TUI output.
- Treat OpenCode plugins/custom tools as a `ToolAdapter` surface when the goal is to expose InternAgentS tools inside OpenCode.
- Do not replace the main LangGraph/DeepAgents runtime yet. First prototype an `OpenCodeRuntimeProvider` behind `AgentRuntimeProtocolProvider` using `opencode run --format json` or ACP nd-json, then verify mapping for `run_started`, `message_delta`, `tool_call`, `tool_result`, `interrupt`, `error`, `done`, cancellation, workspace binding, session resumption, and permissions.
- If the prototype cannot provide stable structured lifecycle and tool events, keep OpenCode as a `ToolAdapter` or sidecar automation tool rather than the primary `RuntimeAdapter`.
