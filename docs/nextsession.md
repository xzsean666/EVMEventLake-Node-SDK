# Next Session Handoff

Last updated: 2026-07-15

## 1. Current Status

Steps 1 through 3 of the repository workflow are complete and Step 4 is active:

- Step 1: Architecture design completed and committed.
- Step 2: Product, build, external documentation, and agent rules completed and
  committed.
- Step 3: This context handoff completed.
- Step 4: Approved on 2026-07-14; Phases 1 through 11 completed and verified.

The repository now contains an ESM package foundation, pinned dependencies,
strict TypeScript and ESLint configuration, public errors, observability
contracts, configuration validation, target identity, ABI catalog, event
decoding, lossless value codec, SQLite/PostgreSQL adapters, migrations, leases,
atomic range commits, rewind, HTTP RPC transport/pool, and tests.
Adaptive synchronization, one-shot update orchestration, cancellation, lease
renewal, reorg recovery, database-only query, versioned pagination, and the
public client lifecycle are also implemented. Local HTTP end-to-end coverage,
a gated Base USDC live-chain verification, a narrow public package surface, and
clean exact-commit Git installation, a standalone consumer example, and the
documented progress/logging stages are complete. The pushed GitHub full
commit was installed successfully by the standalone consumer. The shared
storage and query contracts also passed against PostgreSQL 18.4 using isolated
temporary schemas.

## 2. Required Read Order

For the next session, read:

1. `Agent.md`
2. `docs/nextsession.md`
3. `docs/ARCHITECTURE.md`
4. `docs/SPEC.md`
5. `docs/BUILD.md`
6. `docs/EXTERNAL_DOCS.md`

## 3. Project Summary

EVMEventLake Node SDK is an embeddable TypeScript library that:

- Owns exactly one EVM `chainId + contractAddress` target per instance.
- Fetches target-address logs through multiple HTTP JSON-RPC endpoints.
- Extracts all events from a supplied ABI and decodes matching logs.
- Retains raw logs when they are unknown or decoding fails.
- Stores logs and durable sync state in SQLite or PostgreSQL.
- Performs one finite synchronization run per explicit `update` call.
- Exposes database-only event queries.
- Is installed from GitHub tags or commits and is not published to npm.

The caller owns scheduling, update loops, cron/workers, recent-block business
windows, analysis, alerts, notifications, and all downstream domain logic.

## 4. Architecture Summary

### Public lifecycle

- Asynchronous `create` initializes configuration, ABI metadata, and database
  state without requiring RPC availability.
- `update` validates RPC endpoints and performs one finite synchronization run.
- `getSyncStatus` reads only durable local state.
- `events.findMany` and `events.findFirst` query the database only.
- `close` releases owned resources.

### Primary modules

- `client` — public façade.
- `configuration` — option validation and defaults.
- `contract-target` — immutable target identity.
- `rpc` — HTTP endpoint validation, selection, retry, cooldown, and failover.
- `abi` — event catalog, decoding, and lossless value conversion.
- `synchronization` — update orchestration, range planning, adaptive fetch,
  checkpoints, and rewind.
- `storage` — shared adapter contract with SQLite and PostgreSQL implementations.
- `query` — database-only filters, ordering, and cursor pagination.
- `observability` — optional structured logger and progress callbacks.
- `errors` — typed public error taxonomy.

### Synchronization rules

- `startBlock` and `toBlock` are inclusive.
- `nextBlock` is the first uncommitted block.
- Each completed contiguous range atomically commits logs, queryable parameters,
  checkpoint, and cursor.
- Range/size limits split the range.
- A first large-range timeout may split; repeated timeouts have a bounded split
  budget and then fail over.
- HTTP/transport failures use bounded retry, cooldown, and failover.
- Every endpoint must match configured chain ID before serving sync data.
- A single block that fails across every endpoint stops with a typed error and
  remains uncommitted.
- Recent checkpoint hashes are validated and may trigger a bounded rewind.
- A target-scoped database lease prevents overlapping updates.

### Query rules

- Queries never contact RPC.
- V1 filters use AND composition.
- Supported filters include block number/range, transaction hash, event name,
  full event signature, and exact indexed parameter values.
- Canonical ordering is block number, transaction index, then log index.
- Pagination uses an opaque cursor, not offset.
- “Recent N blocks” is computed by the caller from `getSyncStatus` and submitted
  as a normal block-range query.

## 5. Completed Work

### Architecture

`docs/ARCHITECTURE.md` defines:

- Overall system boundary and diagrams.
- Recommended directory structure.
- Purpose, input, output, and dependencies for each module.
- Synchronization and query data flow.
- RPC adaptive splitting and error classification.
- Durable cursor, checkpoint, lease, and reorg behavior.
- Logical storage model.
- Incremental Step 4 implementation order.

### Product specification

`docs/SPEC.md` defines:

- Goals and non-goals.
- Creation, update, status, query, and close behavior.
- Configuration and implemented defaults.
- SQLite/PostgreSQL parity requirements.
- ABI and raw-log preservation behavior.
- Query/result/error contracts.
- Acceptance criteria.

### Build and usage

`docs/BUILD.md` defines:

- Node.js/TypeScript/pnpm toolchain.
- GitHub tag/commit installation.
- No npm registry publication.
- Git-install build and consumer smoke tests.
- SQLite and PostgreSQL setup.
- Usage examples, including caller-owned update loops and recent-block logic.
- Test and release workflow.

### Agent workflow

`Agent.md` defines:

- Mandatory Step 1 through Step 4 protocol.
- AI-oriented modularity rules.
- Project boundaries and invariants.
- GitHub distribution rules.
- Required tests and documentation update matrix.
- Explicit implementation approval gate.

### External documentation

`docs/EXTERNAL_DOCS.md` records official documentation for:

- The related EVMEventLake Rust service.
- Ethereum JSON-RPC and execution APIs.
- viem, Kysely, better-sqlite3, and node-postgres.
- SQLite and PostgreSQL.
- Node.js, TypeScript, pnpm, and Node package lifecycle behavior.
- Vitest.
- ethers and Ponder as design references only.

All recorded links returned HTTP 200 when checked on 2026-07-14.

## 6. Key Decisions Already Made

Do not reopen these decisions casually. Change them only with an explicit reason
and synchronized documentation update.

1. Embedded SDK, not a server or daemon.
2. One instance per chain and contract target.
3. HTTP JSON-RPC only.
4. One-shot pull-based updates.
5. Database-only queries.
6. SQLite and PostgreSQL are first-class adapters.
7. Raw logs are retained before decoded convenience.
8. Unknown/decode-failed logs do not block cursor progress.
9. RPC pool policy belongs to the SDK; business scheduling does not.
10. Async creation does not require RPC connectivity.
11. RPC chain ID validation is mandatory before endpoint use.
12. Cursor progression is atomic per contiguous completed range.
13. Reorg handling uses checkpoints and bounded rewind.
14. GitHub Git references are the distribution mechanism.
15. The package is not published to the npm registry.
16. The package name is `@evm-event-lake/node-sdk`.
17. Core libraries are viem, Kysely, better-sqlite3, `pg`, and Vitest, with
    exact versions pinned in the manifest and lockfile.
18. No generic `utils`, `common`, or service-locator module.

## 7. Step 4 Implementation Progress

Follow this order. Each item must compile and pass focused tests before the next
item begins.

### Phase 1 — Package foundation — completed

Completed with ESM-only output, Node.js 22+ support, pinned dependencies,
registry publication disabled, public error/observability exports, normalized
configuration, URL redaction, 8 unit tests, and a passing build.

### Phase 2 — Target and ABI — completed

Completed with a stable lowercase target key, order-independent ABI fingerprint,
overload-aware event signatures/selectors, anonymous-event decoding, explicit
decoded/unknown/decode-failed outcomes, indexed topic preservation, and a
deterministic bigint-safe value codec. The full suite currently has 17 passing
tests.

### Phase 3 — Storage contract and SQLite — completed

Implemented schema migration, target and ABI registration, fixed-width portable
block keys, logs and indexed parameters, checkpoints, target-scoped leases,
atomic range commits, rewind, query primitives, WAL mode, and contract tests.

### Phase 4 — PostgreSQL — completed and verified on a real server

Implemented the standard `pg.Pool` adapter and ran the same six storage contract
tests through `pg-mem`. SQLite and PostgreSQL-dialect suites both pass. On
2026-07-15, the six storage contracts and three query contracts also passed
against PostgreSQL 18.4. Each test created and dropped its own unique schema.

### Phase 5 — RPC pool — completed

Implemented native HTTP JSON-RPC requests, caller cancellation and timeout
separation, lazy chain validation, mismatch exclusion, bounded retry, cooldown,
deterministic failover, range/timeout handoff to the adaptive layer, result
validation, metrics, redacted endpoint reporting, and opaque endpoint identity.
The full suite currently has 40 passing tests.

### Phase 6 — Synchronization engine — completed

Implemented gap-free range planning, streamed adaptive leaves, range/timeout
split policy, endpoint cooldown handoff, deterministic validation/order/dedup,
ABI decoding, atomic leaf commits, partial-progress errors, cancellation,
request-time lease renewal, observability events, and update metrics.

### Phase 7 — Reorg handling — completed

Implemented newest-to-oldest checkpoint validation, shallow reorg rewind and
replay, depth-exceeded failure, and checkpoint/log hash consistency checks. The
full suite currently has 49 passing tests.

### Phase 8 — Query API — completed

Implemented block/transaction/event/indexed filters, ABI width/type validation,
deterministic order, versioned target/order-scoped cursors, bigint rehydration,
SQLite/PostgreSQL query parity, offline client creation/query, one-shot update,
idempotent close, and closed-client protection. The full suite currently has 58
passing tests.

### Phase 9 — Integration and live verification — completed

Added local HTTP end-to-end coverage for an intentional 503 endpoint,
automatic endpoint failover, adaptive block-range splitting, ABI decode,
SQLite persistence/query, and closing during an active update. Added an
environment-gated real RPC test using Base mainnet (`8453`), USDC
`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, and fixed block `48625053`.
The sample returned 76 contract logs and 57 decoded Transfer events on
2026-07-14.

### Phase 10 — GitHub installation and release readiness — completed remotely

Added the root README, repository metadata, a narrow public package surface,
public sync/query/update types, and `scripts/test-git-install.mjs`. A clean
temporary consumer installed exact commit `89895f8` through local Git, ran the
package `prepare` lifecycle, compiled package-root TypeScript imports, and ran a
SQLite create/query/close smoke test. `better-sqlite3` installed successfully.
Release tags do not need committed `dist/`; it is built during Git installation.

GitHub full-commit verification passed for pushed commit
`7eb95d90bae26f229329fcc0c483dcce43fad08a`. No semantic version tag has been
created.

### Phase 11 — Standalone consumer and distribution audit — completed locally and remotely

Added `example/` as an independent pnpm consumer with a GitHub tag dependency,
TypeScript package-root compilation, and a Node built-in test that exercises
RPC failover/splitting, synchronization, decoded and unknown logs, filters,
pagination, offline database queries, no-op updates, observability, and close.
The repository install script now copies this maintained consumer to a temporary
directory, injects the exact local or GitHub reference, verifies the resolved
commit in its lockfile, and checks that the SDK worktree is unchanged.

The audit also found that documented `range_fetch_started`, `range_split`, and
endpoint progress stages were declared but not emitted. The synchronization
path now emits those stages plus range commit, reorg, completion/no-op, and safe
failure/cancellation log events.

RPC validation was tightened at the same time: JSON-RPC version and request IDs
must match, requested block headers must return the requested number, hashes and
topics must have exact byte widths, log data must contain complete bytes,
`removed` must be boolean, and numeric indexes must remain safe integers. URL
redaction now removes non-root paths as well as credentials/query strings so
provider keys embedded in paths cannot leak into errors or observability.

## 8. Immediate Next Action

The code and release verification are complete for an immutable GitHub commit.
Before publishing a semantic release tag, obtain an explicit license decision,
commit the matching `LICENSE` and package metadata, rerun the final GitHub
consumer against that pushed commit, and obtain explicit approval for tag
creation. Do not publish to npm.

## 9. Risks and Unknowns

### 9.1 Package module format

Resolved: the package is ESM-only and requires Node.js 22 or newer.

### 9.2 Git install preparation lifecycle

Resolved locally and remotely: pnpm installed exact clean Git commits, installed
build dependencies, ran `prepare`, generated runtime/declaration output, and
passed consumer type/runtime/SQLite checks. The GitHub-hosted verification used
full commit `7eb95d90bae26f229329fcc0c483dcce43fad08a`. `dist/` remains uncommitted.

### 9.3 Native SQLite dependency

Resolved for exact clean Git installs on the current Linux environment with
Node.js `24.2.0` and the supported minimum Node.js `22.23.1`.
macOS, Windows, and other CPU architectures still need release-matrix
verification when those environments are available.

### 9.4 Exact dependency versions

Resolved for the initial implementation: versions are pinned in `package.json`
and `pnpm-lock.yaml`; review them again before a release tag.

### 9.5 Confirmation defaults

The documented default of 12 confirmations is general-purpose, not universal
finality. Keep it configurable and make chain-specific responsibility explicit.

### 9.6 SQLite URL parsing

The documented relative and absolute URL forms need explicit cross-platform
parser tests. Windows path behavior is not yet specified.

### 9.7 Checkpoint granularity

Checkpoints exist at committed range boundaries. A reorg can cause rewinding
more already-valid blocks than strictly necessary when ranges are large. This is
safe but may cost extra RPC work. Do not add per-block checkpoints without
measuring the storage/performance tradeoff.

### 9.8 Indexed dynamic values

Dynamic indexed Solidity values are stored on-chain as hashes. V1 queries them
by topic hash. Original preimages cannot be reconstructed from the log alone.

### 9.9 ABI upgrades

New ABIs are versioned for future logs. Automatic historical re-decoding is not
part of V1. Proxy upgrade workflows may require a future explicit re-decode
operation.

### 9.10 Live test sample

Resolved: the gated sample is Base mainnet chain `8453`, USDC contract
`0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, block `48625053`. It produced
76 contract logs and 57 Transfer events when verified on 2026-07-14. The public
RPC may rate limit future runs, so the URL remains configurable.

### 9.11 Close during update

Resolved: `close` aborts and waits for the active update cleanup before closing
storage; the update caller receives the cancellation error.

### 9.12 Real PostgreSQL runtime

Resolved: PostgreSQL 18.4 accepted the provided credentialed connection, and the
six shared storage contracts plus three shared query contracts passed. The
gated test created a unique schema for every case and dropped each schema with
`CASCADE`; a post-test inspection found zero matching schemas. The connection
URL is supplied only through `EVM_EVENT_LAKE_POSTGRESQL_TEST_URL` and is not
stored in the repository.

### 9.13 Public license

Still pending before a public release. The repository has no `LICENSE` file and
`package.json` has no `license` field. Do not invent a license on the user's
behalf; obtain an explicit license choice, then keep the file and package
metadata aligned.

## 10. Verification Already Performed

- `pnpm run verify` passed with 63 tests passing and two gated tests skipped.
- The explicitly enabled Base USDC live RPC test passed after strict JSON-RPC,
  block-header, hash/topic, data, flag, and index validation was added.
- `pnpm run test:integration` passed all local integration files.
- `pnpm run test:git-install` passed from exact clean commit `1968a18`, including
  `prepare`, TypeScript declarations, public runtime imports, SQLite native
  usage, synchronization, failover/splitting, queries, pagination, offline
  reads, observability, and lifecycle checks.
- The same exact Git consumer passed under Node.js `22.23.1`, including a fresh
  `better-sqlite3` installation for that runtime.
- `pnpm run test:github-install` passed using GitHub-hosted full commit
  `7eb95d90bae26f229329fcc0c483dcce43fad08a`.
- `pnpm run test:storage:postgresql:real` passed all nine storage/query contracts
  against PostgreSQL 18.4, and cleanup left zero temporary schemas.
- Runtime dependency audit through npm's current advisory endpoint reported
  zero vulnerabilities. pnpm's legacy audit endpoint returned HTTP 410 and was
  not used as evidence.
- Required Step 1 and Step 2 documents exist in `docs/`.
- Root `Agent.md` exists as the repository operating guide.
- Official documentation links were reviewed on 2026-07-14 and 2026-07-15; the
  newly added Base, Circle, and Node test-runner documentation links were used.
- Phases 1 through 11 were committed incrementally.
- `main` was pushed through commit `7eb95d9`; no semantic version tag exists.

## 11. Do Not Do Next

- Do not publish to npm.
- Do not push commits or tags without approval.
- Do not start a scheduler, daemon, server, or WebSocket layer.
- Do not add recent-block or analytics shortcuts to the SDK core.
- Do not let queries depend on RPC availability.
- Do not skip an unfetchable block or advance a partial cursor.
- Do not copy the related Rust service's server architecture into this package.
- Do not add new module directories without first documenting their boundary.
