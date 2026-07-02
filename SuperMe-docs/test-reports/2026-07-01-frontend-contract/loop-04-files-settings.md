# Loop 04 - Files And Settings Catalogs

## Test Task

Verify Files and Settings surfaces required by the frontend shell contract.

## Acceptance Criteria

- Files view loads project tree from adapter.
- Settings view renders Permissions, Connectors, Skills, Specialists, and Network allowlist catalog sections.
- Adapter HTTP snapshots for files/settings/permissions/skills/connectors succeed.

## Operations

1. Clicked `Files`.
2. Captured visible project file tree.
3. Clicked `Customize`.
4. Captured Settings inspector and scrolled to lower catalog sections.
5. Queried `/v1/files/tree`, `/v1/settings`, `/v1/permissions`, `/v1/skills`, and `/v1/connectors`.

## Screenshots

![Loop 04 files tree](assets/loop-04-files-tree.png)

![Loop 04 settings](assets/loop-04-settings.png)

![Loop 04 settings scrolled](assets/loop-04-settings-scrolled.png)

## Observed Result

- Files view showed project entries including `src`, `SuperMe-docs`, `package.json`, and `README.md`.
- Settings showed adapter catalogs, General, Permissions, Connectors, Skills, Specialists, and Network allowlist.
- Skills snapshot returned 29 skills.

## Caveat

Files UI also displayed ignored/sensitive entries such as `.env`, `.git`, `dist`, and `node_modules`. Backend marks ignored entries, but frontend currently renders them plainly.

## Verdict

Pass with caveat.

