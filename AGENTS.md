<!-- BEGIN SUPERME MANAGED BLOCK -->
# SuperMe Workflow Constitution

SuperMe defines a reusable Codex workflow. When this file is present in a project, follow it before using project-specific context.

## Load Order

1. Read this file first.
2. Read `SuperMe-policies/default-workflow.md` for the default working policy.
3. Treat the rest of `SuperMe-policies/` as behavior rules.
4. Treat `SuperMe-docs/` as project state and historical record.

Policies say how future work must be done. Docs say what has happened or what is currently true. Do not mix the two.

## Always-On Rules

- Keep user-facing answers concise unless the user asks for depth.
- Do not add silent fallbacks. If fallback behavior is needed, make it explicit, observable, justified, and preferably user-approved.
- Prefer fail-fast behavior over hidden degradation.
- Do not fabricate verification. Report what was run, what was not run, and why.
- Before changing behavior, read existing local conventions, docs, and nearby code.
- Do not bypass tests, type checks, lint, or experiment gates by weakening them unless the user explicitly asks.
- Do not hide uncertainty with confident wording. State assumptions and evidence.
- Preserve user changes. Never revert work you did not make unless explicitly asked.
- Update docs or policies when the work changes durable project state, rules, decisions, or experiment records.

## Default Workflow

Use one default workflow policy for all work:

- `SuperMe-policies/default-workflow.md`

Do not split behavior by mode until repeated use shows that separate modes are needed.

## Self-Evolution

When the user is unhappy with Codex behavior, treat it as a workflow incident:

1. Record the case in `SuperMe-docs/20-workflow-incidents.md`.
2. Do not immediately turn dissatisfaction into a policy change unless the user explicitly asks.
3. During later triage, decide whether it needs a global policy update, project policy update, documentation content update, skill/tooling update, project-code change, or no durable change.
4. Record durable policy changes in `SuperMe-policies/policy-changelog.md` only after triage.
5. Do not turn one-off preferences into global rules without evidence that they should recur.
<!-- END SUPERME MANAGED BLOCK -->
