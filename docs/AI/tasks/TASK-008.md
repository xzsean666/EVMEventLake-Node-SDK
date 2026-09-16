# TASK-008: Proxy Contract Historical Re-decoding Design and Implementation

## Objective
Design and implement an explicit `redecode()` operation allowing historical raw event logs stored in the database to be re-decoded against a newly registered ABI version when an upgradeable proxy contract upgrades its implementation.

## Scope
- Design the public API method signature (e.g. `client.redecode({ abi, fromBlock?, toBlock? })`).
- Support registering a new ABI version in `abi_versions` table without overwriting historical ABI fingerprints.
- Iterate over existing rows in `event_logs` with `decode_status IN ('unknown', 'decode_failed')` or specified block ranges.
- Atomically update `event_logs` (decoded arguments, event name, signature, status) and re-insert into `event_parameters`.
- Provide progress callback notifications for re-decoding operations.
- Add unit and integration tests verifying historical log upgrade re-decoding across SQLite, PostgreSQL, and IndexedDB.

## Allowed Files
- `src/client/evm-event-lake.ts`
- `src/abi/**/*`
- `src/storage/**/*`
- `src/synchronization/**/*`
- `tests/integration/**/*`
- `docs/SPEC.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-008.md`

## Dependencies
- TASK-000 (Core V1 SDK Implementation - DONE).

## Inputs and Outputs
- **Inputs**: Updated contract ABI, optional block range, progress callback.
- **Outputs**: Re-decoded event logs and updated queryable parameter indices in the local database.

## Acceptance Criteria
- [x] `redecode()` registers the new ABI fingerprint in `abi_versions`.
- [x] Unknown logs previously unparsed by the old ABI are successfully decoded if they match the new ABI.
- [x] Existing correctly decoded logs can optionally be preserved or updated.
- [x] Database transaction ensures atomic replacement of decoded rows and parameter tables.
- [x] Query service correctly finds newly decoded events with index filters.

## Verification Commands
```bash
pnpm run test:unit
pnpm run test:integration
pnpm run verify
```

## Risks and Assumptions
- Re-decoding large log volumes (hundreds of thousands of rows) must be batched to avoid SQLite/PostgreSQL/IndexedDB transaction lock exhaustion or excessive memory consumption.

## Status
DONE
