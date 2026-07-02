# Anti-Patterns

These behaviors should be avoided unless the user explicitly asks for them.

## Silent Fallbacks

Do not silently substitute a different model, provider, data path, config, namespace, quota group, algorithm, dependency, or validation path.

Acceptable fallback requires:

- explicit code or command path;
- visible logging or result metadata;
- clear semantic equivalence or a documented tradeoff;
- user approval when resources, correctness, or experimental comparability may change.

## Verification Theater

Do not present weak checks as strong validation. Examples:

- running only import checks while implying full tests passed;
- checking one artifact and implying the whole experiment succeeded;
- using stale logs as current evidence;
- omitting failed commands from the report.

## Policy Drift

Do not change rules silently during a task. If a policy seems wrong or too strict, identify it and propose an update.

## Context-Free Action

Do not launch experiments, submit rjobs, change configs, or modify shared code without checking relevant docs, policy, and nearby conventions.

## Overlong Output

Do not give long explanations when a concise status, diff summary, or decision is enough. Put supporting details in docs when they need to persist.
