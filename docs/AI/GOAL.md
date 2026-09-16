# Project Goal: EVMEventLake Node SDK

Version: 1.0  
Package: `@evm-event-lake/node-sdk`  
Status: Core development completed; entering continuous optimization phase  

---

## 1. Core Objective

EVMEventLake Node SDK is an embeddable, lightweight TypeScript library designed for **one EVM contract per SDK instance**.

Its primary objective is:

> **Reliably synchronize event logs emitted by an EVM smart contract over HTTP JSON-RPC into durable structured storage (IndexedDB in frontend browsers; SQLite or PostgreSQL in backend Node.js/servers), maintain durable and atomic progress cursors, handle blockchain reorganizations safely, and provide high-performance, database-only query capabilities with 100% identical developer experience across frontend and backend.**


The SDK is intentionally designed for callers (applications, cron workers, serverless tasks, message queues, and backends) that retain full control over their process lifecycles and execution environments.

---

## 2. Current Project State

The core architecture and implementation (Phases 1 through 11) have been fully developed and verified:

1. **Package Foundation**: Pure ESM package with strict TypeScript, Node.js `>=22` compatibility, pinned dependencies, zero npm publish exposure (`private: true`).
2. **Contract Target & ABI**: Lowercase normalized target keys, deterministic ABI catalog, overload-safe selector mappings, anonymous event decoding, and bigint-safe lossless value codec.
3. **Storage Engine**: Unified Kysely-based storage contract with 100% parity across **SQLite** (`better-sqlite3`, WAL mode) and **PostgreSQL** (`pg` pool). Migrations, leases, raw log storage, decoded parameter tables, checkpoints, and atomic rollback are fully implemented.
4. **RPC Communication**: HTTP JSON-RPC multi-endpoint pool with eager/lazy chain ID verification, error classification, bounded retries, cooldowns, and automatic endpoint failover.
5. **Synchronization Engine**: One-shot pull-based execution (`update()`), gap-free range planning, adaptive log range splitting, atomic leaf commits, request-scoped lease renewal, cancellation handling, and structured observability logs.
6. **Reorg Recovery**: Newest-to-oldest checkpoint hash validation against canonical chain headers, bounded rewinds, and consistent re-syncing.
7. **Query System**: Completely offline, database-only query API (`events.findMany`, `events.findFirst`) with AND filters (block range, transaction hash, event signature, indexed parameters) and opaque versioned cursor pagination.
8. **Verification & Testing**: 63+ unit and integration tests passing, real PostgreSQL 18.4 verified, local and GitHub-hosted git installation verified with a standalone consumer test.

---

## 3. Guiding Principles & Non-Goals

To maintain long-term maintainability and prevent scope creep during future optimizations, all development must adhere to these non-negotiable boundaries:

### Invariants
- **Embedded Library Only**: The SDK does not run as a standalone server, background daemon, or system service.
- **One Instance = One Target**: Exactly one `chainId + contractAddress` target per SDK instance. Multiple instances can safely share one database.
- **Pull-Based One-Shot Execution**: Calling `update()` executes one bounded sync run and resolves. It never spins up internal timers, intervals, or event loops.
- **Offline Query Isolation**: Query operations (`events.*`) must never contact RPC endpoints. They operate strictly on the local SQL database.
- **Zero Incomplete Commits**: A range is only committed to the database when all logs in that range are completely fetched and written.
- **Direct Git Distribution**: Distributed via GitHub tags/commits (`git+https://github.com/xzsean666/EVMEventLake-Node-SDK.git#v...`). Not published to npm.

### Non-Goals (Explicitly Caller-Owned)
- Polling loops, cron jobs, queues, workers, and process supervisors.
- WebSocket subscriptions or long-lived event listeners.
- HTTP, REST, or GraphQL server endpoints.
- Business definitions (such as "recent blocks", "past 24h volume", or alert triggers).
- Multi-contract orchestration within a single instance.

---

## 4. Continuous Optimization Roadmap

With the core functionality established, the immediate highest priority is rebasing the EVM infrastructure foundation onto `evm-call` ("换底座"), followed by universal frontend/backend parity and system optimizations:

### Track 1: EVM Infrastructure Foundation Migration (`evm-call` Rebase) [Highest Priority - 换底座]
- **Dependency & Integration**: Depend directly on `evm-call` via GitHub (`git+https://github.com/xzsean666/evm-call.git`).
- **RPC Pool Delegation**: Replace redundant custom RPC pooling with `evm-call`'s resilient `EvmRpcPool` (featuring stepped backoff cooldowns from 1m to 24h, fast recovery, and random shuffle).
- **Adaptive Log Ingestion**: Wire `evm-call`'s production log streaming (`getLogsChunked` and `iterateLogs`) into EVMEventLake's synchronization range planner.
- **Multicall3 & Reorg Assertions**: Leverage `evm-call`'s pre/post block reorg assertions and JSON-RPC batch execution for bulletproof block ingestion.

### Track 2: Universal Isomorphic SDK (Frontend IndexedDB & Backend Parity)
- **Storage Decoupling & Bundler Isolation**: Decouple Node native C++ dependencies (`better-sqlite3`, `pg`) so the SDK client can be imported seamlessly into browser bundlers (Vite, Next.js, Rollup) without compilation failures.
- **IndexedDB Storage Adapter**: Implement the standard `StorageAdapter` on native browser `indexedDB`, including object stores, indices, atomic multi-store transactions, and cursor rewind.
- **Storage Contract Parity Testing**: Verify IndexedDB adapter using `fake-indexeddb` against the exact same 6 storage contract and 3 query contract test suites.
- **Isomorphic Client API**: Ensure identical developer usage across frontend and backend (`EVMEventLake.create`, `update()`, `events.findMany()`, `getSyncStatus()`, `close()`).
- **Browser End-to-End Verification**: Provide and verify a standalone frontend dApp example with zero backend database dependencies.

### Track 3: Release & Packaging Readiness

- **License Decision**: Finalize the public license (e.g. MIT, Apache-2.0) with project maintainers and add `LICENSE`.
- **Semantic Version Tagging**: Prepare Git release tags (e.g., `v0.1.0`) and verify consumer installations directly from tags.
- **Documentation & Examples**: Expand consumer blueprints for common frontend and backend application architectures.

### Track 3: Cross-Platform & Environment Robustness
- **SQLite URL Parsing**: Normalize and test SQLite connection URLs across Windows paths (`file://`, `file:///`, relative vs. absolute).
- **Multi-OS Native Binding Verification**: Validate `better-sqlite3` native compilation and prebuild installation on macOS and Windows CI environments.

### Track 4: High-Throughput & Storage Optimization
- **Batch RPC Requests**: Evaluate JSON-RPC batching (`eth_getLogs` + `eth_getBlockByNumber`) where supported by providers to reduce HTTP overhead while preserving error classification.
- **Adaptive Pipelining**: Investigate concurrent non-overlapping range fetching for high block-span catching up.
- **Checkpoint Pruning & Granularity**: Balance reorg safety against checkpoint table growth for long-lived synchronizers.

### Track 5: Extended EVM & ABI Features
- **Contract Proxy Upgrades**: Design an explicit historical re-decoding mechanism (`redecode()`) when an ABI is updated for an upgradeable proxy (e.g. ERC-1967).
- **Dynamic Indexed Argument Search**: Provide utilities or indexed hash lookup tables for dynamic indexed string/bytes topics.

### Track 6: Telemetry & Observability
- **Standard Observability Integrations**: Provide standard adapters/examples for OpenTelemetry tracing and Prometheus metrics.
- **Health Check & Diagnostic Hooks**: Expose deeper diagnostics for RPC pool health and storage engine latencies.

