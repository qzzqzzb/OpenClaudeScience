---
name: review-pr-subagent
description: Review OpenClaudeScience implementation work with an independent subagent. Use when the user asks Codex to review a PR, review a loop iteration, start a reviewer agent, check whether implementation matches project docs or adapter contract, or inspect for policy violations, runtime boundary issues, hidden fallback, or insufficient tests.
---

# Review Subagent

Use this skill to run an independent review of OpenClaudeScience implementation work, then close that subagent after it returns.

This project is expected to advance through implementation loops. A review may target a PR, a branch diff, the current uncommitted workspace, or a specific loop milestone.

## Workflow

1. Identify the review target:
   - PR number, if reviewing a PR;
   - branch/base range, if reviewing a branch;
   - current uncommitted workspace, if reviewing loop work in progress;
   - specific files or milestone, if the user names them.
2. Identify the implementation objective from project docs or the user's latest loop request. Treat durable project docs as stronger evidence than chat memory.
3. Read the project policy and design context that can constrain the review:
   - `AGENTS.md`
   - `SuperMe-policies/default-workflow.md`
   - `SuperMe-policies/constitution.md`
   - `SuperMe-docs/10-adapter-contract.md`
   - `SuperMe-docs/11-adapter-implementation.md`
   - other focused docs under `SuperMe-docs/` if the change touches their topic
4. Inspect the relevant diff, changed files, tests, docs, and exact verification output.
5. Start one independent subagent with a review-only prompt. If subagent tools are not currently available, use tool discovery for multi-agent/subagent tools; if still unavailable, report that the subagent review could not be run.
6. Give the subagent the review target, implementation objective, repository path, and exact review checklist below. Do not give it your conclusions or suspected bugs.
7. When the subagent returns, close or terminate the subagent with the available subagent management tool. Report that it was closed. If the subagent runtime auto-closes completed agents or no close tool exists, state that explicitly.
8. Present findings first, ordered by severity. Include file/line references when available.

## Subagent Prompt

Use a prompt in this shape:

```text
Review <REVIEW_TARGET> in OpenClaudeScience at <REPO_PATH>. This is a review-only task; do not edit files.

First read the project policy and design context:
- AGENTS.md
- SuperMe-policies/default-workflow.md
- SuperMe-policies/constitution.md
- SuperMe-docs/10-adapter-contract.md
- SuperMe-docs/11-adapter-implementation.md
- any other focused SuperMe-docs files directly related to the changed surface

Then inspect the changed files, relevant nearby code, tests, docs, and verification evidence.

Focus especially on:
- whether the implementation matches the adapter contract and OpenCode interaction design;
- whether frontend-facing API/event/schema changes are documented and stable;
- whether OpenCode runtime concerns are isolated behind the adapter rather than leaking raw OpenCode IDs, schemas, or lifecycle assumptions to the frontend contract;
- whether adapter-owned state is handled by the adapter rather than delegated to frontend state or hidden runtime behavior;
- silent fallbacks, hidden degraded behavior, fake success, swallowed structured errors, or unobservable runtime substitutions;
- runtime mode, process lifecycle, shutdown, port, and Windows/PowerShell command boundary issues;
- permission, artifact, provenance, annotation, reviewer, delegation, settings, storage, and kernel boundaries defined in the project docs;
- missing or weak tests, smoke checks, docs, or verification evidence relative to the changed behavior;
- accidental edits to SuperMe-managed artifacts or weakening of project policy, checks, scripts, or validation.

Return findings only. For each finding include severity P0/P1/P2/P3, file and line when available, evidence, why it violates project policy or design, and a concrete fix. If there are no findings, say so and list residual risks or test gaps.
```

## Review Standards

- Do not accept "works in chat" as evidence. Prefer code, tests, docs, command output, runtime health output, logs, and exact reproduction steps.
- Treat `SuperMe-docs/10-adapter-contract.md` as the frontend contract source of truth until a newer project doc supersedes it.
- Treat `SuperMe-docs/11-adapter-implementation.md` as the current implementation status and validation log until it is updated.
- Flag any implementation that makes frontend/session/UI state authoritative for adapter-owned state such as permissions, artifacts, provenance, runtime lifecycle, kernel state, or review findings.
- Flag any raw OpenCode schema, runtime ID, permission model, or event shape that leaks into the frontend contract without an explicit adapter mapping.
- Flag hidden fallback. If fallback is needed, it must be explicit, observable, justified, and documented or tested.
- Flag any runtime substitution that changes model, provider, host, port, execution backend, permission policy, or process ownership without being visible to users or logs.
- Flag changes that weaken governance, hooks, docs, tests, type checks, or project policy unless explicitly requested and verified.
- Distinguish OpenCode runtime failures from adapter contract failures.

## Output Format

When reporting the review:

```text
Findings
- [P1] Short title - path/to/file:line
  Evidence and why it violates the project contract/policy. Concrete fix.

Open Questions
- ...

Subagent Lifecycle
- Started: yes/no
- Closed: yes/no, with note if auto-closed or unavailable

Verification Notes
- Commands/results inspected, or checks missing from the reviewed work.
```

If there are no findings, say `No findings` and still include residual risk, subagent lifecycle, and verification notes.
