# SuperMe Docs

This directory is the canonical project documentation hub. It records project state, decisions, experiments, implementation notes, operational procedures, and workflow incidents.

## Document Index

| Document | Purpose | Update When | Last Updated |
| --- | --- | --- | --- |
| [README.md](README.md) | Directory for managed project documents and documentation rules. | Any managed document is added, renamed, removed, or changes purpose. | 2026-07-01 |
| [10-adapter-contract.md](10-adapter-contract.md) | Frontend-facing adapter contract and OpenCode runtime interaction design. | Adapter API, event schema, runtime ownership, or frontend integration flow changes. | 2026-07-01 |
| [11-adapter-implementation.md](11-adapter-implementation.md) | Current adapter implementation status, OpenCode version pin, runtime startup notes, and validation log. | Adapter implementation, dependency version, runtime startup procedure, or validation status changes. | 2026-07-01 |
| [12-project-skills.md](12-project-skills.md) | Project-local Codex skills installed under `.codex/skills/`. | Project-local skills are added, removed, renamed, or materially changed. | 2026-07-01 |
| [13-development-milestones.md](13-development-milestones.md) | Adapter development milestones, scope, and acceptance criteria for loop-driven implementation. | Milestone scope, order, status, or acceptance criteria changes. | 2026-07-01 |
| [14-development-loop.md](14-development-loop.md) | Milestone-gated loop development process, loop stages, review-agent gate, and handoff rules. | Development loop process or milestone-gating rules change. | 2026-07-01 |
| [20-workflow-incidents.md](20-workflow-incidents.md) | Queue of user dissatisfaction cases and workflow gaps awaiting triage. | User expresses dissatisfaction with Codex behavior or a workflow gap is found. | YYYY-MM-DD |
| [30-upstream-proposals.md](30-upstream-proposals.md) | Issue convention for proposing project workflow lessons back to SuperMe upstream. | The upstream proposal workflow, issue template, or review criteria change. | YYYY-MM-DD |

## Documentation Rules

- Keep project docs under `SuperMe-docs/`.
- Keep documents focused and linked; split broad docs into narrower documents.
- If a document becomes too long, move details into a new linked document and leave a concise summary in the original.
- Record timeline events with concrete timestamps.
- Preserve strategy/config/result changes in order.
- Update docs proactively when project state changes; do not rely on the human to remind the agent.
