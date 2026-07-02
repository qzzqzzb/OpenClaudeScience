# Loop 05 - Artifact Registration, Preview, Version, Provenance

## Test Task

Verify adapter-owned artifact registration and frontend artifact preview/provenance linkage.

## Acceptance Criteria

- `POST /v1/artifacts/register` creates adapter-owned artifact/version IDs.
- Public version metadata does not expose local project paths.
- Frontend can open the artifact and show Preview/Provenance controls.
- Provenance endpoint returns five tabs: Messages, Code, Execution Log, Environment, Review.

## Operations

1. Registered `README.md` as a markdown artifact owned by session `ses_Rmst77P99Hgz`.
2. Linked `sourceMessageIds` to `msg_user_mr265yi6_5hzned`.
3. Queried artifact versions and provenance.
4. Reopened session list to make the artifact active in the right inspector.

## Screenshots

![Loop 05 initial artifact registration while settings active](assets/loop-05-artifact-preview.png)

![Loop 05 artifact preview after session reopen](assets/loop-05-artifact-preview-after-session-reopen.png)

## Observed Result

- Artifact `art_GNM6FfLmnpF9` and version `ver_9pfQ0dlTsxEQ` were created.
- Version metadata exposed `size`, `sha256`, `mimeType`, and `sourceMessageIds`, but no local path/blob path.
- Provenance returned `messages`, `code`, `executionLog`, `environment`, and `review`.
- Frontend showed `README.md`, `Preview`, `Provenance`, version `v1`, and `text/markdown`.

## Caveat

When the right pane was in Settings mode, `artifact.created` did not automatically activate/open the artifact. Reopening the session list caused `openSession` to fetch and open the first artifact.

## Verdict

Pass with caveat.

