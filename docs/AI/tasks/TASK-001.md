# TASK-001: EVM Infrastructure Migration: Rebase on evm-call (Highest Priority - 换底座)

## Objective
Rebase the EVM communication and log streaming foundation of EVMEventLake onto `evm-call` (`git+https://github.com/xzsean666/evm-call.git`), replacing redundant custom RPC transport and pooling with `evm-call`'s resilient RPC pool, stepped backoff cooldowns, and adaptive log streaming (`getLogsChunked` / `iterateLogs`).

## Scope
- Ensure `package.json` installs and resolves `"evm-call": "github:xzsean666/evm-call"`.
- Refactor `src/rpc/` to integrate with `evm-call` (`createEvmCallClient`, `EvmRpcPool`):
  - Delegate endpoint rotation, cooldown management, and chain ID verification to `evm-call`.
  - Maintain typed error compatibility with `EVMEventLakeErrors`.
- Refactor `src/synchronization/` to integrate with `evm-call`'s log fetcher (`getLogsChunked` / `iterateLogs`):
  - Translate `evm-call`'s strongly-typed `EvmLog` records into EVMEventLake's raw log and ABI decoding pipeline.
  - Retain atomic contiguous range commits in `storage`.
- Update unit and integration tests to verify successful end-to-end synchronization through `evm-call`.

## Allowed Files
- `package.json`
- `pnpm-lock.yaml`
- `src/rpc/**/*`
- `src/synchronization/**/*`
- `tests/unit/rpc/**/*`
- `tests/integration/**/*`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-001.md`

## Dependencies
- TASK-000 (Core V1 SDK Implementation - DONE).

## Inputs and Outputs
- **Inputs**: EVM chain ID, contract address, RPC URLs, block ranges.
- **Outputs**: High-resilience event log ingestion powered directly by `evm-call` with zero redundant RPC plumbing.

## Acceptance Criteria
- [x] `evm-call` is declared and resolved from GitHub in `package.json`.
- [x] RPC communication and endpoint pooling delegate to `evm-call`.
- [x] Adaptive log retrieval leverages `evm-call`'s `getLogsChunked` / `iterateLogs`.
- [x] All unit and integration tests compile and pass (`pnpm run test`).
- [x] Existing storage commits, checkpoints, and cursor monotonicity invariants are preserved.

## Verification Commands
```bash
pnpm run typecheck
pnpm run test:unit
pnpm run test:integration
pnpm run verify
```

## Risks and Assumptions
- Ensure type mapping between `evm-call`'s `EvmLog` and EVMEventLake's `StoredRawLogInput` handles BigInt and hex string topics losslessly.
- Maintain existing public configuration options (`rpcUrls`, `rpc.requestTimeoutMs`, etc.) by mapping them to `evm-call`'s client configuration.
- **Non-blocking evm-call enhancement**: If `evm-call` requires any missing methods, options, or bug fixes, refer to [`docs/AI/CONTEXT_EVM_CALL.md`](../CONTEXT_EVM_CALL.md) to modify `/ssd0/git/evm-call`, push to GitHub, and update the pinned hash in `package.json`. Do not get blocked.

## Status
DONE

