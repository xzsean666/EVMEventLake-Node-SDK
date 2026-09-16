# TASK-010: Indexed Dynamic Values and Unindexed Parameter Search Optimization

## Objective
Optimize query ergonomics and performance for Solidity dynamic indexed parameters (strings, bytes, arrays stored on-chain as Keccak-256 hashes) and provide accelerated indexing for non-indexed parameter lookups across PostgreSQL, SQLite, and IndexedDB.

## Scope
- Expand `client.events.findMany` filter options to support querying dynamic indexed parameters by plaintext with automatic client-side topic hashing.
- Add optional GIN index migration on PostgreSQL `event_logs.decoded_args`, generated virtual columns in SQLite, and compound indices in IndexedDB for fast non-indexed argument queries.
- Ensure query contract tests pass identically across SQLite, PostgreSQL, and IndexedDB.
- Document query performance considerations and usage patterns in `docs/SPEC.md`.

## Allowed Files
- `src/query/**/*`
- `src/storage/**/*`
- `src/abi/**/*`
- `tests/unit/query/**/*`
- `tests/storage-contract/**/*`
- `docs/SPEC.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-010.md`

## Dependencies
- TASK-000 (Core V1 SDK Implementation - DONE).

## Inputs and Outputs
- **Inputs**: Filter queries with string/bytes arguments for indexed parameters or queries targeting unindexed arguments.
- **Outputs**: Transparent topic hashing for dynamic indexed filters and index-accelerated query execution.

## Acceptance Criteria
- [x] Querying an indexed string/bytes parameter with a plaintext string automatically hashes the input and matches the topic hash.
- [x] Direct topic hash queries continue to function as backward-compatible filters.
- [x] Non-indexed parameter filtering performance improves without breaking storage parity.
- [x] Query contract tests verify parity between SQLite, PostgreSQL, and IndexedDB.

## Verification Commands
```bash
pnpm run test:storage:sqlite
pnpm run test:storage:postgresql
pnpm run test:storage:indexeddb
pnpm run test:unit
pnpm run verify
```

## Risks and Assumptions
- Keccak-256 is one-way: plaintext preimage cannot be recovered from the topic hash alone if the original log data did not contain it.
- Additional database indices must not unacceptably degrade write/synchronization performance.

## Status
DONE
