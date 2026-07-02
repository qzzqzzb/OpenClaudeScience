# Loop 02 - No-Session Chat Send

## Test Task

Verify that sending a message with no selected session creates a session, sends through OpenCode, and preserves user/assistant messages.

## Acceptance Criteria

- Composer send auto-creates a session.
- User prompt remains visible.
- Backend session enters runtime flow and returns to `idle`.
- Assistant response appears without duplicate/`NaN` message artifacts.

## Operations

1. Started from no selected session.
2. Typed `Reply exactly TEST_OK and nothing else.` in the composer.
3. Clicked the composer send button.
4. Waited for `/v1/sessions?group=all` latest session to return `idle`.
5. Queried `/v1/sessions/:sessionId/messages`.

## Screenshots

![Loop 02 before send](assets/loop-02-before-send.png)

![Loop 02 running](assets/loop-02-running.png)

![Loop 02 after reply](assets/loop-02-after-reply.png)

## Observed Result

- Adapter created session `ses_Rmst77P99Hgz`.
- Backend messages contained one `user` and one `assistant` message.
- UI displayed the user prompt and assistant `TEST_OK`.
- No `NaN` text appeared.

## Verdict

Pass.

