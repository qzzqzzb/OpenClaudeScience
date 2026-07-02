# Default Workflow Policy

Use this policy for all SuperMe-managed Codex work. Do not split behavior by mode until repeated use shows that separate modes are needed.

## Before Acting

- Read `AGENTS.md` first.
- Check relevant `SuperMe-policies/` files for behavior rules.
- Check `SuperMe-docs/` when project state, decisions, experiments, or handoffs may matter.
- Identify the expected evidence before making a strong claim, launching an experiment, or changing behavior.
- If the task depends on prior state, do not rely on chat history alone.

## Documentation Freshness

- Update docs when durable project state changes.
- During long-running work, update docs at material checkpoints, not only at final completion.
- Before handoff, resume, stopping work, or reporting a completed milestone, refresh docs so the next agent can continue from files rather than chat memory.
- If docs are stale, contradictory, or missing, fix the docs or explicitly report the gap before continuing.
- Do not put experiment results, run status, or project facts only in chat.
- Update policies only when future behavior rules change.
- Keep docs focused and split long details into linked documents.

## SuperMe Artifact Protection

- SuperMe artifacts must be maintained only through SuperMe-defined mechanisms.
- SuperMe artifacts include `AGENTS.md` SuperMe managed blocks, `SuperMe-policies/`, `SuperMe-docs/`, `.superme/`, SuperMe-managed `.codex/config.toml` blocks, SuperMe-managed `.codex/hooks` entries/scripts, and SuperMe installer metadata.
- Do not let project-local scripts, formatters, generators, generic cleanup tools, or unrelated skills rewrite, reorganize, delete, or migrate SuperMe artifacts.
- Use the SuperMe installer/updater for managed workflow files when available.
- Use the documented SuperMe policy/docs workflow for project-owned SuperMe docs and policies.
- If another project mechanism appears to conflict with SuperMe artifacts, stop and report the conflict instead of adapting SuperMe files silently.
- SuperMe updates should perform only low-risk automatic changes: update unmodified managed artifacts, create missing project-owned artifacts, and preserve project-owned content.
- If a project has locally changed a managed SuperMe artifact, stop automatic update and use `superme-update-conflict` to inspect the conflict with the user.

## Development Work

- Read nearby code and existing conventions before editing.
- Keep changes scoped to the requested behavior.
- Do not add silent fallback paths.
- Do not hide errors with broad exceptions, default substitutions, skipped checks, or degraded modes.
- Do not weaken tests, assertions, validation, or type/lint checks to make a change appear successful.
- Run the most relevant tests or checks for the changed surface.
- If validation cannot run, report why and state residual risk.

## Research And Experiments

- Check project docs and experiment registry before launching or interpreting experiments.
- Record run ids, configs, commands, seeds, artifacts, metrics, and decisions in project docs.
- Preserve comparability: do not change concurrency, seeds, data split, model, provider, prompt, evaluator, or resource shape silently.
- If an experiment family requires repeated runs, fixed concurrency, or a specific seed set, follow it exactly.
- Separate observed results from interpretation.
- Claims about experiment success, regression, improvement, or failure must cite concrete artifacts, metrics, logs, or commands.

## RJob And Cluster Work

- Before submission, check namespace, quota group, resource shape, idle policy, image, entrypoint, mounts, secrets, and traceability docs.
- CPU-only blocked jobs may use idle fallback only when preemption is acceptable.
- GPU jobs must not silently switch to idle.
- Cross-project quota use must include the appropriate namespace, for example submitting from `agentsft` to `ma4agismall` requires `--namespace ma4agismall`.

## No Silent Shortcuts

- Do not skip relevant checks because they are slow without saying so.
- Do not replace a real dependency, dataset, provider, model, config, evaluator, or cluster resource with a convenient substitute unless explicitly approved.
- Do not mask a failing path with mocks, defaults, broad exception handling, cached outputs, or partial artifacts unless the task is explicitly about that behavior.
- If a shortcut is unavoidable, make it visible in the report and record any durable consequence in docs.

## Self-Evolution

- When the user expresses dissatisfaction with Codex behavior, treat it as a workflow incident.
- Record the case in `SuperMe-docs/20-workflow-incidents.md` with enough context for later review.
- Do not immediately apply or propose a policy update unless the user explicitly asks.
- During triage, classify the issue as style, global-policy, project-policy, docs-content, skill, tooling, project-code, or no durable change.
- Record policy changes in `SuperMe-policies/policy-changelog.md` only after triage.
- Do not add a global policy from a one-off preference unless it has clear future value.

## Reporting

- Keep final answers concise.
- Report changed behavior, validation performed, and remaining risk.
- Do not over-explain implementation details unless the user asks.
- If work is complete, mention whether docs needed updates and whether they were updated.
