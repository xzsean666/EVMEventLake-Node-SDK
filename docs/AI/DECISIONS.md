# Architectural Decision Records (DECISIONS)

This document records the foundational architectural and technical decisions made for the **EVMEventLake Node SDK**.

Do not overturn or casually change these decisions. Any modification requires an explicit rationale, backward-compatibility assessment, and synchronized documentation updates.

---

## DEC-001: Embedded Library Model (Not a Service or Daemon)

- **Context**: Applications need EVM contract logs synchronized into their own databases. Creating a long-running background service or daemon adds deployment complexity, port management, IPC, and process supervision burdens.
- **Decision**: Build EVMEventLake as an embeddable TypeScript library rather than a background service or standalone daemon.
- **Consequences**:
  - The caller's host process controls runtime execution, cron/worker scheduling, scaling, and lifecycle.
  - The SDK remains lightweight, zero-footprint when idle, and easy to run in CLI scripts, AWS Lambda, Docker containers, or server backends.

---

## DEC-002: Single Target per SDK Instance (`chainId + contractAddress`)

- **Context**: Contracts on different chains or even different contracts on the same chain have divergent block heights, finality depths, and reorg timelines. Orchestrating multiple targets in one object complicates state tracking.
- **Decision**: Exactly one SDK instance targets exactly one `chainId` and `contractAddress`.
- **Consequences**:
  - State machine, cursor tracking, lease locks, and checkpoint validation are completely independent per contract target.
  - Callers who wish to index multiple contracts create multiple SDK instances. Instances can safely share the same database because schemas and tables are partitioned by a unique target key.

---

## DEC-003: Pure HTTP JSON-RPC Transport (No WebSockets in V1)

- **Context**: WebSockets introduce connection dropouts, reconnection storms, missed event buffering, heartbeat ping/pong overhead, and complex state recovery.
- **Decision**: Use HTTP JSON-RPC (`eth_getLogs`, `eth_blockNumber`, `eth_getBlockByNumber`, `eth_chainId`) exclusively for log synchronization.
- **Consequences**:
  - Synchronization is idempotent, stateless at the transport layer, and naturally tolerant to intermittent endpoint failures.
  - WebSocket support is deferred; live updates are achieved via caller-scheduled periodic `update()` calls.

---

## DEC-004: Pull-Based One-Shot Updates (`update()`)

- **Context**: Internal polling loops (`setInterval`) cause hidden background activity, memory leak risks, uncontrolled thread loops, and testing unpredictability.
- **Decision**: Provide a one-shot `update()` method that performs one finite synchronization run and resolves with structured metrics.
- **Consequences**:
  - Zero unprompted background I/O.
  - Callers decide when, how often, and under what conditions to synchronize (e.g. interval, queue job, manual webhook).

---

## DEC-005: Database-Only Query Surface (`events.findMany`, `events.findFirst`)

- **Context**: Applications querying historical events should not suffer latency or failure when RPC providers are rate-limited, experiencing outages, or degraded.
- **Decision**: All `client.events.*` queries execute exclusively against the local SQL database and never import or trigger RPC calls.
- **Consequences**:
  - Ultra-fast, consistent sub-millisecond query responses.
  - Complete operational resilience: queries succeed even during global network or RPC outages.

---

## DEC-006: Dual Database Support (SQLite & PostgreSQL via Kysely)

- **Context**: Developers need zero-configuration embedded storage for local development, CLIs, and small applications (SQLite), and enterprise-grade concurrency and scaling for production services (PostgreSQL).
- **Decision**: Support SQLite (`better-sqlite3` in WAL mode) and PostgreSQL (`pg` pool) as first-class storage adapters using Kysely for type-safe query construction. Both adapters must pass an identical storage contract test suite.
- **Consequences**:
  - 100% behavioral parity between SQLite and PostgreSQL.
  - Public query APIs and result objects are identical regardless of the underlying dialect.

---

## DEC-007: Raw Log Retention Before Decoded Convenience

- **Context**: Smart contracts may emit unknown events, unindexed topics, or logs matching undeclared ABIs. Also, future ABI updates might require re-examining past logs.
- **Decision**: Always persist the complete raw EVM log (`topics`, `data`, `blockNumber`, `logIndex`, `transactionHash`) in an immutable raw log table, regardless of whether ABI decoding succeeds.
- **Consequences**:
  - No on-chain information is ever lost due to decoding errors or partial ABI definitions.
  - Enables future historical re-decoding without refetching from the blockchain.

---

## DEC-008: Non-Blocking Unknown and Decode-Failed Event Handling

- **Context**: If an unknown event or an ABI mismatch occurs, failing the entire sync would permanently halt block progression.
- **Decision**: Record unknown or decode-failed logs with a dedicated status in the database, allowing cursor progression to continue unabated.
- **Consequences**:
  - Synchronization does not deadlock on malformed or unrecognized events.
  - Decoding issues are inspectable via the database and observability logs.

---

## DEC-009: SDK Owns RPC Policies; Caller Owns Application Scheduling

- **Context**: RPC error handling (rate-limiting, payload size limits, transient network drops) requires specialized blockchain domain knowledge, whereas task scheduling (cron, interval) belongs to application architecture.
- **Decision**: The SDK encapsulates RPC endpoint rotation, cooldowns, exponential backoff, and adaptive range splitting. The caller encapsulates execution scheduling and business logic.
- **Consequences**:
  - Clear architectural boundary: the SDK does not manage process lifecycles, and callers do not need to implement complex RPC retry algorithms.

---

## DEC-010: Offline Asynchronous Initialization (`create()`) Without RPC Connectivity

- **Context**: Applications often boot up in environments where network access might be delayed or where database inspection is immediately required.
- **Decision**: The async factory `EVMEventLake.create()` validates local configuration, sets up database schemas/migrations, and prepares the instance without requiring RPC connectivity.
- **Consequences**:
  - An application can start up, run migrations, and execute `events.findMany()` queries without any RPC connection.
  - RPC endpoints are only verified and connected when `update()` is called.

---

## DEC-011: Mandatory Chain ID Validation on Every RPC Endpoint

- **Context**: Misconfigured or hijacked RPC endpoints can return data from the wrong chain (e.g. Sepolia instead of Mainnet), causing silent database corruption.
- **Decision**: Every configured RPC endpoint must execute `eth_chainId` and match the configured target chain ID before it is allowed to serve event logs.
- **Consequences**:
  - Mismatched endpoints are immediately marked unhealthy and excluded from synchronization.

---

## DEC-012: Atomic Cursor and Range Commits Per Contiguous Completed Range

- **Context**: A process interruption or network crash midway through fetching a block range could leave orphan logs or corrupted sync states.
- **Decision**: Every leaf block range commits raw logs, decoded parameters, checkpoints, and the sync cursor atomically inside a single database transaction.
- **Consequences**:
  - Partial or failed ranges are never committed.
  - Sync state is strictly monotonic and resilient to crashes at any moment.

---

## DEC-013: Checkpoint-Based Reorg Detection and Bounded Rewind

- **Context**: EVM chains experience chain reorganizations where previously mined blocks become orphaned.
- **Decision**: Maintain periodic block hash checkpoints in durable storage. During `update()`, verify recent checkpoints against canonical RPC headers. If a hash mismatch is detected, rewind cursor and logs up to a configured safe depth.
- **Consequences**:
  - Automatic, transparent recovery from shallow reorgs.
  - If a reorg exceeds the maximum safe rewind depth, synchronization halts with a typed error rather than corrupting the database.

---

## DEC-014: Direct GitHub Git Dependency Installation (No npm Registry Publication)

- **Context**: The project is open-source and intended to be consumed directly via Git tags and commit hashes, avoiding npm registry maintenance overhead and token management.
- **Decision**: Package manifest specifies `"private": true`. Consumers install directly via GitHub URL references (e.g., `pnpm add git+https://github.com/xzsean666/EVMEventLake-Node-SDK.git#v0.1.0`).
- **Consequences**:
  - The repository's `prepare` script automatically compiles TypeScript declarations and JavaScript distributions upon consumer installation.
  - Consumers must specify an exact tag or commit hash for reproducible builds.

---

## DEC-015: Pure ESM Module Target and Node.js >=22 Engine

- **Context**: Modern Node.js ecosystems have standardized on ECMAScript Modules (ESM). Dual CommonJS/ESM bundling adds complexity and declaration hazards.
- **Decision**: Publish pure ESM (`"type": "module"`) requiring Node.js 22+.
- **Consequences**:
  - Simplified build pipeline (`tsc` direct output).
  - First-class support for modern Node.js features (native strip-types, import attributes, modern fetch).

---

## DEC-016: Strict Dependency Pinning

- **Context**: Floating dependency ranges (`^` or `~`) can introduce breaking changes or subtle behavioral drift in production builds.
- **Decision**: Pin exact versions for all dependencies and devDependencies in `package.json` and maintain an authoritative `pnpm-lock.yaml`.
- **Consequences**:
  - Deterministic and reproducible installations across different developer environments and CI.

---

## DEC-017: No Generic Utilities or Common Business Modules

- **Context**: "utils", "helpers", and "common" directories often become unstructured dumping grounds for unrelated logic, obscuring module boundaries.
- **Decision**: Prohibit generic `utils` or `common` folders. Codecs, validators, normalizers, and formatting functions must reside inside the specific domain module that owns their lifecycle.
- **Consequences**:
  - High cognitive locality: inspecting a module provides all relevant code for that feature.

---

## DEC-018: Target-Scoped Database Lease Mechanism

- **Context**: Multiple worker processes or threads might accidentally invoke `update()` simultaneously against the same database and contract target.
- **Decision**: Implement a durable database-backed lease with heartbeat expiration scoped to `chainId + contractAddress`.
- **Consequences**:
  - Prevents race conditions and double-fetching without requiring external distributed locks (like Redis).

---

## DEC-019: Automatic Redaction of Sensitive URLs in Errors and Logs

- **Context**: RPC endpoint URLs frequently embed sensitive API keys in their path or query parameters (e.g., `https://mainnet.infura.io/v3/API_KEY` or `https://rpc.com/?key=SECRET`).
- **Decision**: Redact paths, query strings, and credentials from RPC URLs in all public error messages, status reports, and structured log events.
- **Consequences**:
  - Zero risk of leaking secrets in application logs, error monitoring tools (e.g. Sentry), or console outputs.

---

## DEC-020: Versioned Opaque Cursor-Based Pagination

- **Context**: Offset-based pagination (`OFFSET N`) degrades on large tables and suffers from inconsistent results when new rows are inserted during pagination.
- **Decision**: Implement opaque, base64-encoded, versioned cursors encoding `[blockNumber, transactionIndex, logIndex, sortOrder]`.
- **Consequences**:
  - $O(1)$ index-backed pagination even across millions of event logs.
  - Safe evolution of cursor formats via version tags.

---

## DEC-021: Isomorphic Universal SDK & IndexedDB Storage Adapter

- **Context**: Developers want to run the SDK both in backend Node.js services and in frontend browser web applications (React, Vue, Vite, Next.js). Browser environments do not have direct access to native SQLite or PostgreSQL drivers, but do provide IndexedDB as the native durable structured storage standard.
- **Decision**: Make the SDK isomorphic (universal). Introduce a first-class IndexedDB storage adapter (configured via `idb://<name>` or `indexeddb://<name>`) implementing the exact same `StorageAdapter` interface. Ensure that `EVMEventLake.create`, `update()`, `events.findMany()`, `getSyncStatus()`, and `close()` maintain 100% identical usage and observable contracts across frontend and backend.
- **Consequences**:
  - Unified developer experience: same documentation, same types, same mental model for web dApps and backend indexers.
  - dApps gain local, offline-capable, fast event indexing and search inside the user's browser without backend database dependencies.

---

## DEC-022: Dynamic Native Driver Decoupling for Clean Browser Bundling

- **Context**: Node storage drivers (`better-sqlite3` native C++ binary and `pg` Node networking sockets) break client bundlers (Vite, Webpack, Rollup) if imported statically in the shared client entrypoint.
- **Decision**: Decouple native driver imports from the core SDK client façade. The core storage factory loads native SQLite and PostgreSQL drivers dynamically on demand or through environment-aware factory boundaries, ensuring browser builds do not bundle Node-only native modules.
- **Consequences**:
  - Zero bundler configuration hurdles (no manual `externals` or polyfill acrobatics required for frontend users).
  - Clean tree-shaking and minimal bundle size in frontend applications.

---

## DEC-023: Adopt evm-call as the Core Resilient EVM RPC and Log Streaming Foundation (换底座)

- **Context**: The SDK originally composed raw HTTP transport and partial RPC pool logic. Meanwhile, the dedicated `evm-call` infrastructure SDK (`https://github.com/xzsean666/evm-call`) provides battle-tested, high-performance EVM RPC capabilities: multi-node pools with stepped backoff cooldowns (1m ~ 24h), fast recovery, zero heavy dependencies, adaptive chunking for large log queries (`getLogsChunked`, `iterateLogs`), JSON-RPC batching, and Multicall3 aggregated execution with reorg assertions.
- **Decision**: Rebase the entire EVM communication and log streaming layer on `evm-call` (`"evm-call": "github:xzsean666/evm-call"`). `evm-call` serves as the foundational transport and resilient RPC engine. `EVMEventLake` focuses purely on its core value proposition: ABI event catalog and decoding, durable relational storage (SQLite, PostgreSQL, IndexedDB), transactional checkpoint & monotonic cursor management, and database-only query/pagination.
- **Consequences**:
  - Eliminates duplicated RPC pooling, error classification, and retry code inside EVMEventLake.
  - Grants EVMEventLake instant access to advanced `evm-call` capabilities: intelligent layered caching, interpolation search, adaptive 10,000+ result chunking, and Multicall3 reorg assertions.
  - Clean separation of concerns: `evm-call` handles blockchain RPC resilience; `EVMEventLake` handles data persistence, indexing, and querying.


