# Upstream Proposals

## Purpose

This document defines how a SuperMe-managed child project should propose workflow improvements back to the SuperMe upstream project.

An upstream proposal is similar to a crash report for Codex workflow behavior: it records the context, the bad or undesirable agent behavior, the expected behavior, evidence, and the suggested SuperMe change. It is a review input, not an automatic policy update.

## When To File

File an upstream proposal when a child project finds a rule, guardrail, skill behavior, installer behavior, hook check, or documentation standard that may be useful beyond that one project.

Good triggers include:

- Codex repeated a bad behavior despite project-local docs or policy.
- A project-local rule appears generally useful across research or development projects.
- A workflow incident reveals a missing global guardrail.
- A skill needs a reusable procedure update.
- The SuperMe installer, hook, or template needs a durable behavior change.

Do not file an upstream proposal for:

- one-off personal annoyance without expected recurrence;
- project facts, experiment results, or temporary status;
- private secrets, tokens, credentials, or sensitive raw logs;
- rules that are only valid for one repository unless clearly marked as project-local.

## Issue Title

Use a stable title:

```text
[Upstream Proposal] <short behavior or rule summary>
```

Examples:

```text
[Upstream Proposal] Require explicit evidence before claiming experiment success
[Upstream Proposal] Add guard against silent provider/model fallback
[Upstream Proposal] Promote project-local rjob namespace check
```

## Required Issue Body

Use this template:

```md
## Summary

One or two sentences describing the proposed SuperMe change.

## Source Project

- Project:
- Repository/path:
- SuperMe version or manifest:
- Date:
- Reporter:

## Background

What was the user or agent trying to do? Include enough project context for an upstream reviewer to understand the workflow, but do not copy unrelated project details.

## Observed Agent Behavior

Describe the undesirable Codex behavior plainly.

- What did Codex do?
- Why was it bad, risky, noisy, or inconsistent?
- Did it violate an existing SuperMe rule?

## Expected Behavior

Describe what Codex should have done instead.

## Evidence

Link or summarize concrete evidence.

- Relevant project docs:
- Incident id:
- Commands/logs/artifacts:
- Chat excerpt or user complaint:
- Affected files:

Do not include secrets or full private logs. Summarize sensitive evidence and point to local paths when needed.

## Proposed Upstream Change

Select one or more candidate destinations:

- `AGENTS.md` constitution
- `SuperMe-policies/default-workflow.md`
- `SuperMe-policies/anti-patterns.md`
- `SuperMe-policies/user-preferences.md`
- reusable skill update
- installer/template update
- hook/audit update
- documentation standard
- no upstream change; keep project-local

Then describe the concrete rule or behavior change.

## Scope And Risk

- Why should this become global rather than project-local?
- What tasks or projects might it affect?
- Could it make Codex too conservative, verbose, slow, or brittle?
- What exceptions should be allowed?

## Suggested Validation

How should the upstream change be checked?

- docs review only
- template install/update smoke test
- hook smoke test
- skill behavior review
- project replay/manual scenario

## Review Decision

Leave this section for the SuperMe maintainer.

- Decision: accept | revise | keep-project-local | decline
- Destination:
- Follow-up PR/commit:
- Notes:
```

## Review Rules

The SuperMe upstream reviewer should:

- treat the issue as evidence and a proposal, not as a command;
- check whether the behavior is already covered by existing policy;
- prefer project-local policy when the rule depends on one project, team, dataset, cluster, or experiment family;
- promote only rules that are durable, actionable, specific, and likely to recur;
- update `SuperMe-policies/policy-changelog.md` when a proposal becomes policy;
- update the relevant skill, hook, template, or docs when the durable fix belongs there instead of in policy;
- close or mark declined proposals with a short reason.

## Relationship To Workflow Incidents

Child projects should usually record the original problem in `SuperMe-docs/20-workflow-incidents.md` first. An upstream proposal can then reference that incident after project-local triage decides that the issue may deserve a global SuperMe change.

Do not skip local triage unless the missing SuperMe behavior is obvious and likely to affect multiple projects.

## Timeline

- YYYY-MM-DD HH:MM TZ: Created upstream proposal convention for this project.
  Reason:
  Impact:
