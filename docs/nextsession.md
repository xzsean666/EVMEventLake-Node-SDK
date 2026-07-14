# Next Session Handoff

Last updated: 2026-07-14

## 1. Current Status

Steps 1 through 3 of the repository workflow are complete and Step 4 is active:

- Step 1: Architecture design completed and committed.
- Step 2: Product, build, external documentation, and agent rules completed and
  committed.
- Step 3: This context handoff completed.
- Step 4: Approved on 2026-07-14; Phase 1 completed.

The repository now contains an ESM package foundation, pinned dependencies,
strict TypeScript and ESLint configuration, public errors, observability
contracts, configuration validation, and initial unit tests. Storage, RPC,
synchronization, query, integration, and release phases remain pending.

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
- Configuration and planned defaults.
- SQLite/PostgreSQL parity requirements.
- ABI and raw-log preservation behavior.
- Query/result/error contracts.
- Acceptance criteria.

### Build and usage

`docs/BUILD.md` defines:

- Planned Node.js/TypeScript/pnpm toolchain.
- GitHub tag/commit installation.
- No npm registry publication.
- Planned Git-install build and consumer smoke tests.
- SQLite and PostgreSQL setup.
- Usage examples, including caller-owned update loops and recent-block logic.
- Planned test and release workflow.

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
16. Planned package name is `@evm-event-lake/node-sdk`.
17. Planned core libraries are viem, Kysely, better-sqlite3, `pg`, and Vitest,
    subject to current-version verification in Step 4.
18. No generic `utils`, `common`, or service-locator module.

## 7. Step 4 Implementation Progress

Follow this order. Each item must compile and pass focused tests before the next
item begins.

### Phase 1 — Package foundation — completed

Completed with ESM-only output, Node.js 22+ support, pinned dependencies,
registry publication disabled, public error/observability exports, normalized
configuration, URL redaction, 8 unit tests, and a passing build.

### Phase 2 — Target and ABI

1. Implement chain/contract target normalization and stable identity.
2. Implement ABI canonicalization and fingerprinting.
3. Build the immutable event catalog.
4. Implement decode outcomes and lossless value codec.
5. Unit-test overloaded, anonymous, unknown, malformed, tuple, array, and bigint
   cases.

### Phase 3 — Storage contract and SQLite

1. Define storage models and adapter interface.
2. Design forward migrations from the logical model.
3. Implement SQLite initialization, target metadata, ABI versions, event rows,
   parameter rows, checkpoints, cursor, leases, rewind, and queries.
4. Add the reusable storage contract test suite.
5. Verify atomic range commits, idempotency, and expired-lease recovery.

### Phase 4 — PostgreSQL

1. Implement the PostgreSQL adapter without leaking dialect types.
2. Run the same storage contract tests unchanged.
3. Verify concurrent different-target updates and same-target lease exclusion.
4. Document any operational PostgreSQL requirement.

### Phase 5 — RPC pool

1. Implement HTTP endpoint parsing and credential redaction.
2. Implement lazy chain ID validation before endpoint use.
3. Implement bounded request timeout, retry, cooldown, and selection.
4. Implement explicit RPC error classification.
5. Unit-test mismatched chain, 429, 5xx, transport, timeout, invalid response,
   range limit, and response-size cases.

### Phase 6 — Synchronization engine

1. Implement inclusive range planning.
2. Implement adaptive log fetching with a minimum range and timeout split
   budget.
3. Implement deterministic log validation, ordering, and deduplication.
4. Implement update orchestration and atomic progress.
5. Implement cancellation and lease renewal.
6. Test partial progress, restart/resume, failover, and unfetchable single-block
   behavior.

### Phase 7 — Reorg handling

1. Implement checkpoint hash lookup.
2. Implement newest-to-oldest matching checkpoint search.
3. Implement atomic rewind.
4. Test shallow reorg recovery and depth-exceeded failure.

### Phase 8 — Query API

1. Implement filter validation and ABI-aware indexed value normalization.
2. Implement deterministic ascending/descending ordering.
3. Implement versioned opaque cursor pagination.
4. Rehydrate lossless values into the documented public result.
5. Run query parity tests on SQLite and PostgreSQL with RPC disabled.

### Phase 9 — Integration and live verification

1. Add local end-to-end tests for create, update, resume, query, and close.
2. Select and document a stable real-chain contract and block sample.
3. Add opt-in live RPC tests with explicit environment gates.
4. Verify multiple endpoints and an intentional bad-endpoint failover path.

### Phase 10 — GitHub installation and release readiness

1. Finalize the Git-install preparation lifecycle.
2. Verify a clean temporary consumer installs an exact commit.
3. Verify TypeScript declarations and runtime imports from the installed
   dependency.
4. Verify SQLite smoke usage from the installed dependency.
5. Decide whether release tags need committed `dist/` based on actual package
   manager behavior.
6. Update all docs with exact versions and verified commands.
7. Do not push or publish a tag without explicit user approval.

## 8. Immediate Next Action

Continue with Phase 2: contract target identity, ABI catalog, decoding outcomes,
and lossless value codecs. Do not start storage until Phase 2 tests pass.

## 9. Risks and Unknowns

### 9.1 Package module format

Resolved: the package is ESM-only and requires Node.js 22 or newer.

### 9.2 Git install preparation lifecycle

The exact pnpm behavior must be tested from a clean Git reference. If build
dependencies or preparation scripts are unreliable for consumers, release tags
may need committed build output. Do not assume either path without the consumer
smoke test.

### 9.3 Native SQLite dependency

`better-sqlite3` is mature but includes native binaries/build concerns. Verify
supported Node.js versions, Linux/macOS targets, and Git dependency installation
before locking the release contract.

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

No live chain/contract/block sample has been selected for this Node SDK. The
related Rust project has a Base USDC precedent, but it must be revalidated before
reuse.

### 9.11 Close during update

The specification requires safe behavior but leaves one implementation choice:
cancel active update or reject close until update completes. Decide and document
the exact contract before implementing the client façade.

## 10. Verification Already Performed

- `git diff --check` passed for Steps 1 and 2.
- Required Step 1 and Step 2 documents exist in `docs/`.
- Root `Agent.md` exists as the repository operating guide.
- All URLs in `docs/EXTERNAL_DOCS.md` returned HTTP 200 on 2026-07-14.
- No package, source, migration, or test implementation was created.
- Step 1 and Step 2 were committed separately.
- No commit was pushed.

## 11. Do Not Do Next

- Do not publish to npm.
- Do not push commits or tags without approval.
- Do not start a scheduler, daemon, server, or WebSocket layer.
- Do not add recent-block or analytics shortcuts to the SDK core.
- Do not let queries depend on RPC availability.
- Do not skip an unfetchable block or advance a partial cursor.
- Do not copy the related Rust service's server architecture into this package.
- Do not create every planned directory before its implementation phase needs
  it.
