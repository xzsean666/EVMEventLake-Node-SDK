# EVMEventLake Node SDK Specification

Version: 1.0

Status: Core implementation complete; release verification underway

## 1. Product Summary

EVMEventLake Node SDK is a TypeScript library that incrementally indexes event
logs emitted by one EVM contract into SQLite or PostgreSQL.

The caller explicitly starts every synchronization run. The SDK performs one
finite update, stores durable progress, returns a structured result, and stops.
Persisted events are queried directly from the database without contacting RPC.

The SDK is distributed through GitHub Git references and is not published to
the npm registry.

## 2. Goals

The first production-capable version must:

1. Be installable from a GitHub tag or commit.
2. Support Node.js applications written in TypeScript or JavaScript.
3. Accept multiple HTTP JSON-RPC endpoints for one expected chain.
4. Index all logs emitted by one configured contract address.
5. Decode every matching event present in the supplied ABI.
6. Preserve raw logs that are unknown or cannot be decoded.
7. Synchronize incrementally from a configured inclusive start block.
8. Resume safely after normal completion, cancellation, failure, or restart.
9. Adapt to RPC block-range, response-size, timeout, and endpoint failures.
10. Store logs, ABI metadata, target metadata, checkpoints, and sync state.
11. Support SQLite and PostgreSQL with equivalent public behavior.
12. Query persisted logs by block, transaction, event, and indexed parameters.
13. Detect a changed recent chain and perform a bounded explicit rewind.
14. Prevent overlapping updates for the same target in the same database.
15. Remain usable for database-only queries while every RPC is offline.

## 3. Non-Goals

V1 must not include:

- Automatic polling or a long-running synchronization loop.
- Cron, queues, workers, or process supervision.
- WebSocket providers or live subscription APIs.
- A REST, GraphQL, gRPC, or administration server.
- Domain-specific filtering, analytics, alerts, or notifications.
- Automatic “recent N blocks” business queries.
- Multi-contract orchestration in one SDK instance.
- Arbitrary user SQL in the public API.
- Automatic ABI discovery from explorers.
- npm registry publication.

## 4. Terminology

| Term | Definition |
| --- | --- |
| Target | One normalized `chainId + contractAddress` pair |
| Instance | One SDK façade bound to exactly one target |
| Raw log | Lossless EVM log fields returned by `eth_getLogs` |
| Decoded event | A raw log matched to an ABI event with decoded arguments |
| Unknown log | A raw log that does not match an event in the active ABI |
| Decode-failed log | A raw log that appears to match but cannot be decoded safely |
| Start block | First block eligible for synchronization, inclusive |
| Next block | First block not durably committed |
| Synced-through block | Last block durably committed, equal to `nextBlock - 1` |
| Preferred range | Initial maximum interval requested by the caller or default policy |
| Minimum range | Smallest splittable range, one block in V1 |
| Checkpoint | A committed range-end block number and block hash |
| Lease | Target-scoped database record that prevents overlapping updates |

## 5. Distribution Requirements

### 5.1 Source of installation

The canonical package source is:

```text
https://github.com/xzsean666/EVMEventLake-Node-SDK
```

Consumers install a Git tag or immutable commit. A semantic version tag is the
normal release reference.

Example dependency reference:

```text
github:xzsean666/EVMEventLake-Node-SDK#v0.1.0
```

### 5.2 Package requirements

The implemented repository must contain standard Node package metadata with:

- CommonJS and/or ESM behavior explicitly documented.
- A stable public `exports` map.
- TypeScript declarations.
- A declared supported Node.js version.
- A Git-install-compatible build lifecycle.
- A guard that prevents accidental npm registry publication.
- No requirement for an npm registry package release.

### 5.3 Versioning

- Intended releases use semantic version Git tags.
- Production consumers should pin a tag or full commit.
- Breaking public API or schema changes require a new major version after 1.0.
- Before 1.0, breaking changes require release notes and a minor version bump.
- Database migrations are forward-only during normal startup.

### 5.4 Foundation SDK Re-Export (`evm-call`)

To prevent downstream consumer projects from having to declare duplicate Git dependency references or suffering from pnpm phantom dependency restrictions, the SDK re-exports its underlying EVM foundation SDK (`evm-call`):

1. **Subpath Export**: Registered under `"./evm-call"` in `package.json#exports`. Consumers can import all public symbols, utilities, and classes directly via:
   ```ts
   import { EvmCallClient, CooldownTracker, MULTICALL3_ADDRESS } from "@evm-event-lake/node-sdk/evm-call";
   ```
2. **Namespace Export**: Exposed as `EvmCall` on the root package entry point:
   ```ts
   import { EVMEventLake, EvmCall } from "@evm-event-lake/node-sdk";
   ```
3. **Namespace Isolation**: Top-level root exports do not leak internal/colliding symbols such as `RpcPool`, preserving strict abstraction boundaries.

## 6. Public Lifecycle

### 6.1 Create

The SDK exposes an asynchronous creation operation.

Create must:

1. Validate and normalize all options.
2. Parse the database URL.
3. Normalize the chain ID, contract address, and start block.
4. Build an immutable ABI event catalog and fingerprint.
5. Initialize the selected storage adapter and apply SDK migrations.
6. Register or validate target metadata.
7. Register the ABI version if it is new.
8. Build the RPC pool without requiring an endpoint to be online.
9. Return a ready instance that can execute database-only queries.

Create must not:

- Require successful RPC connectivity.
- Start a background task.
- Synchronize blocks implicitly.
- Change the durable cursor except when creating a new target.

Each endpoint must pass chain ID validation during an explicit RPC operation
before it becomes eligible to serve a head, header, or log response.

### 6.2 Update

`update` performs one finite synchronization run.

It must:

1. Acquire the target lease or return a typed lock error.
2. Load durable target state and checkpoints.
3. Validate an eligible RPC endpoint against the configured chain ID.
4. Validate the latest stored checkpoint against the current chain.
5. Rewind safely if a supported-depth reorg is detected.
6. Resolve the inclusive target block.
7. Plan ordered preferred ranges from `nextBlock`.
8. Fetch every range with adaptive splitting and failover.
9. Normalize, order, and deduplicate logs.
10. Decode known events and retain unknown or failed logs.
11. Atomically commit each completed contiguous range and its checkpoint.
12. Renew the lease during long runs.
13. Release the lease in success and failure paths.
14. Return a structured result when the requested boundary is reached or is
    already complete.

`update` must not:

- Schedule another update.
- Retry forever.
- Skip an unfetchable block.
- Advance over a partially fetched range.
- Hide a terminal failure as success.

### 6.3 Get sync status

`getSyncStatus` reads the database only.

It returns:

- Chain ID and normalized contract address.
- Start block.
- Next block.
- Synced-through block when one exists.
- Latest checkpoint block and hash when one exists.
- Active ABI fingerprint.
- Whether a non-expired synchronization lease exists.
- Target creation and last-commit timestamps.

It does not fetch the current chain head.

### 6.4 Query events

Event queries access the database only. They must remain operational during an
RPC outage.

The initial API provides:

- Find multiple events.
- Find the first event in requested deterministic order.
- Limit and opaque cursor pagination.

### 6.5 Close

`close` releases resources owned by the instance.

- It is safe to call more than once.
- It does not delete data.
- It does not wait for or schedule future work.
- If called during an active update, it aborts the operation, waits for its
  lease/transaction cleanup, and then closes storage. The update caller receives
  the cancellation result.

## 7. Creation Options

### 7.1 Required options

| Option | Accepted value | Rules |
| --- | --- | --- |
| `database` | String | Supported SQLite, PostgreSQL, or IndexedDB URL |
| `rpcUrls` | Non-empty string array | HTTP or HTTPS only; duplicates removed without reordering |
| `chainId` | Positive integer | Normalized to an integer and checked against RPC responses |
| `contractAddress` | EVM address | Valid 20-byte address; canonical identity is lowercase |
| `abi` | ABI array | Must be structurally valid and contain at least one event |
| `startBlock` | Non-negative safe number or bigint | Inclusive; normalized internally to bigint |

### 7.2 Database URLs

Required URL forms:

| Database | Example | Meaning |
| --- | --- | --- |
| SQLite relative file | `sqlite://events.db`, `sqlite:events.db`, `./events.db` | File resolved from the caller process working directory |
| SQLite absolute POSIX | `sqlite:///var/lib/app/events.db`, `sqlite:/var/lib/app/events.db` | Absolute POSIX file path |
| SQLite Windows drive | `sqlite:///C:/data/events.db`, `sqlite:C:\data\events.db` | Windows absolute path with drive letter |
| SQLite in-memory | `:memory:`, `sqlite::memory:`, `sqlite://:memory:` | Ephemeral in-memory SQLite database |
| SQLite file alias | `file:///var/lib/app/events.db`, `file://events.db` | Standard `file://` URI mapped to SQLite |
| PostgreSQL | `postgresql://user:password@host:5432/database` | Standard PostgreSQL connection URL |
| PostgreSQL alias | `postgres://user:password@host:5432/database` | Accepted alias |
| IndexedDB | `idb://lake-events` | Browser IndexedDB database named `lake-events` |
| IndexedDB alias | `indexeddb://lake-events` | Accepted alias for browser IndexedDB |

SQLite initialization may create the database file when pointing to a persistent path. The parent directory must
already exist (except for `:memory:` in-memory mode). Database URLs containing credentials must be redacted in logs and
errors. In browser dApps and bundling environments, `idb://` requires zero Node.js
C++ native bindings (`better-sqlite3`, `pg`), loading storage drivers via dynamic
asynchronous imports.

### 7.3 Optional synchronization policy

The optional synchronization policy is centralized under one typed option.

| Field | V1 default | Rules |
| --- | --- | --- |
| `confirmations` | `12` | Non-negative integer; used only when `update.toBlock` is omitted |
| `defaultBlockRange` | `2000` | Positive integer; preferred maximum range |
| `minimumBlockRange` | `1` | V1 must not allow a value below one |
| `reorgCheckDepth` | `20` checkpoints | Positive integer |
| `leaseDurationMs` | `60000` | Must exceed the lease renewal interval |

These are general defaults, not claims of finality for every chain. Production
callers are responsible for choosing a confirmation policy appropriate to their
chain and risk tolerance.

### 7.4 Optional RPC policy

| Field | V1 default | Rules |
| --- | --- | --- |
| `batchSize` | `1` | Positive integer; maximum contiguous sub-ranges per JSON-RPC batch payload (`1` for single-request compatibility) |
| `requestTimeoutMs` | `20000` | Positive bounded timeout per RPC attempt |
| `maxRetriesPerEndpoint` | `2` | Non-negative bounded retry count |
| `endpointCooldownMs` | `30000` | Positive cooldown after endpoint failure |
| `maximumTimeoutSplitsPerRange` | `2` | Positive bound before timeout handling fails over |

### 7.5 Optional observability

The caller may provide:

- A structured logger contract.
- An update progress callback.

Callbacks receive redacted structured data. Their absence produces no required
console output. Callback failure must not alter cursor correctness; the exact
error-reporting behavior must be documented and tested during implementation.

### 7.6 Optional event enrichment

The caller may provide an `enrichEvent` callback:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enrichEvent` | `(context: EventEnrichmentContext) => unknown \| Promise<unknown>` | `undefined` | Hook invoked for each ingested event during synchronization or re-decoding |

The callback receives an `EventEnrichmentContext` containing:
- `chainId`: Chain identifier number.
- `contractAddress`: Normalized 20-byte target contract address.
- `blockNumber`: Event block number as bigint.
- `blockHash`: Block hash.
- `transactionHash`: Transaction hash.
- `transactionIndex`: Integer index within block.
- `logIndex`: Integer index within block.
- `topics`: Readonly array of 32-byte hex topics.
- `data`: Hex string payload.
- `decodeStatus`: `"decoded"`, `"unknown"`, or `"decode_failed"`.
- `eventName`: Decoded event name, or `null`.
- `eventSignature`: Canonical event signature, or `null`.
- `decodedArguments`: Decoded arguments record, or `null`.

The hook may return any JSON-serializable value (including `bigint`, nested arrays, and objects) synchronously or asynchronously. The result is losslessly persisted in the dedicated `additional_data` column of `event_logs`. If the hook throws, the range transaction is cleanly aborted with a typed `EventEnrichmentError`.

### 7.7 Native getLogs topic filters (`topics`, `topic0`..`topic3`)

Callers may supply native EVM `eth_getLogs` topic filters to selectively ingest specific events and indexed parameters:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `topics` | `LogTopicsFilter` (`TopicFilterArray \| TopicFilterObject`) | `undefined` | Native JSON-RPC topic filter (`(TopicFilterPrimitive \| readonly TopicFilterPrimitive[] \| null)[]` or `{ topic0?, topic1?, topic2?, topic3? }`) |
| `topic0` | `TopicFilterValue` | `undefined` | Top-level convenience filter for event signature / first topic |
| `topic1` | `TopicFilterValue` | `undefined` | Top-level convenience filter for first indexed parameter |
| `topic2` | `TopicFilterValue` | `undefined` | Top-level convenience filter for second indexed parameter |
| `topic3` | `TopicFilterValue` | `undefined` | Top-level convenience filter for third indexed parameter |

**Key Capabilities & Invariants**:
- **Multi-Type Topic Primitives (`TopicFilterPrimitive`)**: Supports `Hex`, 20-byte `Address`, `bigint`, safe `number`, and `boolean`:
  - `bigint`: Encoded to 32-byte hex (e.g. `12345n` -> `0x00...3039`; signed negative integers encoded via 256-bit two's complement).
  - `number`: Safe integer encoded to 32-byte hex (e.g. `42` -> `0x00...002a`).
  - `boolean`: Encoded to 32-byte hex (`true` -> `0x00...01`, `false` -> `0x00...00`).
  - `Address`: 20-byte EVM addresses (`0x${string}`) are automatically padded with leading zeros to 32 bytes (`padHex(addr, { size: 32, dir: "left" })`).
  - `bytes32`: 32-byte hex strings (`0x${string}` with 64 hex characters, e.g. event signatures, hashes, role identifiers).
- **Dual Representation**: Supports standard JSON-RPC array notation (e.g. `[topic0, null, topic2]`) as well as named object notation (e.g. `{ topic0: "0x...", topic1: 12345n }`).
- **Selective Topic Targeting**: Any topic (including `topic0`) may be omitted; omitted topics become `null` (wildcard).
- **Logical OR Support**: Nested arrays at any topic position specify logical OR conditions (e.g. `[[TRANSFER_TOPIC, APPROVAL_TOPIC], null]` or `topic1: [ALICE_ADDR, BOB_ADDR]`).
- **RPC Wire Optimization**: Trailing `null` values are trimmed before JSON-RPC transmission; empty filters are omitted from requests.
- **Defensive Storage Consistency**: Returned RPC logs are validated against the active topic filter inside `normalizeLogs`. Any malformed or violating log returned by a broken RPC endpoint triggers a typed `StorageConsistencyError` before touching storage.

## 8. Update Options and Semantics

| Option | Accepted value | Behavior |
| --- | --- | --- |
| `toBlock` | Non-negative safe number or bigint | Explicit inclusive boundary |
| `blockRange` | Positive safe integer | Overrides preferred range for this update only |
| `signal` | Abort signal | Requests cooperative cancellation |
| `enrichEvent` | `EventEnricher` function | Overrides or supplies the event enrichment hook for this update only |
| `topics` | `LogTopicsFilter` | Overrides or supplies topic filter for this update only |
| `topic0` | `TopicFilterValue` | Overrides or supplies topic0 for this update only |
| `topic1` | `TopicFilterValue` | Overrides or supplies topic1 for this update only |
| `topic2` | `TopicFilterValue` | Overrides or supplies topic2 for this update only |
| `topic3` | `TopicFilterValue` | Overrides or supplies topic3 for this update only |

### 8.1 Automatic target boundary

When `toBlock` is absent:

1. Read a validated endpoint's latest block number.
2. Subtract configured confirmations without going below zero.
3. Use the result as the inclusive target boundary.

### 8.2 No-op conditions

Return a successful no-op result when:

- `nextBlock` is greater than the resolved target boundary.
- The resolved target boundary is lower than `startBlock`.

A no-op does not write event rows or advance state.

### 8.3 Preferred range planning

- Planned ranges are contiguous, non-overlapping, and inclusive.
- The first range starts at `nextBlock`.
- The final range ends exactly at the target boundary.
- A preferred range contains at most `blockRange` blocks.
- Splitting a range produces two contiguous children with no gap or overlap.

### 8.4 Adaptive fetch behavior

The fetcher requests logs by contract address without restricting event topics.
This preserves unknown events and future ABI evidence.

Required error classification:

| Error | Behavior |
| --- | --- |
| Explicit block-range or result-size limit | Split while above minimum range |
| First timeout above minimum range | Split before declaring endpoint failure |
| Repeated timeout after the configured split budget | Fail over; do not split the entire original range into timeouts |
| Timeout at minimum range | Apply bounded retry, then fail over |
| HTTP 429 | Respect retry guidance when available, apply bounded cooldown/failover |
| HTTP 5xx | Bounded retry, then fail over |
| Connection or DNS failure | Fail over and cool down endpoint |
| Invalid JSON-RPC response | Reject response; fail over or terminate with context |
| Chain ID mismatch | Permanently exclude endpoint for this instance |
| Invalid log outside requested target/range | Reject response as protocol-invalid |

When all endpoints fail for a single block, update throws a terminal typed error
and leaves that block as `nextBlock`.

### 8.5 Partial progress

Each completed contiguous range commits independently. If a later range fails:

- Earlier committed ranges remain durable.
- The thrown error contains the last committed block when available.
- A later `update` resumes from the durable `nextBlock`.

### 8.6 Cancellation

Cancellation is cooperative and bounded.

- In-flight RPC should be aborted when supported.
- No partial range transaction may commit.
- Already committed ranges remain durable.
- The lease must be released or allowed to expire safely.
- The caller receives a typed cancellation error with last committed progress.

## 9. RPC Pool Requirements

### 9.1 Endpoint eligibility

- Only HTTP and HTTPS endpoints are accepted.
- An endpoint starts unvalidated.
- Before serving synchronization data, it must return the configured chain ID.
- A mismatched chain ID permanently excludes the endpoint for that instance.
- An unreachable endpoint may recover after cooldown and later validation.

### 9.2 Selection

Selection must be deterministic enough to test. It may consider configured
order, cooldown, recent failures, and latency, but it must not rely on a hidden
background health process.

### 9.3 Bounded attempts

Every request path has explicit bounds for:

- Request timeout.
- Retry count per endpoint.
- Endpoint count.
- Range split floor.
- Timeout-triggered split count per original preferred range and endpoint.

No RPC failure path may produce an unbounded loop.

### 9.4 Secret handling

Errors and observability events may include endpoint origin and a redacted path,
but must remove user information, passwords, sensitive query values, and API
keys.

### 9.5 JSON-RPC Batch Requesting and Adaptive Fallback

When `rpc.batchSize > 1` is configured:

- Contiguous synchronization ranges are grouped into JSON-RPC 2.0 batch payloads (`[{ id, jsonrpc: "2.0", method: "eth_getLogs", params }, ...]`).
- Responses are matched back to requests by `id` regardless of response arrival order.
- Individual item errors within a batch response are parsed and classified (e.g. `range_limit`).
- If an endpoint explicitly rejects batching (HTTP 405, 501, or error messages containing "batch"), the pool marks `endpoint.batchSupported = false` and automatically falls back to single-request execution on that endpoint without triggering false failovers or cooling down healthy endpoints.
- If a batch fails partially or with `range_limit`, the synchronization engine decomposes the batch into individual single-range fetches, allowing standard adaptive range splitting (`splitSynchronizationRange`) to isolate dense block intervals without losing events.
- Storage commits remain strictly contiguous, leaf-by-leaf, and atomic in all paths.

## 10. ABI and Decoding Requirements

### 10.1 Event catalog

Creation extracts every ABI item of type `event` and records:

- Event name.
- Full canonical signature.
- Topic zero for non-anonymous events.
- Input name, order, Solidity type, and indexed flag.
- Whether the event is anonymous.

Overloaded event names are allowed. The full signature is the unambiguous event
identity.

### 10.2 ABI fingerprint

The ABI is canonicalized and hashed. The fingerprint:

- Identifies the ABI version used for a decoded row.
- Is stable for semantically identical canonical input.
- Does not include runtime secrets or database state.

### 10.3 Decode outcomes

Every fetched raw log produces one of three persisted outcomes:

| Status | Meaning |
| --- | --- |
| `decoded` | One ABI event matched and all arguments decoded |
| `unknown` | No ABI event matched |
| `decode_failed` | A candidate event matched but values were malformed or ambiguous |

Unknown or decode-failed logs do not stop synchronization. The raw topics and
data remain available for future inspection.

### 10.4 Lossless values

Database representation must not lose integer precision or byte content.

- Solidity integers persist as canonical decimal strings.
- Addresses persist in normalized form.
- Bytes and hashes persist as lowercase prefixed hexadecimal.
- Booleans persist canonically.
- Arrays and tuples preserve ABI order and nested type information.

Public results may rehydrate integers to JavaScript `bigint`. The chosen output
contract must be stable and documented before implementation completes.

### 10.5 Historical Re-decoding

When upgradeable proxy contracts upgrade their implementation ABI or expand their event catalog, callers can re-evaluate previously stored logs using `client.redecode({ abi, fromBlock?, toBlock?, redecodeAll?, enrichEvent?, batchSize?, onProgress?, signal? })`:

- Registers the new ABI version into `abi_versions` and updates the active target ABI fingerprint without overwriting historical version history.
- Iterates over existing event logs using deterministic cursor pagination. By default (`redecodeAll: false`), only previously `unknown` or `decode_failed` logs are re-decoded; when `redecodeAll: true`, all logs within the block range are re-evaluated.
- Atomically replaces decoded fields in `event_logs` and synchronizes indexed lookup rows in `event_parameters` in batched transactions.
- If an `enrichEvent` hook is provided, re-executes enrichment and updates the durable `additional_data` column; if omitted, existing `additional_data` is preserved intact.
- Merges the newly registered event definitions into the query catalog so that events from all known contract versions can be queried.
- Mutual exclusion guarantees `redecode()` and `update()` cannot execute concurrently on the same SDK instance.

## 11. Storage Requirements

### 11.1 Shared contract

SQLite and PostgreSQL implement the same operations:

- Initialize and migrate schema.
- Register or validate target metadata.
- Register ABI versions.
- Load sync state and checkpoints.
- Acquire, renew, and release target leases.
- Atomically commit a contiguous range.
- Atomically rewind after reorg detection.
- Query events with deterministic pagination.

### 11.2 Atomic range commit

One transaction writes:

1. Raw event log rows.
2. Decoded event fields.
3. Queryable parameter rows.
4. Range-end checkpoint.
5. Updated `nextBlock` and target timestamp.

If any part fails, none of the range is considered committed.

### 11.3 Idempotency

Replaying a range must not create duplicate events. Durable uniqueness includes:

- Target identity.
- Block hash.
- Transaction hash.
- Log index.

### 11.4 Target metadata conflict

Reopening an existing target must reject incompatible immutable settings, such
as a different start block, unless a future explicit migration operation is
designed. A new ABI fingerprint is versioned rather than treated as an identity
conflict.

### 11.5 Lease behavior

- The lease is scoped to one target, not the entire database.
- An active lease prevents another update for that target.
- Different targets may update concurrently.
- Leases have owner tokens and expirations.
- A crashed owner's expired lease may be acquired safely.
- Only the owner may renew or release a lease.

## 12. Reorganization Requirements

Before advancing an existing target, update compares the latest stored
checkpoint hash with the current chain hash for that block.

On mismatch:

1. Check older checkpoints from newest to oldest within `reorgCheckDepth`.
2. Select the newest checkpoint whose hash still matches.
3. Atomically delete event data and checkpoints after that block.
4. Reset `nextBlock` to the following block.
5. Continue synchronization from the corrected cursor.

If no checkpoint matches inside the configured depth, stop with a typed
reorg-depth-exceeded error. Do not guess a rewind point.

## 13. Query Requirements

### 13.1 Supported filters

V1 supports AND composition of:

- Exact block number.
- Inclusive block range.
- Transaction hash.
- Event name.
- Full event signature.
- Exact indexed parameter values (`where.indexedParameters`).
- Exact unindexed parameter values (`where.unindexedParameters`).
- Decode status (`decoded`, `unknown`, `decode_failed`).

OR groups, free-form expressions, numeric parameter ranges, and arbitrary SQL
are future features.

### 13.2 Indexed and Dynamic Parameters

- Indexed parameter filtering is exact-match in V1.
- Values are normalized according to the event ABI type.
- Dynamic indexed values (Solidity `string`, `bytes`):
  - Callers may query dynamic indexed parameters with plaintext strings (e.g. `indexedParameters: { username: "Alice" }`) or hex/Uint8Array bytes; the SDK automatically computes the Keccak-256 topic hash client-side.
  - Direct 32-byte Keccak-256 topic hash queries remain fully supported for backward compatibility.
  - Complex dynamic types (arrays, tuples) require supplying the 32-byte topic hash directly.
- If an event name is overloaded and the parameter cannot be resolved unambiguously, the query requires `eventSignature`.

### 13.3 Unindexed Parameters and Performance Optimization

- Callers may filter by decoded non-indexed parameters via `where.unindexedParameters`.
- Values are type-checked and normalized according to the ABI input type (`address`, `uint`/`int` bounds, `bool`, `string`, `bytes`).
- Stored parameter lookups are fully accelerated across all storage engines:
  - SQLite & PostgreSQL: Query `event_parameters` via the compound index `event_parameters_lookup (target_key, name, comparable_value, is_indexed)` with `is_indexed = 0`.
  - IndexedDB: Query `event_parameters` object store via the compound index `by_lookup (targetKey, name, comparableValue, indexed)` with `indexed = 0`.
- 100% contract and behavioral parity is maintained across SQLite, PostgreSQL, and IndexedDB.

### 13.4 Ordering

Canonical ascending chain order is:

1. Block number.
2. Transaction index.
3. Log index.

Descending order reverses the complete tuple. Results must not depend on SQL
engine default ordering.

### 13.5 Pagination

- Default limit: `100`.
- Maximum limit: `1000`.
- Pagination uses an opaque versioned cursor.
- A cursor is scoped to target and sort direction.
- Invalid or mismatched cursors return a typed validation error.
- Offset pagination is not part of V1.

### 13.6 Event result

Each result includes:

- Chain ID and contract address.
- Block number and block hash.
- Transaction hash and transaction index.
- Log index.
- Topics and data.
- Decode status.
- Event name and signature when decoded.
- Decoded arguments when decoded.
- ABI fingerprint used for decoding.
- Additional data (`additionalData`): Custom JSON payload returned by `enrichEvent`, or `null`.

## 14. Update Result

A successful update result includes at least:

- Outcome: synchronized or no-op.
- Requested/resolved from and to blocks.
- Previous and resulting sync cursor.
- Number of preferred and committed ranges.
- Number of RPC requests and adaptive splits.
- Endpoint failover count.
- Fetched, stored, duplicate, decoded, unknown, and decode-failed log counts.
- Rewind information when a reorg was handled.
- Duration.

This result describes one call only. It does not imply that a future chain head
has been reached permanently.

## 15. Error Taxonomy

The public error hierarchy must distinguish at least:

- Configuration validation error.
- Client closed error.
- Unsupported database URL error.
- Storage initialization or migration error.
- Storage consistency error.
- Target metadata conflict error.
- Synchronization locked error.
- Synchronization failed after partial committed progress.
- Event enrichment error (`EVENT_ENRICHMENT_ERROR` / `EventEnrichmentError`).
- No valid RPC endpoint error.
- RPC chain mismatch error.
- RPC request failure with classified category.
- RPC request exhausted error.
- Unfetchable block error.
- ABI validation error.
- Decoded value codec error.
- Query validation error.
- Reorg depth exceeded error.
- Cancellation error.

Errors include a stable code and safe structured context. Errors preserve causes
where supported and redact credentials.

## 16. Observability Requirements

Optional structured events should cover:

- SDK initialization.
- Endpoint validation and exclusion.
- Retry, cooldown, and failover.
- Preferred range start.
- Adaptive range split.
- Range commit.
- Reorg detection and rewind.
- Update completion, cancellation, and failure.

Events must not include database passwords, full credential-bearing URLs, or
raw secrets.

The implemented progress callback emits update start/completion, range fetch
start, adaptive range split, successful endpoint use, range commit, and reorg
rewind stages. Structured logger events additionally report update cancellation
and failure. A no-op update still emits update completion.

## 17. Performance and Safety Requirements

- Log inserts and parameter inserts are batched per committed range and chunked
  to prevent database variable limits (e.g. SQLite's 32,766 parameter ceiling):
  `BULK_LOGS_CHUNK_SIZE = 500`, `BULK_PARAMETERS_CHUNK_SIZE = 1000`, and
  `BULK_IN_CHUNK_SIZE = 1000`. All chunks execute inside the same atomic
  transaction.
- Historical re-decoding via `lake.redecode()` synchronizes both query and
  synchronization services atomically: upgraded ABIs immediately decode newly
  ingested events on subsequent `update()` runs.
- The SDK client runtime is completely isomorphic and decoupled from Node-only
  globals (`Buffer`, `node:crypto`). Pagination cursors, HTTP stream decoding,
  and UUID generation use Web standard `TextEncoder`/`TextDecoder`, `btoa`/`atob`,
  and `globalThis.crypto`.
- IndexedDB keyset cursor pagination computes exact boundary ranges on the
  `by_chain_order` composite index directly from the `after` cursor, enabling
  $O(1)$ index navigation instead of linear cursor scans.
- Query parameter validation rejects empty strings (`""` or `"   "`) for integer
  types and requires valid hexadecimal representations for dynamic bytes prefixed
  with `0x`.
- RPC batching classifies HTTP 413 (Payload Too Large), 422 (Unprocessable
  Entity), and payload limit messages as batch rejections, falling back to
  sequential pipelining without cooling down healthy endpoints.
- Checkpoint end block headers enforce multi-endpoint independence via
  `excludeEndpointIdentity` to ensure canonical chain validation across distinct
  RPC providers.
- Reorged/orphaned logs returned with `removed: true` are discarded during
  synchronization ingestion in `normalizeLogs` and excluded from storage queries.
- Queries use indexes for target, block ordering, transaction hash, event
  signature/name, and exact indexed/unindexed parameter lookup.
- The implementation must not load an unbounded synchronization interval into
  memory.
- Range-fetch children are processed in deterministic order.
- Query limits are enforced before database execution.
- Database writes and RPC retries have bounded resource use.
- SQLite documentation must state that PostgreSQL is preferred for heavy
  multi-process concurrency.

No fixed throughput promise is made before benchmarks exist.

## 18. Acceptance Criteria

Implementation is acceptable only when all of these are demonstrated:

1. A clean project installs the SDK from an exact GitHub tag or commit.
2. The installed package exposes working JavaScript and TypeScript declarations.
3. SQLite and PostgreSQL pass the same storage contract suite.
4. A mocked range-limit error causes gap-free adaptive splitting.
5. A bad endpoint fails over to a valid endpoint.
6. A mismatched-chain endpoint is never used for synchronization data.
7. A process interruption resumes from the last atomic committed range.
8. Repeating a range creates no duplicates.
9. Unknown ABI logs remain stored with raw data.
10. A recent block hash mismatch rewinds and replays correctly.
11. A reorg deeper than the configured history stops safely.
12. Concurrent updates for one target cannot both own the lease.
13. Different targets can share the database.
14. Event queries work while RPC endpoints are unreachable.
15. Event-name, signature, transaction, block, and indexed-parameter filters
    return deterministic results in both databases.
16. Cancellation preserves committed progress and does not commit a partial
    range.
17. Logs and errors redact credential-bearing URLs.
18. Ordinary tests run without live network access.
19. An opt-in live test indexes and queries a documented real-chain sample.
20. No background timer remains after `update` returns or `close` completes.

The deterministic local suite demonstrated criteria 4 through 20 where they do
not require a real PostgreSQL server. The gated live test demonstrated criterion
19 against Base USDC block `48625053` on 2026-07-14. A clean GitHub full-commit
consumer and the maintained standalone `example/` demonstrated criteria 1 and
2 using only the public package root outside the SDK worktree. The shared
storage and query contracts passed against PostgreSQL 18.4 in isolated temporary
schemas on 2026-07-15, completing criterion 3 in addition to the ordinary
`pg-mem` coverage.

## 19. Caller-Owned Usage Patterns

The following are valid caller responsibilities and must remain outside the
SDK:

- Calling `update` in a loop with a sleep interval.
- Running `update` from cron or a queue worker.
- Computing a recent-block lower boundary from `getSyncStatus`.
- Filtering query results into application domain records.
- Aggregating balances, volumes, positions, or alerts.
- Publishing selected events to another service.

Documentation may show these patterns as external examples, but the SDK must
not absorb them into its internal lifecycle.
