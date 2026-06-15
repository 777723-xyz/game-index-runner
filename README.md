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
