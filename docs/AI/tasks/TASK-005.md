# TASK-005: Universal Client Integration and Frontend dApp Example

## Objective
Verify end-to-end isomorphic client usage across browser and Node.js environments, proving that frontend dApp developers and backend engineers use 100% identical API patterns (`create()`, `update()`, `events.findMany()`, `getSyncStatus()`, `close()`), and provide a maintained frontend example.

## Scope
- Create a standalone browser example in `examples/07-browser-indexeddb/` demonstrating:
  - Bundler-free or Vite-based frontend application importing `EVMEventLake`.
  - Initializing `EVMEventLake.create({ chainId, contractAddress, abi, rpcUrls, database: "idb://uniswap-v3-pool" })`.
  - Triggering an incremental synchronization run (`await lake.update()`).
  - Offline event search across blocks and indexed parameters with cursor pagination.
  - Viewing live sync status (`lake.getSyncStatus()`).
- Add documentation in `docs/SPEC.md` and `docs/BUILD.md` describing frontend usage and browser support.
- Add an automated browser smoke test (e.g. using Vitest with `@vitest/browser` or Node simulation).

## Allowed Files
- `examples/07-browser-indexeddb/**/*`
- `package.json`
- `README.md`
- `docs/SPEC.md`
- `docs/BUILD.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-005.md`

## Dependencies
- TASK-004 (Storage Contract Parity Testing for IndexedDB).

## Inputs and Outputs
- **Inputs**: Universal `@evm-event-lake/node-sdk` package, browser HTML/JS entrypoint.
- **Outputs**: Working browser example and verified end-to-end integration proving identical frontend and backend ergonomics.

## Acceptance Criteria
- [x] Browser example boots up without bundler errors or Node module polyfill errors.
- [x] Synchronization writes event logs into browser IndexedDB.
- [x] Querying events works offline without an active network connection.
- [x] API usage is completely identical to backend examples (`examples/01-erc20-basic.ts`).

## Verification Commands
```bash
pnpm run verify
```

## Risks and Assumptions
- Browser RPC calls must use endpoints with CORS enabled (e.g., standard public RPC endpoints or proxy).

## Status
DONE
