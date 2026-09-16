# TASK-004: Storage Contract Parity Testing for IndexedDB

## Objective
Execute and pass the complete shared storage contract test suite and event query contract test suite against `IndexedDBStorageAdapter` using `fake-indexeddb`, proving 100% behavioral and contract parity across IndexedDB, SQLite, and PostgreSQL.

## Scope
- Add `fake-indexeddb` as a devDependency in `package.json`.
- Create `tests/storage-contract/indexeddb-storage-adapter.test.ts` running the 6 canonical storage contract test cases:
  1. Target registration and initial status.
  2. Atomic range commit and monotonic cursor progression.
  3. Reorg rewind: log purge, checkpoint deletion, cursor reset.
  4. Checkpoint retrieval and consistency.
  5. Target-scoped lease acquisition, renewal, conflict, and expiration.
  6. Idempotent initialization and closure.
- Create `tests/storage-contract/indexeddb-query-adapter.test.ts` running the 3 canonical query contract test cases:
  1. Filter combinations (block ranges, event names, signatures, exact indexed parameters).
  2. Deterministic ordering (`ASC` and `DESC`).
  3. Opaque cursor pagination and limits.
- Add test script `"test:storage:indexeddb"` in `package.json`.

## Allowed Files
- `package.json`
- `pnpm-lock.yaml`
- `tests/storage-contract/indexeddb-storage-adapter.test.ts`
- `tests/storage-contract/indexeddb-query-adapter.test.ts`
- `src/storage/indexeddb/**/*`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-004.md`

## Dependencies
- TASK-003 (IndexedDB Storage Adapter Implementation).

## Inputs and Outputs
- **Inputs**: Test fixtures and contract expectations shared with SQLite and PostgreSQL.
- **Outputs**: Fully verified IndexedDB adapter passing the same test suite as SQL adapters.

## Acceptance Criteria
- [x] `fake-indexeddb` executes cleanly in Node.js test environment via Vitest.
- [x] All 6 storage contract tests pass without modification of shared test assertions.
- [x] All 3 query contract tests pass, returning identical results to SQLite and PostgreSQL.
- [x] `pnpm run test:storage:indexeddb` exits with code 0.

## Verification Commands
```bash
pnpm run test:storage:indexeddb
pnpm run test:storage:sqlite
pnpm run test:storage:postgresql
```

## Risks and Assumptions
- `fake-indexeddb` faithfully adheres to the W3C IndexedDB 3.0 specification; edge cases in browser vendors (e.g. Safari IDB bugs) must be guarded with defensive checks.

## Status
DONE
