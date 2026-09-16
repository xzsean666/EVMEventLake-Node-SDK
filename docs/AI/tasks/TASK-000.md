# TASK-000: Core V1 SDK Implementation

## Objective
Build the foundational `@evm-event-lake/node-sdk` embeddable TypeScript library, implementing single-contract target event synchronization, SQLite and PostgreSQL storage adapters, HTTP JSON-RPC adaptive fetching, reorg rewind, and offline database queries.

## Scope
- ESM package foundation, configuration validation, target identity, and typed errors.
- ABI catalog, deterministic event decoding, and bigint-safe lossless value codec.
- Kysely-based dual storage engine with SQLite (`better-sqlite3`, WAL mode) and PostgreSQL (`pg` pool).
- HTTP JSON-RPC multi-endpoint pool with eager/lazy chain ID verification, retry, cooldown, and failover.
- One-shot synchronization engine (`update()`), adaptive range splitting, atomic commits, lease locking, and cancellation.
- Checkpoint-based reorg detection and bounded rewind.
- Database-only query API (`events.findMany`, `events.findFirst`) with AND filters and cursor pagination.
- Full test suite: unit tests, storage contract tests, integration tests, real PostgreSQL 18.4 validation, and clean Git installation smoke tests.

## Allowed Files
- `package.json`, `tsconfig.json`, `tsconfig.build.json`, `pnpm-lock.yaml`, `eslint.config.js`
- `src/**/*`
- `tests/**/*`
- `scripts/**/*`
- `example/**/*`
- `examples/**/*`
- `README.md`
- `docs/**/*`

## Dependencies
None (initial milestone).

## Inputs and Outputs
- **Inputs**: EVM contract ABI, target chain ID, contract address, RPC URLs, database connection string.
- **Outputs**: Fully functional, tested, and verified `@evm-event-lake/node-sdk` package installable directly via GitHub.

## Acceptance Criteria
- [x] Package builds pure ESM with declarations and strict TypeScript (`tsc -p tsconfig.build.json`).
- [x] Storage contract tests pass identically across SQLite and PostgreSQL.
- [x] Real PostgreSQL 18.4 verifies all storage and query contracts in isolated temporary schemas.
- [x] Query service operates offline without importing or contacting RPC endpoints.
- [x] Adaptive range fetcher successfully handles block range limits and endpoint failovers.
- [x] Reorg handling verifies checkpoint hashes and performs clean bounded rewinds.
- [x] Standalone consumer in `example/` installs from Git commit and runs end-to-end tests successfully.
- [x] 63+ tests pass cleanly in `pnpm run test`.

## Verification Commands
```bash
pnpm run verify
pnpm run test:storage:sqlite
pnpm run test:storage:postgresql
pnpm run test:storage:postgresql:real
pnpm run test:integration
pnpm run test:git-install
```

## Risks and Assumptions
- Assumes Node.js `>=22`.
- Native binding for `better-sqlite3` verified on Linux x86_64; Windows and macOS need matrix testing.
- Live RPC tests depend on external network stability and public RPC rate limits.

## Status
DONE
