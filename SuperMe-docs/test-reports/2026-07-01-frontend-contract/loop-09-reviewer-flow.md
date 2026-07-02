# Loop 09 - Reviewer Failure And Manual Findings

## Test Task

Verify reviewer failure is explicit and manual findings appear in frontend/provenance.

## Acceptance Criteria

- UI Review button without findings must fail explicitly, not fake success.
- Manual `reviewer.run` with linked finding must create review records.
- Artifact provenance review tab must include the finding.
- Frontend conversation should show `Reviewer · 1 findings` card.

## Operations

1. Clicked frontend `Review` button with no findings payload.
2. Captured error toast.
3. Sent WebSocket `reviewer.run` with one manual finding linked to:
   - transcript `#msg_user_mr265yi6_5hzned`
   - provenance `/v1/artifacts/art_GNM6FfLmnpF9/versions/ver_9pfQ0dlTsxEQ/provenance`
4. Queried `/v1/sessions/:sessionId/reviews`.
5. Queried artifact provenance again.

## Screenshots

![Loop 09 explicit reviewer failure](assets/loop-09-reviewer-explicit-failure.png)

![Loop 09 reviewer completion without findings card](assets/loop-09-reviewer-findings-card.png)

## Observed Result

- UI showed `INTERNAL_ERROR: Reviewer run requires explicit findings or failReason`.
- Backend created completed review `rev_7LSj4zBzEqHe`.
- Backend review included finding `finding_UuNsFoDhG2CR`.
- Artifact provenance review tab included the finding.
- UI only showed `Reviewer started` / `Reviewer completed` toasts; it did not render a `Reviewer · 1 findings` card.

## Likely Cause

The backend finding payload uses `id` and does not include `sessionId`; frontend state expects `findingId` and filters findings by `sessionId`.

## Verdict

Fail.

