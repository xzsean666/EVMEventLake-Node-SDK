# TASK-003: IndexedDB Storage Adapter Implementation

## Objective
Implement a zero-dependency `IndexedDBStorageAdapter` in pure TypeScript conforming to the standard `StorageAdapter` interface, enabling durable event synchronization, multi-store atomic commits, reorg rewind, and query filtering natively in browser environments.

## Scope
- Create `src/storage/indexeddb/indexeddb-storage-adapter.ts`.
- Implement database initialization with versioned ObjectStores:
  - `lake_targets` (keyPath: `targetKey`)
  - `abi_versions` (keyPath: `[targetKey, abiFingerprint]`)
  - `event_logs` (keyPath: `[targetKey, blockNumber, logIndex]`, indices on `eventName`, `eventSignature`, `blockNumber`, `transactionHash`)
  - `event_parameters` (keyPath: `[targetKey, blockNumber, logIndex, parameterName]`, indices on `[targetKey, parameterName, indexedValue]`)
  - `sync_checkpoints` (keyPath: `[targetKey, blockNumber]`)
  - `sync_leases` (keyPath: `targetKey`)
  - `schema_migrations` (keyPath: `version`)
- Implement `commitRange()` as an atomic multi-store IndexedDB transaction (`db.transaction([...], 'readwrite')`) committing logs, parameters, checkpoints, and target cursor.
- Implement `rewind()` atomically deleting logs, parameters, checkpoints after `rewindToBlock`.
- Implement `getRecentCheckpoints()` retrieving checkpoints in reverse block order.
- Implement `acquireLease()`, `renewLease()`, `releaseLease()` using the `sync_leases` store.
- Implement `queryEvents()` supporting AND filters (block range, transaction hash, event name/signature, exact indexed parameter matches) and deterministic ordering.

## Allowed Files
- `src/storage/indexeddb/**/*`
- `src/storage/create-storage-adapter.ts`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-003.md`

## Dependencies
- TASK-002 (Universal Packaging & Storage Driver Decoupling).

## Inputs and Outputs
- **Inputs**: Database name, standard storage requests (`CommitRangeRequest`, `StoredEventQuery`, `RewindRequest`).
- **Outputs**: Complete `StorageAdapter` implementation operating over browser `window.indexedDB`.

## Acceptance Criteria
- [x] `IndexedDBStorageAdapter` implements all methods of `StorageAdapter` with no TypeScript errors.
- [x] Multi-store transactions ensure atomic commits: if an error occurs while writing parameters, logs and cursor are not persisted.
- [x] Rewind correctly purges all event logs, parameters, and checkpoints beyond the specified block.
- [x] Opaque cursor and sorting match SQLite/PostgreSQL canonical ordering (`blockNumber ASC, transactionIndex ASC, logIndex ASC`).
- [x] Target lease acquisition and expiration prevent concurrent execution races.

## Verification Commands
```bash
pnpm run typecheck
pnpm run build
```

## Risks and Assumptions
- Browser IndexedDB transactions auto-commit on microtask exhaustion; all async preparation (ABI decoding, serialization) must be completed before starting the readwrite transaction.
- BigInt values cannot always be directly indexed as IndexedDB keys in older engines; use fixed-width string or numeric representation consistent with the existing SQL storage adapter.

## Status
DONE
