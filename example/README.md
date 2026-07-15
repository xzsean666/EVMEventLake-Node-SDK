# Standalone GitHub Consumer Example

This directory is an independent consumer project. It is not a package in the
SDK repository workspace and it never imports `../src`, `../dist`, or a local
workspace link. Its dependency is a GitHub tag, so successful installation and
verification prove that the GitHub-hosted package can build and run for a clean
consumer.

The example covers:

- Package-root runtime and TypeScript imports.
- SQLite initialization and durable sync status.
- HTTP RPC chain validation, endpoint failover, and adaptive range splitting.
- Known-event decoding and unknown raw-log preservation.
- Event signature, transaction, block-range, and indexed-parameter queries.
- Cursor pagination, database-only queries after RPC shutdown, no-op updates,
  observability callbacks, and idempotent close behavior.

## Run the release tag

The default dependency is `v0.1.0`. That tag must exist on GitHub before this
command can succeed:

```bash
cd example
pnpm install --frozen-lockfile=false
pnpm run verify
```

`example/pnpm-workspace.yaml` makes this directory its own pnpm boundary.
Generated dependencies and SQLite files stay below `example/` and are ignored.

## Test an immutable commit instead

Change only this consumer project to a pushed full commit SHA:

```bash
cd example
pnpm add --save-exact \
  'github:xzsean666/EVMEventLake-Node-SDK#<full-commit-sha>'
pnpm run verify
```

The repository-level command performs the same test in an operating-system
temporary directory and checks that the SDK worktree is unchanged:

```bash
EVM_EVENT_LAKE_GIT_INSTALL_SPEC=github:xzsean666/EVMEventLake-Node-SDK#<full-commit-sha> \
pnpm run test:github-install
```

Production verification must use a semantic version tag or full 40-character
commit SHA. A mutable branch such as `main` is intentionally rejected.
