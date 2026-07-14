# EVMEventLake Node SDK Specification

Version: 1.0

Status: Implementation underway

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
- ABI discovery from explorers.
- Historical re-decoding after an ABI change.
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

Example planned dependency reference:

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
- If called during an active update, the active operation must be cancelled or
  rejected according to one documented implementation choice; it must not
  silently corrupt a transaction.

## 7. Creation Options

### 7.1 Required options

| Option | Accepted value | Rules |
| --- | --- | --- |
| `database` | String | Supported SQLite or PostgreSQL URL |
| `rpcUrls` | Non-empty string array | HTTP or HTTPS only; duplicates removed without reordering |
| `chainId` | Positive integer | Normalized to an integer and checked against RPC responses |
| `contractAddress` | EVM address | Valid 20-byte address; canonical identity is lowercase |
| `abi` | ABI array | Must be structurally valid and contain at least one event |
| `startBlock` | Non-negative safe number or bigint | Inclusive; normalized internally to bigint |

### 7.2 Database URLs

Required URL forms:

| Database | Example | Meaning |
| --- | --- | --- |
| SQLite relative file | `sqlite://events.db` | File resolved from the caller process working directory |
| SQLite absolute file | `sqlite:///var/lib/app/events.db` | Absolute file path |
| PostgreSQL | `postgresql://user:password@host:5432/database` | Standard PostgreSQL connection URL |
| PostgreSQL alias | `postgres://user:password@host:5432/database` | Accepted alias |

SQLite initialization may create the database file. The parent directory must
already exist. Database URLs containing credentials must be redacted in logs and
errors.

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

## 8. Update Options and Semantics

| Option | Accepted value | Behavior |
| --- | --- | --- |
| `toBlock` | Non-negative safe number or bigint | Explicit inclusive boundary |
| `blockRange` | Positive safe integer | Overrides preferred range for this update only |
| `signal` | Abort signal | Requests cooperative cancellation |

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
- Exact indexed parameter values.

OR groups, free-form expressions, numeric parameter ranges, and arbitrary SQL
are future features.

### 13.2 Indexed parameters

- Indexed parameter filtering is exact-match in V1.
- Values are normalized according to the event ABI type.
- Dynamic indexed values represented by topic hashes are queried by hash.
- If an event name is overloaded and the parameter cannot be resolved
  unambiguously, the query must require an event signature.

### 13.3 Ordering

Canonical ascending chain order is:

1. Block number.
2. Transaction index.
3. Log index.

Descending order reverses the complete tuple. Results must not depend on SQL
engine default ordering.

### 13.4 Pagination

- Default limit: `100`.
- Maximum limit: `1000`.
- Pagination uses an opaque versioned cursor.
- A cursor is scoped to target and sort direction.
- Invalid or mismatched cursors return a typed validation error.
- Offset pagination is not part of V1.

### 13.5 Event result

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
- Unsupported database URL error.
- Storage initialization or migration error.
- Target metadata conflict error.
- Synchronization locked error.
- No valid RPC endpoint error.
- RPC chain mismatch error.
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

## 17. Performance and Safety Requirements

- Log inserts are batched per committed range.
- Queries use indexes for target, block ordering, transaction hash, event
  signature/name, and exact indexed parameter lookup.
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
