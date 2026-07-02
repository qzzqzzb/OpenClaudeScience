# Project Skills

## Purpose

This document records project-local Codex skills installed under `.codex/skills/`.

## Installed Skills

| Skill | Source | Purpose | Installed |
| --- | --- | --- | --- |
| `review-pr-subagent` | Adapted from the InternAgent2 project-local `review-pr-subagent` skill. | Review OpenClaudeScience PRs or implementation loops with an independent subagent against the adapter contract and project policy. | 2026-07-01 |

## Notes

- The skill was copied as project-local configuration, including `SKILL.md` and `agents/openai.yaml`.
- The copied InternAgent2-specific references were replaced with OpenClaudeScience docs, especially `SuperMe-docs/10-adapter-contract.md` and `SuperMe-docs/11-adapter-implementation.md`.

## Timeline

- 2026-07-01 15:38 Asia/Shanghai: Copied `review-pr-subagent` from InternAgent2 into this project.
  Reason: The project needs a reviewer agent skill for future PR review and policy checks.
  Impact: Codex can discover the project-local skill at `.codex/skills/review-pr-subagent`.
- 2026-07-01 15:42 Asia/Shanghai: Adapted `review-pr-subagent` for OpenClaudeScience implementation loops.
  Reason: The project will use loop-driven implementation and needs reviews against the adapter contract, runtime boundaries, and project policy rather than InternAgent2 issue readiness rules.
  Impact: Reviewer prompts now focus on OpenCode adapter boundaries, frontend contract stability, explicit runtime behavior, artifact/provenance ownership, and verification evidence.
