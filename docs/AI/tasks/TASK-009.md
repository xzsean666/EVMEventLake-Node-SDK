# TASK-009: RPC Batch Requesting and Adaptive Pipelining Optimization

## Objective
Enhance the synchronization engine with JSON-RPC batching and adaptive request pipelining for historical synchronization, improving sync throughput on providers that support JSON-RPC batching without violating error classification or single-range transaction atomicity.

## Scope
- Investigate HTTP JSON-RPC batching support (`eth_getLogs` array payload).
- Add configurable batch size policy in RPC options (e.g. `batchSize: number`, default `1` for pure compatibility).
- Maintain rigorous error classification: if a batch request fails with provider payload limits or partial failure, decompose into individual requests.
- Retain atomic contiguous range commits in the storage engine.
- Benchmark throughput improvements on dense and sparse event intervals across Node.js and browser environments.

## Allowed Files
- `src/rpc/**/*`
- `src/synchronization/**/*`
- `src/configuration/**/*`
- `tests/unit/rpc/**/*`
- `tests/integration/**/*`
- `docs/SPEC.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-009.md`

## Dependencies
- TASK-001 (EVM Infrastructure Migration: Rebase on evm-call).

## Inputs and Outputs
- **Inputs**: Multiple contiguous sub-range requests to be fetched over HTTP.
- **Outputs**: Batched HTTP JSON-RPC execution, reduced round-trip latency, and deterministic log aggregation.

## Acceptance Criteria
- [x] Batched JSON-RPC requests correctly group multiple `eth_getLogs` calls when enabled.
- [x] Provider errors on batches are transparently unpacked and classified without dropping logs.
- [x] Endpoints that reject batch requests automatically fall back to single-request mode.
- [x] Commits remain strictly atomic and sequential in the database.
- [x] All existing RPC retry, cooldown, and failover unit tests pass.

## Verification Commands
```bash
pnpm run test:unit
pnpm run test:integration
pnpm run verify
```

## Risks and Assumptions
- Not all RPC node providers support identical JSON-RPC batch limits.
- Default configuration must remain safe (`batchSize: 1` or conservative auto-detection).

## Status
DONE
