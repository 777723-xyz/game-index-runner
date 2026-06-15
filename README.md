# WebRPG Index

This repository hosts a JSON index of web-playable RPG Maker games found on GitHub.

Data file:

- `list.json`

The list is sorted by `title`. Language metadata is intentionally omitted until it can be verified reliably.

## Fork Workflow

The `Fork listed repositories` workflow reads `list.json`, deduplicates source repositories, and forks missing repositories into `WebRPG-org`.

The workflow is manually triggered and defaults to dry-run mode. To create forks, add a repository or organization secret named `WEBRPG_FORK_TOKEN`, then run the workflow with `dry_run` set to `false`.

The token must belong to a user or app that can create repositories in `WebRPG-org`. For fine-grained tokens, GitHub documents the fork endpoint as requiring repository `Administration` write permission and `Contents` read permission.

The workflow waits between fork creation requests to avoid GitHub secondary rate limits. Defaults:

- `create_delay_seconds`: `20`
- `retry_limit`: `5`
- `retry_base_delay_seconds`: `60`

If GitHub still reports that requests were submitted too quickly, rerun the workflow with `create_delay_seconds` set to `30` or `60`. Existing forks are detected and skipped.

Fork names use this format:

```text
sourceOwner-sourceRepo
```

This avoids name collisions for common repository names such as `game`, `rpg`, and `github.io`.

## Prepare Fork Workflow

The `Prepare fork repositories` workflow processes fork repositories that already exist in `WebRPG-org`.

It does two things for each matching fork:

- Adds this analytics script tag to HTML files that do not already contain it:

```html
<script defer src="https://insight.ravelloh.com/script.js?siteId=5ace6623-f51b-4571-8f60-e0473ea3317b"></script>
```

- Enables GitHub Pages from the repository default branch and `/`.

The public Pages URL path is determined by the repository name. For example, `WebRPG-org/example-game` is published at:

```text
https://webrpg.org/example-game/
```

This workflow uses a GitHub App token. Create and install a GitHub App on `WebRPG-org`, then add these Actions settings to this repository or to the organization with access granted to this repository:

- Variable: `WEBRPG_APP_CLIENT_ID`
- Secret: `WEBRPG_APP_PRIVATE_KEY`

Recommended GitHub App repository permissions:

- `Administration`: read and write
- `Contents`: read and write
- `Pages`: read and write
- `Metadata`: read-only

Install the App on all repositories in `WebRPG-org`. This matters because new fork repositories will be added over time; a selected-repositories installation will not automatically include new forks.

The workflow is manually triggered and defaults to `dry_run=true`.

During each run, the workflow validates every matching fork before preparing Pages. A fork is treated as valid only when it has an RPG Maker MV/MZ web structure, such as a HTML entry file plus the expected `js/rpg_core.js` or `js/rmmz_core.js` runtime files.

When `dry_run=false` and `delete_invalid_repos=true`, invalid forks are deleted from `WebRPG-org`. The final aggregation job updates `list.json` with validation metadata:

- `status`: `verified` or `invalid_structure`
- `checkedAt`
- `forkName`
- `pagesUrl`
- `entryPath`
- `cover`
- `invalidReason`
- `deletedAt`

Cover URLs are inferred from files in the fork, prioritizing RPG Maker paths such as `icon/icon.png`, `img/titles1/*`, `img/titles2/*`, and `img/pictures/*`.

Entries marked `invalid_structure` are skipped by the fork workflow so they are not recreated on the next fork run.
