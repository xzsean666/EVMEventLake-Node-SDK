# Task Index: EVMEventLake Node SDK

This document is the authoritative task registry for the EVMEventLake Node SDK project.

---

## 1. Task Lifecycle Rules

Every task transitions strictly according to the following state machine:

```text
TODO -> IN_PROGRESS -> REVIEW -> DONE
                    \-> BLOCKED
```

- **`TODO`**: Task defined, scoped, and ready to be scheduled once dependencies are met.
- **`IN_PROGRESS`**: Currently active task in the ongoing session. At most ONE task is in progress per session.
- **`REVIEW`**: Implementation completed; undergoing verification, testing, or review.
- **`DONE`**: All acceptance criteria satisfied, verification executed and recorded, docs updated.
- **`BLOCKED`**: Blocked by an unmet external dependency, missing maintainer input, or technical impediment.

---

## 2. Master Task Registry

| Task ID | Title | Status | Dependencies | Summary / Scope | Task File |
| --- | --- | --- | --- | --- | --- |
| **`TASK-000`** | Core V1 SDK Implementation | **DONE** | None | Foundational architecture, dual SQLite/PG storage, HTTP JSON-RPC adaptive sync, reorg recovery, offline query, and Git install testing. | [`TASK-000.md`](tasks/TASK-000.md) |
| **`TASK-001`** | EVM Infrastructure Migration (`evm-call` Rebase) | **DONE** | `TASK-000` | **[Highest Priority - 换底座]** Rebase EVM communication on `evm-call` (`github:xzsean666/evm-call`), adopting resilient RPC pools, stepped cooldowns, and log streaming. | [`TASK-001.md`](tasks/TASK-001.md) |
| **`TASK-002`** | Universal Packaging & Driver Decoupling | **DONE** | `TASK-001` | Decouple Node native drivers (`better-sqlite3`, `pg`) from client facade, support `idb://` connection strings, enable clean browser bundling. | [`TASK-002.md`](tasks/TASK-002.md) |
| **`TASK-003`** | IndexedDB Storage Adapter Implementation | **DONE** | `TASK-002` | Implement `StorageAdapter` on browser `indexedDB`: object stores, indices, atomic multi-store transactions, rewind, leases, and query filters. | [`TASK-003.md`](tasks/TASK-003.md) |
| **`TASK-004`** | Storage Contract Parity for IndexedDB | **DONE** | `TASK-003` | Execute and pass the 6 shared storage contract and 3 query contract test suites against IndexedDB via `fake-indexeddb`. | [`TASK-004.md`](tasks/TASK-004.md) |
| **`TASK-005`** | Universal Client Integration & Frontend Example | **DONE** | `TASK-004` | Verify identical isomorphic usage in browser dApp environment (`examples/07-browser-indexeddb/`), testing offline sync and search. | [`TASK-005.md`](tasks/TASK-005.md) |
| **`TASK-006`** | License Selection & Release Tag Preparation | **DONE** | `TASK-005` | Finalize open-source license, add `LICENSE`, update `package.json`, and prepare universal Git release tag `v0.1.0`. | [`TASK-006.md`](tasks/TASK-006.md) |
| **`TASK-007`** | SQLite Cross-Platform Path & URL Normalization | **DONE** | `TASK-000` | Standardize SQLite URL resolution across POSIX, Windows drive letters, relative paths, and memory flags. | [`TASK-007.md`](tasks/TASK-007.md) |
| **`TASK-008`** | Proxy Contract Historical Re-decoding Design | **DONE** | `TASK-000` | Add `redecode()` operation allowing historical raw logs to be re-decoded upon contract ABI upgrades. | [`TASK-008.md`](tasks/TASK-008.md) |
| **`TASK-009`** | RPC Batch Requesting & Adaptive Pipelining | **DONE** | `TASK-001` | Implement JSON-RPC batching and request pipelining to accelerate large block interval sync. | [`TASK-009.md`](tasks/TASK-009.md) |
| **`TASK-010`** | Indexed Dynamic Values & Parameter Search | **DONE** | `TASK-000` | Transparent topic hashing for dynamic string/bytes and accelerated non-indexed query indices. | [`TASK-010.md`](tasks/TASK-010.md) |
| **`TASK-011`** | Comprehensive Audit Hardening & Security, Performance, and Correctness Optimization | **DONE** | `TASK-010` | SQL variable chunking, redecode catalog sync, browser Buffer decoupling, IndexedDB O(1) keyset pagination, query validation hardening, and RPC batch resilience. | [`TASK-011.md`](tasks/TASK-011.md) |
| **`TASK-012`** | Subpath and Namespace Re-Export for evm-call Foundation SDK | **IN_PROGRESS** | `TASK-011` | Expose `@evm-event-lake/node-sdk/evm-call` and `EvmCall` namespace so downstream projects can use foundation utilities without duplicate dependency declarations. | [`TASK-012.md`](tasks/TASK-012.md) |

---

## 3. Execution Priority & Next Up

1. **Active Task**: **TASK-012: Subpath and Namespace Re-Export for evm-call Foundation SDK**.


---

## 4. Task Creation Checklist

When creating a new task:
1. Create `docs/AI/tasks/TASK-xxx.md` using the standard template:
   - `## Objective`
   - `## Scope`
   - `## Allowed Files`
   - `## Dependencies`
   - `## Inputs and Outputs`
   - `## Acceptance Criteria`
   - `## Verification Commands`
   - `## Risks and Assumptions`
   - `## Status`
2. Add the entry to this `TASK_INDEX.md` table.
3. Keep task scope bounded to 30–90 minutes of focused development.
