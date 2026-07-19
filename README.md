# WebRPG Index

This repository hosts a JSON index of web-playable RPG Maker games found on GitHub.

Data file:

- `list.json`

The list is sorted by `title`. Language metadata is intentionally omitted until it can be verified reliably.

## Fork Workflow

The `Index GitHub RPG Maker repositories` workflow runs every two hours (at minute 17, UTC) and searches GitHub code for RPG Maker MV/MZ web entry files. It adds repositories that are not already in `list.json`.

The `Fork listed repositories` workflow runs automatically after the index workflow succeeds. It reads `list.json`, deduplicates source repositories, and forks missing repositories into `777723-xyz`. Each run is capped at five new forks to avoid secondary-rate-limit failures.

The installed GitHub App token is used for indexing, commits, and fork creation; no personal access token is required.

The workflow waits between fork creation requests to avoid GitHub secondary rate limits. Defaults:

- `create_delay_seconds`: `20`
- `retry_limit`: `5`
- `retry_base_delay_seconds`: `60`

If GitHub still reports that requests were submitted too quickly, increase `CREATE_DELAY_SECONDS` in `.github/workflows/fork-listed-repos.yml`. Existing forks are detected and skipped.

Repositories are skipped when:

- The source repository is already forked into `777723-xyz`.
- `777723-xyz` already has a repository with the target fork name.
- The `list.json` entry is marked `invalid_structure`, `deleted_invalid_structure`, or `duplicate_name`.
- Another entry already uses the same repository name, even when the owner is different.

Fork names use this format:

```text
sourceOwner-sourceRepo
```

This avoids name collisions for common repository names such as `game`, `rpg`, and `github.io`.

## Prepare Fork Workflow

The `Prepare fork repositories` workflow runs automatically after the fork workflow succeeds. It processes up to five fork repositories that already exist in `777723-xyz`.

It validates the RPG Maker structure, optionally extracts a local cover image, and enables GitHub Pages from the repository default branch and `/`. It does not inject analytics or other third-party scripts.

The public Pages URL path is determined by the repository name. For example, `777723-xyz/example-game` is published at:

```text
https://777723-xyz.github.io/example-game/
```

This workflow uses a GitHub App token. Create and install a GitHub App on `777723-xyz`, then add these Actions settings to this repository or to the organization with access granted to this repository:

- Variable: `WEBRPG_APP_CLIENT_ID`
- Secret: `WEBRPG_APP_PRIVATE_KEY`

Recommended GitHub App repository permissions:

- `Administration`: read and write
- `Contents`: read and write
- `Pages`: read and write
- `Metadata`: read-only

Install the App on all repositories in `777723-xyz`. This matters because new fork repositories will be added over time; a selected-repositories installation will not automatically include new forks.

The workflow is fully automatic. It does not run in dry-run mode.

During each run, the workflow validates every matching fork before preparing Pages. A fork is treated as valid only when it has an RPG Maker MV/MZ web structure, such as a HTML entry file plus the expected `js/rpg_core.js` or `js/rmmz_core.js` runtime files.

The supplied workflow keeps invalid forks (`DELETE_INVALID_REPOS=false`) for inspection instead of deleting them. The final aggregation job updates `list.json` with validation metadata:

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
