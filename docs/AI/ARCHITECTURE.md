# EVMEventLake Node SDK Architecture

Version: 1.0  
Status: Architecture implemented and verified; continuous optimization active  
Runtime: Node.js with TypeScript (ESM only, Node >=22)  
Package model: Embeddable library, not a service  
Distribution: Installed directly from GitHub; not published to the npm registry  
Storage: SQLite and PostgreSQL with strict contract parity  

---

## 1. Architecture Goal

EVMEventLake Node SDK has one product responsibility:

> Reliably copy event logs emitted by one EVM contract into a local database (IndexedDB, SQLite, PostgreSQL), maintain an incremental synchronization cursor, and expose a database-only query API, powered by `evm-call` as the resilient EVM RPC and log streaming foundation.

The SDK is designed for applications, cron jobs, workers, backends, and frontend dApps that want to control their own execution lifecycle. It does not own a scheduler, background loop, HTTP server, WebSocket connection, event listener, business search policy, analytics pipeline, or notification system.

The design optimizes for:

- **Foundational Resilience via `evm-call`**: Leverages `evm-call` for multi-node RPC pooling, stepped backoff cooldowns, automatic 10,000+ log adaptive chunking, and JSON-RPC batching.
- **Storage Portability**: Identical observable behavior and 100% contract parity across IndexedDB (browser), SQLite (local), and PostgreSQL (server).
- **Decoupled Architecture**: Strong separation between RPC ingestion, ABI decoding, durable storage, and caller-owned logic.
- **Offline Query Resilience**: Event queries operate exclusively against the local database, completely immune to RPC network failures.
- **Reproducible Git Distribution**: Direct GitHub installation without an npm registry release.

---

## 2. System Boundary

### 2.1 SDK responsibilities

The SDK owns:

- Validation and normalization of one chain and contract target.
- EVM RPC communication and resilient log streaming via `evm-call`.
- ABI event catalog creation, signature mapping, and event log decoding.
- Durable raw log, decoded event, metadata, checkpoint, and sync-state storage across SQLite, PostgreSQL, and IndexedDB.
- Target-scoped synchronization locking (leases).
- Reorg detection and bounded rewind.
- Database-only event queries and versioned opaque cursor pagination.
- Typed errors, update results, sync status, and structured observability logging.


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

One process may create multiple SDK instances, and multiple targets may share one database. Each instance still owns exactly one `chainId + contractAddress` target.

---

## 3. High-Level Architecture

```text
Caller-owned Application / Cron / Worker / Script / Frontend dApp
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
          v                    v
     ABI Catalog        Storage Contract
          |                    |
          |              +-----+----------------+
          |              |             |        |
          |              v             v        v
          |          IndexedDB       SQLite  PostgreSQL
          |          (Browser)    (Node/Server) (Node/Server)
          |
          v
=========================================================
      EVM Infrastructure Foundation: evm-call
  - Resilient RPC Pool (Multi-endpoint, Stepped Cooldown)
  - Adaptive Log Streaming (getLogsChunked, iterateLogs)
  - JSON-RPC Batch Executor & Multicall3 Reorg Assertions
=========================================================
          |
          v
    HTTP JSON-RPC (Ethereum, Base, Arbitrum, L2s...)
```

The public API is a façade. It coordinates explicit modules but delegates EVM RPC transport and log chunking to `evm-call`, persistence to `StorageAdapter`, and ABI decoding to the pure `abi` catalog.



---

## 4. Public API Boundary

| Operation | Responsibility | External I/O |
| --- | --- | --- |
| `create` | Validate options, build the ABI/RPC configuration, initialize storage, register target metadata | Database |
| `update` | Perform one finite incremental synchronization run | RPC and database |
| `getSyncStatus` | Return the durable local cursor and target metadata | Database only |
| `events.findMany` | Query persisted events with filters and pagination | Database only |
| `events.findFirst` | Return the first persisted event in deterministic order | Database only |
| `close` | Release owned database and transport resources | Local resources |

Initialization uses an asynchronous factory instead of an asynchronous constructor or hidden lazy initialization. Database schema initialization and target registration therefore happen at a visible lifecycle boundary. RPC chain validation happens inside the first explicit RPC operation for each endpoint, before that endpoint is allowed to serve synchronization data. This keeps database-only queries available while RPC providers are offline.

### 4.1 Distribution contract

The repository itself is the package distribution source. Consumers install a Git tag or full commit from GitHub through their Node package manager.

The package must therefore provide:

- A standard package manifest with explicit runtime, type, and export entries.
- A Git-install-compatible build lifecycle that produces consumable JavaScript and declaration files from a clean clone.
- A package-level guard that prevents accidental npm registry publication (`"private": true`).
- Semantically versioned Git tags for intended releases.
- Release verification from a temporary consumer project using the Git URL.

Production consumers should pin a semantic version tag or immutable commit. Depending directly on `main` is allowed for development only because it is not reproducible.

### 4.2 Required creation options

| Option | Meaning |
| --- | --- |
| `database` | Storage connection URL: SQLite (`sqlite:...`), PostgreSQL (`postgresql:...`), or IndexedDB (`idb://<name>` / `indexeddb://<name>`) |
| `rpcUrls` | Ordered list of HTTP JSON-RPC endpoints |
| `chainId` | Expected EVM chain identifier; every endpoint used for synchronization must match it |

| `contractAddress` | The single contract address owned by this instance |
| `abi` | Complete ABI used to build the event catalog |
| `startBlock` | First block eligible for synchronization, inclusive |

Optional policies remain centralized and typed. The initial public policy surface should stay small: confirmation count, logging/progress callbacks, and advanced RPC/synchronization settings only when defaults are insufficient.

### 4.3 Update options

| Option | Meaning |
| --- | --- |
| `toBlock` | Explicit inclusive synchronization boundary |
| `blockRange` | Preferred maximum number of blocks in one `eth_getLogs` request |
| `signal` | Caller-provided cancellation signal |

When `toBlock` is omitted, the synchronization engine resolves the current RPC head and subtracts the configured confirmation count. An explicit `toBlock` never bypasses target identity validation or transaction safety.

`blockRange` is a preferred maximum, not a promise that every RPC request uses that size. The adaptive fetcher may split it into smaller contiguous ranges.

### 4.4 Query filters

The query contract supports composable filters for:

- Inclusive block number range.
- Exact block number.
- Transaction hash.
- Event name.
- Exact event signature for overloaded event names.
- Exact indexed parameter values.
- Deterministic ascending or descending chain order.
- Limit and opaque cursor pagination.

Queries never contact RPC endpoints. For a caller-owned rule such as “recent 100 blocks”, the caller reads `syncedThroughBlock` from `getSyncStatus`, computes the desired lower block, and submits a normal block-range query.

---

## 5. Directory Structure

The layout intentionally avoids generic `core`, `common`, and `utils` folders. Every behavior belongs to a named responsibility.

```text
.
├── AGENTS.md
├── LICENSE
├── README.md
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── docs/
│   ├── AI/
│   │   ├── GOAL.md
│   │   ├── TASK_INDEX.md
│   │   ├── SESSION_STATE.md
│   │   ├── ARCHITECTURE.md
│   │   ├── DECISIONS.md
│   │   ├── CONTEXT_EVM_CALL.md
│   │   └── tasks/
│   │       ├── TASK-000.md
│   │       ├── TASK-001.md
│   │       └── ...
│   ├── SPEC.md
│   ├── BUILD.md
│   └── EXTERNAL_DOCS.md
├── example/
│   ├── package.json
│   ├── pnpm-workspace.yaml
│   ├── typecheck.ts
│   └── test/
│       └── github-installed-sdk.test.mjs
├── examples/
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
│   │   ├── storage-database-schema.ts
│   │   ├── sql-storage-adapter.ts
│   │   ├── sqlite/
│   │   ├── postgresql/
│   │   └── indexeddb/

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
    ├── real-postgresql/
    └── live-rpc/
```

---

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
- `configuration`, `contract-target`, `rpc`, `abi`, `synchronization`, `storage`, `query`, `observability`, `errors`.

### 6.2 `configuration`

Purpose:
- Define and validate all public options and policy defaults.
- Parse database URLs and reject unsupported schemes.
- Prevent environment reads or configuration logic from spreading across the package.

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

### 6.4 `rpc` (powered by `evm-call`)

Purpose:
- Coordinate all EVM JSON-RPC communication through the underlying `evm-call` foundation SDK (`https://github.com/xzsean666/evm-call`).
- Leverage `evm-call`'s resilient `EvmRpcPool` for multi-endpoint rotation, stepped backoff cooldowns (1m ~ 24h), and fast recovery.
- Delegate log range chunking and adaptive splitting to `evm-call`'s `getLogsChunked` and `iterateLogs` streaming iterators.
- Utilize `evm-call`'s JSON-RPC batch executor and Multicall3 assertions for chain reorg protection.

Input:
- RPC URLs and policy.
- Chain ID.
- Block-number, block-header, and log requests.

Output:
- Validated block numbers, block headers, and raw logs (`EvmLog`).
- Classified RPC failures with endpoint context.

Dependencies:
- `evm-call` (`"evm-call": "github:xzsean666/evm-call"`).
- `configuration`, `errors`.

The RPC layer delegates low-level HTTP transport, retry budgeting, and adaptive size splitting to `evm-call`. Endpoint state changes strictly as a result of explicit SDK operations or `evm-call` pool health events. An endpoint that has not passed chain ID validation is never eligible to return a block head, header, or event logs.


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
- ABI parsing and decoding library (`viem`).
- `errors`.

The ABI module is pure after catalog creation. It does not contact RPC or the database.

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
- `rpc`, `abi`, `storage`, `observability`, `errors`.

Submodule boundaries are explicit:
- `update-service` owns orchestration only.
- `synchronization-range-planner` creates ordered inclusive ranges.
- `adaptive-log-fetcher` resolves one preferred range into fetchable subranges.
- `chain-consistency-checker` validates checkpoints and chooses a rewind point.

### 6.7 `storage`

Purpose:
- Define one database-independent storage contract (`StorageAdapter`).
- Own schema migration/store creation, transactions, idempotency, locking, and persistence.
- Provide IndexedDB (browser), SQLite, and PostgreSQL adapters with 100% contract parity.

Input:
- Target metadata and ABI versions.
- Raw and decoded logs.
- Sync checkpoints and lease operations.
- Normalized event queries.

Output:
- Durable target state.
- Atomic commit outcomes.
- Query rows in a storage-neutral model.

Dependencies:
- `kysely` query builder (for SQL storage).
- Browser `indexedDB` native API (for browser IndexedDB adapter).
- SQLite driver (`better-sqlite3`) in SQLite adapter only (dynamically loaded).
- PostgreSQL driver (`pg`) in PostgreSQL adapter only (dynamically loaded).

No adapter-specific type may escape the storage boundary. IndexedDB, SQLite, and PostgreSQL adapters must all pass the same storage contract test suite. Shared SQL behavior is composed through `sql-storage-adapter`; SQLite and PostgreSQL entry modules own driver construction and dialect-specific runtime settings. The IndexedDB adapter operates directly over native browser ObjectStores with atomic transaction guarantees.


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
- `abi`, `storage`, `errors`.

The query module never imports the RPC module.

### 6.9 `observability`

Purpose:
- Define optional structured logger and progress callback contracts.
- Report endpoint changes, range splits, committed ranges, rewinds, and summary statistics without hard-coding a logging framework.

Input:
- Structured events emitted by explicit SDK operations.

Output:
- Caller-visible callbacks when configured.

Dependencies:
- None beyond public event types.

### 6.10 `errors`

Purpose:
- Define the stable public error taxonomy.
- Preserve machine-readable cause, operation, target, endpoint, and committed cursor context.

Input:
- Validation, RPC, decoding, storage, locking, reorg, and cancellation failures.

Output:
- Typed SDK errors with non-secret diagnostic metadata.

Dependencies:
- None.

Errors must not expose database passwords or full credential-bearing RPC URLs.

---

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

The preferred `blockRange` is split only when necessary. Splitting is iterative or queue-based rather than recursive control flow hidden across modules.

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

The SDK cannot promise completion when every endpoint is unavailable or no endpoint can return a dense single block. It does promise never to report or checkpoint an unfetched range as complete.

### 7.3 Ordering and deduplication

Fetched logs are normalized and ordered by:
1. Block number.
2. Transaction index.
3. Log index.

The durable uniqueness identity includes chain, contract, block hash, transaction hash, and log index. Replaying a committed range is safe.

---

## 8. Chain Reorganization Strategy

Reliability requires more than remembering the last block number.

The strategy combines:
- A configurable confirmation distance when `toBlock` is not explicit.
- A stored block hash checkpoint at each committed range boundary.
- Validation of the latest checkpoint before advancing.
- Bounded rewind to the latest matching checkpoint on a hash mismatch.

Rewind removes event rows and checkpoints after the selected matching block in one storage transaction, then resets `nextBlock`. If no matching checkpoint is found inside the configured validation depth, update stops with a reorg-depth-exceeded error instead of silently corrupting history.

An explicit `toBlock` gives the caller control over the boundary, but does not disable checkpoint validation.

---

## 9. Storage Model

The logical model is shared by SQLite and PostgreSQL. Physical SQL types and index syntax may differ inside adapters.

### 9.1 `lake_targets`
Stores target key, chain ID, normalized contract address, start block, next block, current ABI fingerprint, and timestamps.

### 9.2 `abi_versions`
Stores target key, ABI fingerprint, canonical ABI JSON, and registration timestamp.

### 9.3 `event_logs`
Stores lossless chain identity and payload fields: target key, ABI fingerprint, block number, block hash, transaction hash, transaction index, log index, contract address, topics, data, event name/signature, canonical decoded arguments, and decode status (`decoded`, `unknown`, `decode_failed`).

### 9.4 `event_parameters`
Stores queryable decoded parameter rows: parameter name, ABI position, Solidity type, indexed flag, canonical comparable value, and raw topic value.

### 9.5 `sync_checkpoints`
Stores target key, committed range end block, end block hash, and commit timestamp.

### 9.6 `sync_leases`
Stores target-scoped lease owner token and expiration timestamp to prevent concurrent execution races.

### 9.7 `schema_migrations`
Tracks forward-only database schema version migrations.

---

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

Query behavior is intentionally limited to persisted facts. There is no hidden RPC fallback, automatic head lookup, or caller-specific interpretation.

---

## 11. Storage Portability & Parity Rules
- Public behavior is defined by the `StorageAdapter` contract, not by SQL or NoSQL implementation details.
- Every SQL query is parameterized; IndexedDB queries use explicit key ranges and indexes.
- Adapter-specific implementation remains isolated inside its adapter directory (`sqlite/`, `postgresql/`, `indexeddb/`).
- One shared storage contract test suite runs against all three adapters (SQLite, PostgreSQL, and IndexedDB via `fake-indexeddb`).
- SQLite is optimized for single-process local servers/CLIs; PostgreSQL is the choice for concurrent server workloads; IndexedDB is the native storage engine for frontend browser web applications.

### 11.1 Audit Hardening, Batch Chunking & Performance Protections
- **SQL Variable Chunking**: SQLite enforces a strict ceiling of 32,766 query variables (`SQLITE_MAX_VARIABLE_NUMBER`). Committing dense block intervals containing 2,000+ logs with parameters exceeds this limit if inserted in a single statement. `SqlStorageAdapter` chunks inserts and deletes into atomic batches (`BULK_LOGS_CHUNK_SIZE = 500`, `BULK_PARAMETERS_CHUNK_SIZE = 1000`, `BULK_IN_CHUNK_SIZE = 1000`) executing within the same transactional boundary.
- **Proxy Contract Redecode Synchronization**: When `lake.redecode({ abi })` upgrades the catalog, both `EventQueryService` and `UpdateService` receive the merged `EventCatalog`. Subsequent `lake.update()` executions decode new contract events rather than marking them as `"unknown"`.
- **Isomorphic Runtime Portability**: The client runtime is completely decoupled from Node.js-specific globals (`Buffer`, `node:crypto`). Pagination cursor codecs use pure Web standard `TextEncoder`/`TextDecoder` and `btoa`/`atob`; HTTP stream readers accumulate `Uint8Array` buffers directly; UUIDs utilize `globalThis.crypto.randomUUID` with a fallback generator.
- **IndexedDB $O(1)$ Keyset Pagination**: Instead of opening cursor scans at block 0 and stepping linearly via JavaScript `cursor.continue()`, `IndexeddbStorageAdapter.queryEvents` derives the exact lower/upper boundary on the composite index `by_chain_order` (`[targetKey, blockNumberKey, transactionIndex, logIndex, eventId]`) directly from `input.after`, ensuring constant-time index positioning.
- **RPC Batch Resilience & Multi-Endpoint Independence**: HTTP 413, 422, and payload limit responses are classified as batch rejections rather than connection fatalities, disabling batching for the endpoint while allowing sequential pipelining to succeed. Range-end block headers pass `excludeEndpointIdentity: fetchedRange.endpointIdentity` to prevent a single forked node from self-validating its own block logs.
- **Orphaned / Reorged Log Ingestion Filtering**: Logs with `removed: true` are filtered out during ingestion normalization and excluded from query results across all storage engines.



---

## 12. Mature-Project Lessons Applied

- **evm-call**: Serves as the core EVM communication base. It provides stepped backoff cooldowns, automatic 10,000+ log chunking, fast recovery, and Multicall3 reorg assertions, allowing EVMEventLake to avoid duplicating raw RPC pool plumbing.
- **viem & ethers**: Demonstrate mature ABI/event parsing and encoding primitives. This SDK composes such primitives for deterministic event catalogs.
- **Provider documentation**: Warns that log queries can be limited by block span or result size. This SDK treats adaptive splitting as core behavior, powered by `evm-call`.
- **Ponder & indexers**: Separate chain ingestion from application-specific event handling. This SDK keeps the same boundary while remaining an embedded, one-shot library rather than a long-running indexing framework.
- **Mature SQL libraries**: Isolate dialect differences. This SDK makes that isolation testable through one storage adapter contract.

Official documentation links and their verification dates are maintained in `docs/EXTERNAL_DOCS.md`.


---

## 13. Architecture Invariants

Future work must preserve these rules:

- No scheduler, worker loop, WebSocket, or HTTP server inside the SDK.
- No query path may import or call RPC code.
- No cursor advances without an atomic durable range commit.
- No failed or partially fetched range is marked complete.
- No RPC endpoint is trusted before chain ID validation.
- No database adapter leaks dialect-specific types into public results.
- No business definition of “recent”, “important”, or “actionable” belongs in the SDK.
- No hidden global state or implicit dependency injection.
- No module may become a general-purpose business logic container.
- No npm registry publishing workflow may be introduced without a new explicit user decision.
- No release is complete until installation from its Git tag works in a clean consumer project.
