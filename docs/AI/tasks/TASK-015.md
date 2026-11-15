# TASK-015: Upgrade evm-call to Latest & Migrate SQLite to Node Native node:sqlite

## Objective
Upgrade the core EVM foundation dependency `evm-call` to its latest commit (`2d9a61bb47d4625b5f404d2ce14fffa78d066d80`), and migrate the SQLite storage adapter from the native C++ compiled dependency `better-sqlite3` to Node.js built-in `node:sqlite` (`DatabaseSync`). Completely remove `better-sqlite3` and native compilation dependencies across root and example configurations.

---

## Scope
1. **evm-call Foundation Upgrade**:
   - Update `package.json` dependency `"evm-call"` to latest GitHub commit hash `2d9a61bb47d4625b5f404d2ce14fffa78d066d80`.
   - Update `pnpm-lock.yaml` via pnpm install.
   - Verify subpath `/evm-call` re-export and client integration.
2. **node:sqlite Dialect & Adapter Implementation**:
   - Create `src/storage/sqlite/node-sqlite-dialect.ts` implementing Kysely `Dialect`, `Driver`, and `DatabaseConnection` backed by Node's built-in `node:sqlite` (`DatabaseSync`).
   - Implement `stmt.columns().length > 0` row detection, variadic argument spread (`...parameters`), parameter sanitization (`undefined -> null`), transaction statements (`BEGIN`, `COMMIT`, `ROLLBACK`), and savepoints.
   - Update `src/storage/sqlite/sqlite-storage-adapter.ts` to use `DatabaseSync` with PRAGMAs (`foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`).
3. **Deprecate & Remove better-sqlite3**:
   - Remove `better-sqlite3` and `@types/better-sqlite3` from `package.json`.
   - Remove `onlyBuiltDependencies` from `package.json` and `pnpm-workspace.yaml`.
   - Remove `onlyBuiltDependencies` from `example/package.json` and `example/pnpm-workspace.yaml`.
4. **Documentation & ADR Updates**:
   - Update `docs/AI/DECISIONS.md` (DEC-006 / DEC-024) to document zero-compilation built-in `node:sqlite` adoption.
   - Update `docs/BUILD.md`, `docs/SPEC.md`, `docs/AI/ARCHITECTURE.md`, `docs/EXTERNAL_DOCS.md`, and `README.md`.
5. **Full Quality Verification**:
   - Ensure 100% storage contract parity passes on SQLite (`test:storage:sqlite`).
   - Pass all test suites, typecheck, lint, formatting, and build.

---

## Allowed Files
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `example/package.json`
- `example/pnpm-workspace.yaml`
- `src/storage/sqlite/node-sqlite-dialect.ts` (new)
- `src/storage/sqlite/sqlite-storage-adapter.ts`
- `docs/SPEC.md`
- `docs/BUILD.md`
- `docs/EXTERNAL_DOCS.md`
- `docs/AI/ARCHITECTURE.md`
- `docs/AI/DECISIONS.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/tasks/TASK-015.md`
- `README.md`

---

## Dependencies
- `TASK-014` (Completed)
- Node.js >= 22.5 built-in `node:sqlite` module (`DatabaseSync`)
- `evm-call` latest commit on `origin/main` (`2d9a61bb47d4625b5f404d2ce14fffa78d066d80`)

---

## Inputs and Outputs
- **Inputs**: User request to upgrade `evm-call` to latest and replace `better-sqlite3` with built-in `node:sqlite`.
- **Outputs**:
  - Zero-compilation Node.js SQLite storage engine using built-in `node:sqlite`.
  - Upgraded `evm-call` dependency reference.
  - Complete test suite passing without native C++ compilation steps.

---

## Acceptance Criteria
1. `package.json` points to `evm-call` commit `2d9a61bb47d4625b5f404d2ce14fffa78d066d80`.
2. `better-sqlite3` is completely uninstalled from dependencies, devDependencies, and pnpm onlyBuiltDependencies.
3. `createSqliteStorageAdapter` uses Node built-in `node:sqlite` and passes all 8 storage adapter contract tests in `tests/storage-contract/sqlite-storage-adapter.test.ts`.
4. All existing SQLite query tests and integration tests pass without regression.
5. All verification commands (`pnpm run verify`: format:check, lint, typecheck, test, build) pass with 0 errors.

---

## Verification Commands
```bash
pnpm run test:storage:sqlite
pnpm run test
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm run verify
```

---

## Risks and Assumptions
- `node:sqlite` requires Node.js >= 22.5.0; the project engine is `>=22`, and local development environment is Node `v24.22.1`.
- `node:sqlite` expects `null` instead of `undefined` for parameter binding; parameters must be sanitized.
- Variadic arguments `...parameters` are required for `node:sqlite` `stmt.run()` and `stmt.all()` instead of passing an array directly.

---

## Status
DONE

