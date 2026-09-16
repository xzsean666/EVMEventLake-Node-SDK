# TASK-013: Custom Event Enrichment Hook with Durable Additional Data (additionalData)

---

## 1. Objective

Allow callers to supply a custom event enrichment function (`enrichEvent`) either during SDK initialization (`EVMEventLake.create({ enrichEvent })`) or overridden on individual incremental sync calls (`lake.update({ enrichEvent })`).

The enricher receives the full raw and decoded event context (`EventEnrichmentContext`), and may return custom JSON data (`Promise<unknown> | unknown`). The SDK losslessly persists this result in a dedicated `additional_data` database column across SQLite, PostgreSQL, and IndexedDB, and exposes it through `eventRecord.additionalData` in query results (`events.findMany()`, `events.findFirst()`).

---

## 2. Scope

- **Error Taxonomy**:
  - Add `EventEnrichmentError` in `src/errors/evm-event-lake-errors.ts` for typed handling of enricher callback exceptions.
- **Storage Layer Schema & Parity**:
  - Add `additionalData: string | null` to `StoredEventLog` in `src/storage/storage-models.ts`.
  - Add `additional_data: string | null` to `EventLogTable` in `src/storage/storage-database-schema.ts`.
  - In `src/storage/sql-storage-adapter.ts`:
    - Add `additional_data` column to `event_logs` table creation.
    - Bump `SCHEMA_VERSION` to 2 and support forward-only migration.
    - Update row mapping and bulk operations to store/retrieve `additional_data`.
  - In `src/storage/indexeddb/`:
    - Add `additionalData: string | null` to `EventLogStoreRow` in `indexeddb-types.ts`.
    - Bump `SCHEMA_VERSION` to 2 and update `indexeddb-storage-adapter.ts` to store/retrieve `additionalData`.
- **Enrichment Execution**:
  - Define `EventEnrichmentContext` and `EventEnricher` types in `src/configuration/sdk-options.ts`.
  - In `src/synchronization/update-service.ts`:
    - Accept default `enrichEvent` in constructor and allow per-call override in `update({ enrichEvent })`.
    - Await `enrichEvent(context)` for each log in the fetched range before committing.
    - Losslessly encode return value via `encodeDecodedValue` into `storedLog.additionalData`.
    - On enricher failure, wrap with `EventEnrichmentError` and abort the uncommitted range safely.
  - In `src/synchronization/redecode-service.ts`:
    - Support optional `enrichEvent` in `RedecodeOptions`; preserve existing `additionalData` if omitted, or re-run if provided.
- **Query Mapping**:
  - Add `readonly additionalData: unknown;` to `EventRecord` in `src/query/event-query.ts`.
  - In `src/query/event-query-service.ts`: deserialize `row.additionalData` via `decodeDecodedValue` into `eventRecord.additionalData` (defaulting to `null`).
- **Client Facade & Re-export**:
  - Plumb `enrichEvent` through `EVMEventLake.create()` and `lake.update()`.
  - Export `EventEnricher`, `EventEnrichmentContext`, and `EventEnrichmentError` from `src/index.ts`.
- **Testing & Documentation**:
  - Shared storage contract tests in `tests/storage-contract/storage-adapter.contract.ts`.
  - Unit tests in `tests/unit/event-enricher.test.ts`.
  - Update `README.md`, `docs/SPEC.md`, `docs/AI/ARCHITECTURE.md`, `docs/AI/SESSION_STATE.md`, and `docs/AI/TASK_INDEX.md`.

---

## 3. Allowed Files

- `src/errors/evm-event-lake-errors.ts`
- `src/storage/storage-models.ts`
- `src/storage/storage-database-schema.ts`
- `src/storage/sql-storage-adapter.ts`
- `src/storage/indexeddb/indexeddb-types.ts`
- `src/storage/indexeddb/indexeddb-storage-adapter.ts`
- `src/configuration/sdk-options.ts`
- `src/configuration/validate-sdk-options.ts`
- `src/synchronization/synchronization-result.ts`
- `src/synchronization/update-service.ts`
- `src/synchronization/redecode-service.ts`
- `src/query/event-query.ts`
- `src/query/event-query-service.ts`
- `src/client/evm-event-lake.ts`
- `src/index.ts`
- `tests/support/internal-exports.ts`
- `tests/storage-contract/storage-adapter.contract.ts`
- `tests/query/query-service.contract.ts`
- `tests/unit/audit-hardening.test.ts`
- `tests/unit/public-api.test.ts`
- `tests/unit/event-enricher.test.ts` (create)
- `README.md`
- `docs/SPEC.md`
- `docs/AI/ARCHITECTURE.md`
- `docs/AI/tasks/TASK-013.md` (create)
- `docs/AI/TASK_INDEX.md`
- `docs/AI/SESSION_STATE.md`

---

## 4. Dependencies

- Completed: `TASK-000` through `TASK-012`.

---

## 5. Inputs and Outputs

- **Inputs**:
  - `enrichEvent?: EventEnricher` passed to `create()` and/or `update()`.
  - `EventEnrichmentContext` supplied to the enricher.
- **Outputs**:
  - Persisted JSON string in `additional_data` column / store across SQLite, PostgreSQL, IndexedDB.
  - `eventRecord.additionalData` containing the parsed JSON result in query outputs.

---

## 6. Acceptance Criteria

1. `enrichEvent` can be provided at `EVMEventLake.create({ enrichEvent })` and/or overridden in `lake.update({ enrichEvent })`.
2. Both sync (`(event) => data`) and async (`async (event) => Promise<data>`) functions are fully supported.
3. Complex JSON structures including nested objects, arrays, and `bigint` are preserved losslessly.
4. `additionalData` is durably stored in SQLite, PostgreSQL, and IndexedDB with 100% parity across adapters.
5. `events.findMany()` and `events.findFirst()` return `additionalData` populated on every `EventRecord` (or `null` if none was provided).
6. If the enricher throws, the update halts cleanly, throws `EventEnrichmentError`, and no partial progress for the range is committed.
7. Existing database schemas without `additional_data` migrate seamlessly.
8. Full test suite passes (`pnpm run verify`).

---

## 7. Verification Commands

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test tests/unit/event-enricher.test.ts
pnpm run test
pnpm run build
pnpm run verify
```

### Verification Results
- `pnpm run format:check`: Passed with 0 formatting issues.
- `pnpm run lint`: Passed with 0 errors and 0 warnings.
- `pnpm run typecheck`: Passed cleanly with zero TypeScript diagnostic errors.
- `pnpm test tests/unit/event-enricher.test.ts`: Passed all 7 tests covering sync enricher, async enricher, update overrides, complex JSON/BigInt serialization, exception rollback, null defaults, redecode behavior, and IndexedDB parity.
- `pnpm run test`: Passed all 30 test files and 150 unit/contract/integration tests (2 live-env tests skipped).
- `pnpm run build`: Successfully built ESM code and type declarations.
- `pnpm run verify`: Full continuous integration pipeline executed and passed cleanly (Exit code 0).

---

## 8. Status

DONE
