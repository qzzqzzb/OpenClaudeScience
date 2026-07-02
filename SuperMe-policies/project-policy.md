# Project Policy

Project-local behavior rules live here. These rules apply to this project but should not become global SuperMe policy unless later triage accepts them.

## Current Project Rules

### Milestone-Gated Loop Development

OpenClaudeScience development must follow milestone-gated loop development.

- A milestone may contain multiple implementation loops.
- A loop is executed by the current Codex conversation/session.
- Do not create a separate worker, thread, automation, or background agent to own the loop unless the user explicitly asks.
- Inside a milestone, loops may proceed automatically after the user approves entry into that milestone.
- Moving from one milestone to the next requires explicit user review and approval.
- Each loop must begin with a Stage 1 brief before implementation:
  - task objective;
  - relevant context index;
  - acceptance criteria;
  - expected verification evidence.
- If Stage 1 determines that the current milestone objective is already complete, stop the loop, mark the milestone complete in project docs, and hand off to the user for review. Do not start the next milestone automatically.
- Each loop must then perform Stage 2 implementation scoped to the Stage 1 objective.
- Each loop must then perform Stage 3 review using the project review subagent skill when available. The review subagent is independent review support, not the owner of the loop.
- Findings from Stage 3 must be fixed or explicitly deferred with user-visible rationale before the loop is considered complete.
- Loop completion requires recorded verification evidence in project docs.
- Do not use chat memory alone as the basis for milestone or loop completion claims.
- Do not silently widen loop scope to make progress; if the objective is wrong or too small, revise the Stage 1 brief before implementation.
