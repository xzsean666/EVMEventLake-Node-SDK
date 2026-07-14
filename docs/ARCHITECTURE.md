# EVMEventLake Node SDK Architecture

Version: 1.0

Status: Architecture baseline; implementation underway

Runtime: Node.js with TypeScript

Package model: Embeddable library, not a service

Distribution: Installed directly from GitHub; not published to the npm registry

Storage: SQLite and PostgreSQL

## 1. Architecture Goal

EVMEventLake Node SDK has one product responsibility:

> Reliably copy event logs emitted by one EVM contract into a local SQL
> database, maintain an incremental synchronization cursor, and expose a
> database-only query API.

The SDK is designed for applications, cron jobs, workers, backends, and scripts
that want to control their own execution lifecycle. It does not own a scheduler,
background loop, HTTP server, WebSocket connection, event listener, business
search policy, analytics pipeline, or notification system.

The design optimizes for:

- Strong separation between synchronization, storage, and caller-owned logic.
- A small, explicit public API.
- Reliable recovery after RPC errors, process interruption, and chain reorgs.
- Identical observable behavior across SQLite and PostgreSQL.
- Modules that an AI can understand and change in isolation.
- Incremental implementation in testable phases.
- Reproducible Git tag or commit installation without an npm registry release.

## 2. System Boundary

### 2.1 SDK responsibilities

The SDK owns:

- Validation and normalization of one chain and contract target.
- HTTP JSON-RPC endpoint selection, retry, cooldown, and failover.
- `eth_getLogs` range planning and adaptive range splitting.
- ABI event catalog creation and event log decoding.
- Durable raw log, decoded event, metadata, checkpoint, and sync-state storage.
- Target-scoped synchronization locking.
- Reorg detection and bounded rewind.
- Database-only event queries.
- Typed errors, update results, sync status, and optional progress reporting.

### 2.2 Caller responsibilities

The caller owns:

- When and how often `update` is called.
- Cron, worker, queue, process supervision, and retry scheduling.
- Business definitions such as “recent N blocks” or “events since yesterday”.
- Data analysis, aggregation, alerting, message delivery, and downstream writes.
- Choosing chain-appropriate confirmation and RPC policies.
- Managing secrets and production database infrastructure.

### 2.3 Explicit non-goals

The SDK will not provide:

- A daemon or continuously running synchronization mode.
- Automatic polling timers.
- WebSocket subscriptions or live event listeners.
- A REST, GraphQL, or admin API.
- Arbitrary SQL execution through the public API.
- Business-specific repositories or domain models.
- Event aggregation, analytics, or derived views.
- Multi-contract synchronization inside one SDK instance.
- Publishing the package to the public npm registry.

One process may create multiple SDK instances, and multiple targets may share
one database. Each instance still owns exactly one `chainId + contractAddress`
target.

## 3. High-Level Architecture

```text
Caller-owned Application / Cron / Worker / Script
                    |
                    | explicit create, update, query, close
                    v
            EVMEventLake Public API
                    |
          +---------+----------+
          |                    |
          v                    v
  Synchronization Engine   Query Service
          |                    |
    +-----+------+             |
    |            |             |
    v            v             v
 RPC Pool     ABI Catalog   Storage Contract
    |            |             |
    v            |       +-----+------+
HTTP JSON-RPC    |       |            |
                 +------>v            v
                       SQLite     PostgreSQL
```

The public API is a façade. It coordinates explicit modules but does not contain
RPC, decoding, persistence, or query logic itself.

## 4. Public API Boundary

The exact TypeScript declarations belong to the implementation phase. The
architecture requires the following conceptual surface:

| Operation | Responsibility | External I/O |
| --- | --- | --- |
| `create` | Validate options, build the ABI/RPC configuration, initialize storage, register target metadata | Database |
| `update` | Perform one finite incremental synchronization run | RPC and database |
| `getSyncStatus` | Return the durable local cursor and target metadata | Database only |
| `events.findMany` | Query persisted events with filters and pagination | Database only |
| `events.findFirst` | Return the first persisted event in deterministic order | Database only |
| `close` | Release owned database and transport resources | Local resources |

Initialization uses an asynchronous factory instead of an asynchronous
constructor or hidden lazy initialization. Database schema initialization and
target registration therefore happen at a visible lifecycle boundary. RPC
chain validation happens inside the first explicit RPC operation for each
endpoint, before that endpoint is allowed to serve synchronization data. This
keeps database-only queries available while RPC providers are offline.

### 4.1 Distribution contract

The repository itself is the package distribution source. Consumers install a
Git tag or full commit from GitHub through their Node package manager.

The package must therefore provide:

- A standard package manifest with explicit runtime, type, and export entries.
- A Git-install-compatible build lifecycle that produces consumable JavaScript
  and declaration files from a clean clone.
- A package-level guard that prevents accidental npm registry publication.
- Semantically versioned Git tags for intended releases.
- Release verification from a temporary consumer project using the Git URL.

Production consumers should pin a semantic version tag or immutable commit.
Depending directly on `main` is allowed for development only because it is not
reproducible.

### 4.2 Required creation options

| Option | Meaning |
| --- | --- |
| `database` | SQLite or PostgreSQL connection URL |
| `rpcUrls` | Ordered list of HTTP JSON-RPC endpoints |
| `chainId` | Expected EVM chain identifier; every endpoint used for synchronization must match it |
| `contractAddress` | The single contract address owned by this instance |
| `abi` | Complete ABI used to build the event catalog |
| `startBlock` | First block eligible for synchronization, inclusive |

Optional policies remain centralized and typed. The initial public policy
surface should stay small: confirmation count, logging/progress callbacks, and
advanced RPC/synchronization settings only when defaults are insufficient.

### 4.3 Update options

| Option | Meaning |
| --- | --- |
| `toBlock` | Explicit inclusive synchronization boundary |
| `blockRange` | Preferred maximum number of blocks in one `eth_getLogs` request |
| `signal` | Caller-provided cancellation signal |

When `toBlock` is omitted, the synchronization engine resolves the current RPC
head and subtracts the configured confirmation count. An explicit `toBlock`
never bypasses target identity validation or transaction safety.

`blockRange` is a preferred maximum, not a promise that every RPC request uses
that size. The adaptive fetcher may split it into smaller contiguous ranges.

### 4.4 Query filters

The first query contract supports composable filters for:

- Inclusive block number range.
- Exact block number.
- Transaction hash.
- Event name.
- Exact event signature for overloaded event names.
- Exact indexed parameter values.
- Deterministic ascending or descending chain order.
- Limit and opaque cursor pagination.

Queries never contact RPC endpoints. For a caller-owned rule such as “recent
100 blocks”, the caller reads `syncedThroughBlock` from `getSyncStatus`, computes
the desired lower block, and submits a normal block-range query.

## 5. Recommended Directory Structure

The layout intentionally avoids generic `core`, `common`, and `utils` folders.
Every behavior belongs to a named responsibility.

```text
.
├── Agent.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── docs/
│   ├── ARCHITECTURE.md
│   ├── SPEC.md
│   ├── BUILD.md
│   ├── EXTERNAL_DOCS.md
│   └── nextsession.md
├── src/
│   ├── index.ts
│   ├── client/
│   │   └── evm-event-lake.ts
│   ├── configuration/
│   │   ├── sdk-options.ts
│   │   └── validate-sdk-options.ts
│   ├── contract-target/
│   │   ├── contract-target.ts
│   │   └── target-identity.ts
│   ├── rpc/
│   │   ├── rpc-pool.ts
│   │   ├── rpc-endpoint.ts
│   │   ├── rpc-error-classifier.ts
│   │   └── evm-rpc-client.ts
│   ├── abi/
│   │   ├── event-catalog.ts
│   │   ├── event-decoder.ts
│   │   └── decoded-value-codec.ts
│   ├── synchronization/
│   │   ├── update-service.ts
│   │   ├── synchronization-range-planner.ts
│   │   ├── adaptive-log-fetcher.ts
│   │   ├── chain-consistency-checker.ts
│   │   └── synchronization-result.ts
│   ├── storage/
│   │   ├── storage-adapter.ts
│   │   ├── storage-models.ts
│   │   ├── sqlite/
│   │   └── postgresql/
│   ├── query/
│   │   ├── event-query-service.ts
│   │   ├── event-query.ts
│   │   └── query-cursor.ts
│   ├── observability/
│   │   ├── sdk-logger.ts
│   │   └── update-progress.ts
│   └── errors/
│       └── evm-event-lake-errors.ts
└── tests/
    ├── unit/
    ├── storage-contract/
    ├── integration/
    └── live-rpc/
```

This is a responsibility map, not permission to create every file immediately.
Implementation must add modules incrementally as their phase begins.

## 6. Module Definitions

### 6.1 `client`

Purpose:

- Provide the only primary user-facing façade.
- Make lifecycle operations explicit.
- Delegate work without containing domain logic.

Input:

- Validated creation options.
- Update and query requests.

Output:

- Update results.
- Sync status.
- Query results.
- Typed public errors.

Dependencies:

- `configuration`
- `contract-target`
- `rpc`
- `abi`
- `synchronization`
- `storage`
- `query`
- `observability`

### 6.2 `configuration`

Purpose:

- Define and validate all public options and policy defaults.
- Parse database URLs and reject unsupported schemes.
- Prevent environment reads or configuration logic from spreading across the
  package.

Input:

- Raw SDK creation options.
- Raw update options.

Output:

- Immutable normalized configuration objects.
- Clear validation errors.

Dependencies:

- Public types.
- No RPC or storage implementation.

### 6.3 `contract-target`

Purpose:

- Represent the immutable identity of one synchronization target.
- Normalize chain ID and contract address.
- Derive the stable target key used by storage, locks, and checkpoints.

Input:

- Chain ID.
- Contract address.
- Start block.

Output:

- Normalized contract target.
- Stable target identity.

Dependencies:

- EVM address validation only.

### 6.4 `rpc`

Purpose:

- Own all HTTP JSON-RPC communication.
- Verify each endpoint's chain identity before its first synchronization use.
- Select endpoints, enforce timeouts, retry bounded failures, apply cooldowns,
  and fail over.
- Classify endpoint failures separately from range-size failures.

Input:

- RPC URLs and policy.
- Chain ID.
- Block-number, block-header, and log requests.

Output:

- Validated block numbers, block headers, and raw logs.
- Classified RPC failures with endpoint context.

Dependencies:

- HTTP EVM client library.
- `configuration`
- `errors`

The RPC pool contains no background health checker. Endpoint state changes only
as a result of explicit SDK operations. An endpoint that has not passed chain ID
validation is never eligible to return a block head, header, or event logs.

### 6.5 `abi`

Purpose:

- Extract all event definitions from the supplied ABI.
- Map event signatures and topic zero values to event definitions.
- Decode matching logs and preserve unknown logs without data loss.
- Convert decoded values to and from a lossless database representation.

Input:

- Complete ABI.
- Raw EVM event log.

Output:

- Immutable event catalog and ABI fingerprint.
- Decoded event name, signature, and arguments when a match exists.
- Explicit unknown-event result when no ABI event matches.

Dependencies:

- ABI parsing and decoding library.
- `errors`

The ABI module is pure after catalog creation. It does not contact RPC or the
database.

### 6.6 `synchronization`

Purpose:

- Coordinate one finite `update` call.
- Resolve the next contiguous block interval from durable state.
- Plan preferred ranges and adaptively split failed `eth_getLogs` requests.
- Validate chain continuity, decode logs, and commit progress.
- Stop safely on cancellation or unrecoverable failure.

Input:

- Target identity.
- Update options.
- Current durable sync state.
- RPC log and block responses.

Output:

- Atomic committed ranges.
- Updated durable cursor and checkpoints.
- Update statistics and structured errors.

Dependencies:

- `rpc`
- `abi`
- `storage`
- `observability`
- `errors`

Submodule boundaries are explicit:

- `update-service` owns orchestration only.
- `synchronization-range-planner` creates ordered inclusive ranges.
- `adaptive-log-fetcher` resolves one preferred range into fetchable subranges.
- `chain-consistency-checker` validates checkpoints and chooses a rewind point.

### 6.7 `storage`

Purpose:

- Define one database-independent storage contract.
- Own schema migration, transactions, idempotency, locking, and persistence.
- Provide SQLite and PostgreSQL adapters with the same contract behavior.

Input:

- Target metadata and ABI versions.
- Raw and decoded logs.
- Sync checkpoints and lease operations.
- Normalized event queries.

Output:

- Durable target state.
- Atomic commit outcomes.
- Query rows in a dialect-neutral model.

Dependencies:

- SQL query builder or explicit SQL abstraction.
- SQLite driver in the SQLite adapter only.
- PostgreSQL driver in the PostgreSQL adapter only.

No adapter-specific type may escape the storage boundary. Both adapters must
pass the same storage contract test suite.

### 6.8 `query`

Purpose:

- Validate public query filters.
- Normalize addresses, hashes, event signatures, and indexed values.
- Build a database-independent query request.
- Rehydrate persisted decoded values into stable JavaScript values.

Input:

- Public event query.
- Event catalog metadata.

Output:

- Deterministically ordered event records.
- Opaque pagination cursor.

Dependencies:

- `abi`
- `storage`
- `errors`

The query module never imports the RPC module.

### 6.9 `observability`

Purpose:

- Define optional structured logger and progress callback contracts.
- Report endpoint changes, range splits, committed ranges, rewinds, and summary
  statistics without hard-coding a logging framework.

Input:

- Structured events emitted by explicit SDK operations.

Output:

- Caller-visible callbacks when configured.

Dependencies:

- None beyond public event types.

Logging is opt-in or safely silent by default. Observability callbacks must not
change synchronization behavior.

### 6.10 `errors`

Purpose:

- Define the stable public error taxonomy.
- Preserve machine-readable cause, operation, target, endpoint, and committed
  cursor context.

Input:

- Validation, RPC, decoding, storage, locking, reorg, and cancellation failures.

Output:

- Typed SDK errors with non-secret diagnostic metadata.

Dependencies:

- None.

Errors must not expose database passwords or full credential-bearing RPC URLs.

## 7. Synchronization Data Flow

```text
Caller calls update once
        |
        v
Acquire target-scoped synchronization lease
        |
        v
Validate an RPC endpoint against the configured chain ID
        |
        v
Load target metadata, cursor, and recent checkpoints
        |
        v
Validate last committed checkpoint against the chain
        |
        +---- mismatch ----> find last matching checkpoint
        |                         |
        |                         v
        |                    atomically rewind
        v
Resolve inclusive target boundary
        |
        v
Plan ordered preferred ranges
        |
        v
Fetch one range through RPC pool
        |
        +---- range/size failure ----> split range and retry children
        |
        +---- endpoint failure ------> bounded retry, cooldown, failover
        |
        v
Sort and deduplicate raw logs
        |
        v
Decode known ABI events; retain unknown raw logs
        |
        v
Atomically write logs + parameters + checkpoint + next cursor
        |
        +---- more ranges ----> repeat
        |
        v
Release lease and return finite update result
```

### 7.1 Cursor semantics

- `startBlock` is inclusive.
- `nextBlock` is the first block not yet durably committed.
- `syncedThroughBlock` is `nextBlock - 1` after at least one commit.
- `toBlock` is inclusive.
- A range is complete only when every block in it has been fetched successfully.
- Logs and the cursor for a contiguous range commit in the same transaction.
- A later range failure does not erase earlier committed ranges.
- Resuming starts from the durable `nextBlock`, making update idempotent.

### 7.2 Adaptive range handling

The preferred `blockRange` is split only when necessary. Splitting is iterative
or queue-based rather than recursive control flow hidden across modules.

Failure classes have different behavior:

| Failure class | Required behavior |
| --- | --- |
| Provider range or response-size limit | Split the range on the same endpoint |
| First timeout while range is larger than minimum | Split first; avoid prematurely declaring the endpoint dead |
| Repeated timeout after the per-range split budget | Fail over instead of splitting an entire interval into slow timeouts |
| HTTP rate limit or temporary server failure | Apply bounded retry/cooldown, then fail over |
| Transport or connection failure | Fail over and mark endpoint temporarily unavailable |
| Chain ID mismatch or invalid protocol response | Reject or disable that endpoint for the instance |
| Single-block failure across every endpoint | Throw a structured error and do not advance that block |

The SDK cannot promise completion when every endpoint is unavailable or no
endpoint can return a dense single block. It does promise never to report or
checkpoint an unfetched range as complete.

### 7.3 Ordering and deduplication

Fetched logs are normalized and ordered by:

1. Block number.
2. Transaction index.
3. Log index.

The durable uniqueness identity includes chain, contract, block hash,
transaction hash, and log index. Replaying a committed range is safe.

## 8. Chain Reorganization Strategy

Reliability requires more than remembering the last block number.

The initial strategy combines:

- A configurable confirmation distance when `toBlock` is not explicit.
- A stored block hash checkpoint at each committed range boundary.
- Validation of the latest checkpoint before advancing.
- Bounded rewind to the latest matching checkpoint on a hash mismatch.

Rewind removes event rows and checkpoints after the selected matching block in
one storage transaction, then resets `nextBlock`. If no matching checkpoint is
found inside the configured validation depth, update stops with a
reorg-depth-exceeded error instead of silently corrupting history.

An explicit `toBlock` gives the caller control over the boundary, but does not
disable checkpoint validation.

## 9. Storage Model

The logical model is shared by SQLite and PostgreSQL. Physical SQL types and
index syntax may differ inside adapters.

### 9.1 `lake_targets`

Stores:

- Target key.
- Chain ID and normalized contract address.
- Start block and next block.
- Current ABI fingerprint.
- Creation and update timestamps.

### 9.2 `abi_versions`

Stores:

- Target key.
- ABI fingerprint.
- Canonical ABI JSON.
- Registration timestamp.

An ABI change registers a new version. It does not silently rewrite historical
decoded rows. Historical re-decoding is a future explicit operation, not a side
effect of initialization.

### 9.3 `event_logs`

Stores lossless chain identity and payload fields:

- Target key and ABI fingerprint used for decoding.
- Block number and block hash.
- Transaction hash and transaction index.
- Log index.
- Contract address.
- Topics and data.
- Event name and full signature when decoded.
- Canonical decoded arguments.
- Decode status for known, unknown, or failed logs.

Unknown logs are retained because contracts can upgrade or the supplied ABI can
be incomplete.

### 9.4 `event_parameters`

Stores queryable decoded parameter rows:

- Event log identity.
- Parameter name and ABI position.
- Solidity type.
- Whether the parameter is indexed.
- Canonical comparable value.
- Raw topic value when applicable.

V1 indexed-parameter filtering is exact-match only. Dynamic indexed values that
EVM stores as hashes are queried by their topic hash unless a future explicit
preimage feature is added.

### 9.5 `sync_checkpoints`

Stores:

- Target key.
- Committed range end block.
- End block hash.
- Commit timestamp.

### 9.6 `sync_leases`

Stores a target-scoped owner token and expiration. It prevents overlapping
updates from separate processes using the same database. Lease acquisition,
renewal, release, and stale-lease recovery are storage responsibilities.

### 9.7 `schema_migrations`

Tracks SDK-owned schema versions. Migrations must be forward-only during normal
initialization and must never delete user data implicitly.

## 10. Query Data Flow

```text
Caller submits event query
        |
        v
Validate filter combinations and pagination
        |
        v
Normalize addresses, hashes, signatures, and indexed values
        |
        v
Storage adapter executes parameterized SQL
        |
        v
Rehydrate lossless decoded values
        |
        v
Return deterministic event records + next cursor
```

Query behavior is intentionally limited to persisted facts. There is no hidden
RPC fallback, automatic head lookup, or caller-specific interpretation.

## 11. Database Portability Rules

- Public behavior is defined by the storage contract, not by one SQL dialect.
- Every query is parameterized.
- Adapter-specific SQL remains inside its adapter directory.
- One shared storage contract test suite runs against both adapters.
- Event ordering, cursor encoding, duplicate handling, and transaction behavior
  must be identical across adapters.
- JSON storage is not used as the only index for indexed parameter queries.
- SQLite is optimized for a single local application; PostgreSQL is the choice
  for concurrent processes and larger shared workloads.

The initial implementation may use a typed SQL builder to reduce duplicate
query construction, but schema migration and dialect-specific behavior remain
visible and adapter-owned.

## 12. Key Design Decisions

### 12.1 One instance, one target

This keeps initialization, cursor ownership, update results, and errors locally
understandable. Multi-contract applications compose multiple instances rather
than configuring an internal subscription system.

### 12.2 Pull-based one-shot updates

The caller controls lifecycle and scheduling. The SDK is execution-stateless
between calls but intentionally keeps durable synchronization state in the
database.

### 12.3 Database-only query API

Query latency and behavior do not depend on RPC availability. Business windows,
analytics, and derived data stay outside the SDK.

### 12.4 Raw logs before decoded convenience

Raw topics and data are the source of truth. ABI decoding can evolve without
losing chain evidence, and unknown logs remain recoverable.

### 12.5 Custom RPC pool above a mature EVM client

A mature client library should provide transport, request, and ABI primitives.
The SDK still owns endpoint selection and error classification because adaptive
range splitting and target-specific failover are product behavior.

### 12.6 Storage contract with first-party adapters

SQLite and PostgreSQL are first-class, tested behaviors rather than a connection
string passed into scattered conditional logic.

### 12.7 Explicit async initialization

Schema setup and target registration are visible and awaitable during `create`.
RPC validation occurs only inside an explicit RPC operation such as `update`,
so database-only queries remain usable during provider outages.

### 12.8 Bounded reliability behavior

Retries, timeout-triggered range splits, failover, lease waits, and reorg rewinds
all have explicit bounds and typed terminal errors. The SDK must never loop
forever internally or spend an unbounded number of timeouts proving one endpoint
is unavailable.

### 12.9 No generic utility module

Normalization and codecs stay with the domain that owns them. A future helper
that does not have an obvious owner is a design signal, not a reason to create a
`utils` dumping ground.

### 12.10 GitHub is the package registry

The SDK keeps normal Node package metadata but does not rely on npm publishing.
Git tags define human-readable releases, commits provide immutable identities,
and the Git installation path is tested as part of release verification.

## 13. Mature-Project Lessons Applied

The architecture was checked against established EVM tooling patterns:

- viem and ethers demonstrate mature HTTP RPC and ABI/event primitives. This
  SDK composes such primitives instead of reimplementing Ethereum encoding.
- Provider documentation warns that log queries can be limited by block span or
  result size. This SDK therefore treats adaptive splitting as core behavior.
- Ponder and other indexers separate chain ingestion from application-specific
  event handling. This SDK keeps the same boundary while remaining an embedded,
  one-shot library rather than a long-running indexing framework.
- Mature SQL libraries isolate dialect differences. This SDK makes that
  isolation testable through one storage adapter contract.

Official documentation links and their verification dates are maintained in
`docs/EXTERNAL_DOCS.md` during Step 2.

## 14. Incremental Implementation Plan

Step 4 was approved on 2026-07-14. Continue implementation in this order:

1. Package skeleton, public types, configuration validation, and typed errors.
2. Contract target identity and ABI event catalog.
3. Storage contract plus SQLite adapter and storage contract tests.
4. PostgreSQL adapter running the same storage contract tests.
5. RPC client and endpoint pool with error-classification tests.
6. Range planner and adaptive log fetcher with deterministic unit tests.
7. Update service with transactional cursor progression and cancellation.
8. Chain checkpoint validation and bounded rewind.
9. Database-only query API and cursor pagination.
10. Local integration tests and opt-in live RPC tests.
11. Package build, examples, and release verification.

Each phase must compile and pass its focused tests before the next phase begins.

## 15. Architecture Invariants

Future work must preserve these rules:

- No implementation before explicit Step 4 approval.
- No scheduler, worker loop, WebSocket, or HTTP server inside the SDK.
- No query path may import or call RPC code.
- No cursor advances without an atomic durable range commit.
- No failed or partially fetched range is marked complete.
- No RPC endpoint is trusted before chain ID validation.
- No database adapter leaks dialect-specific types into public results.
- No business definition of “recent”, “important”, or “actionable” belongs in
  the SDK.
- No hidden global state or implicit dependency injection.
- No module may become a general-purpose business logic container.
- No npm registry publishing workflow may be introduced without a new explicit
  user decision.
- No release is complete until installation from its Git tag works in a clean
  consumer project.
