# TASK-011: Comprehensive Audit Hardening & Security, Performance, and Correctness Optimization

## Objective
Remediate all vulnerabilities, performance bottlenecks, and architectural defects identified during the comprehensive audit:
1. Prevent database crash (`too many SQL variables`) by adding parameter-safe batch chunking in `SqlStorageAdapter`.
2. Fix proxy redecode state desynchronization by enabling `UpdateService` catalog updates upon `redecode()`.
3. Decouple Node-only `Buffer` and `node:crypto` from the isomorphic client runtime to guarantee browser compatibility.
4. Accelerate IndexedDB cursor pagination to true $O(1)$ by binding `by_chain_order` range bounds.
5. Harden query input validation against empty-string numeric coercion to `0n` and malformed `0x` hex strings.
6. Enhance RPC batch error classification (HTTP 413 / payload limits) and prevent batch failures from starving sequential fallback.
7. Enforce multi-endpoint independence during checkpoint block header validation.
8. Filter orphaned (`removed: true`) logs during synchronization ingestion and queries.
9. Synchronize documentation (`docs/SPEC.md`, `docs/AI/ARCHITECTURE.md`, `docs/AI/SESSION_STATE.md`, `docs/AI/TASK_INDEX.md`).

## Scope
- `src/storage/sql-storage-adapter.ts`
- `src/client/evm-event-lake.ts`
- `src/synchronization/update-service.ts`
- `src/query/query-cursor.ts`
- `src/rpc/evm-rpc-client.ts`
- `src/storage/indexeddb/indexeddb-storage-adapter.ts`
- `src/query/event-query-service.ts`
- `src/rpc/rpc-error-classifier.ts`
- `src/rpc/rpc-pool.ts`
- `tests/**/*`
- `docs/SPEC.md`
- `docs/AI/ARCHITECTURE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-011.md`

## Allowed Files
- `src/storage/sql-storage-adapter.ts`
- `src/client/evm-event-lake.ts`
- `src/synchronization/update-service.ts`
- `src/query/query-cursor.ts`
- `src/rpc/evm-rpc-client.ts`
- `src/storage/indexeddb/indexeddb-storage-adapter.ts`
- `src/query/event-query-service.ts`
- `src/rpc/rpc-error-classifier.ts`
- `src/rpc/rpc-pool.ts`
- `tests/**/*`
- `docs/SPEC.md`
- `docs/AI/ARCHITECTURE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-011.md`

## Dependencies
- TASK-010 (Indexed Dynamic Values & Parameter Search - DONE).

## Inputs and Outputs
- **Inputs**: Audit report findings across Security, Performance, and Logical Correctness.
- **Outputs**: Bulletproof, production-hardened SDK passing all tests, benchmarks, and verification suites.

## Acceptance Criteria
- [x] `SqlStorageAdapter.commitRange` and `updateDecodedLogs` successfully commit 2,500+ logs and 10,000+ parameters without `too many SQL variables`.
- [x] Calling `lake.redecode()` updates `UpdateService` so subsequent `update()` syncs correctly decode new events from the upgraded ABI.
- [x] `encodeQueryCursor`, `decodeQueryCursor`, and `HttpEvmRpcClient.readBoundedResponseText` execute without requiring Node.js `Buffer`.
- [x] `IndexeddbStorageAdapter.queryEvents` pagination sets IDBKeyRange bounds directly from `after`, achieving $O(1)$ index navigation.
- [x] Query validation rejects empty strings `""` for integer parameters and invalid `0x...` strings for bytes.
- [x] RPC batch rejection identifies HTTP 413 and avoids putting healthy endpoints into long cooldowns.
- [x] Checkpoint block header verification enforces independent endpoint rotation when multiple endpoints exist.
- [x] Orphaned `removed: true` logs are filtered out during ingestion and querying.
- [x] All unit, storage contract, and integration tests pass cleanly (`pnpm run verify`).

## Verification Commands
```bash
pnpm run format:check # PASS (Prettier check clean)
pnpm run lint         # PASS (0 errors, 0 warnings)
pnpm run typecheck    # PASS (TypeScript check clean)
pnpm run test         # PASS (30 test suites, 140 tests passed, 2 real-env skipped)
pnpm run build        # PASS (Full compilation to dist/)
pnpm run verify       # PASS (End-to-end verification pipeline clean)
```

## Risks and Assumptions
- Parameter chunking in `SqlStorageAdapter` executes within the same atomic transaction so failure during any chunk rolls back all chunks atomically.
- IndexedDB bounds on composite keys must strictly respect ascending vs descending direction and open/closed boundaries.

## Status
DONE
