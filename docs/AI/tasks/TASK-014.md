# TASK-014: Native getLogs Topic Filters Support (topic0, topic1, topic2, topic3)

## Objective
Support native EVM `eth_getLogs` topic filters (`topic0`, `topic1`, `topic2`, `topic3`) across SDK creation (`EVMEventLakeOptions`), runtime updates (`UpdateOptions`), RPC fetching (`RpcPool`, `AdaptiveLogFetcher`), and synchronization pipeline (`UpdateService`). Enable developers to specify array-based or named-topic filters to selectively sync specific events and indexed arguments from RPC nodes, drastically reducing bandwidth and log limits.

---

## Scope

### In-Scope
1. **Topic Filter Types & Normalization**:
   - Define `TopicFilterValue`: `Hex | Address | readonly (Hex | Address)[] | null`.
   - Define `TopicFilterObject`: `{ topic0?: TopicFilterValue; topic1?: TopicFilterValue; topic2?: TopicFilterValue; topic3?: TopicFilterValue }`.
   - Define `TopicFilterArray`: `readonly (TopicFilterValue | undefined)[]`.
   - Define `LogTopicsFilter`: `TopicFilterArray | TopicFilterObject`.
   - Define `NormalizedRpcTopic`: `Hex | readonly Hex[] | null`.
   - Define `NormalizedRpcTopics`: `readonly NormalizedRpcTopic[]`.
   - Implement `normalizeTopicsFilter(topics?, options?)`:
     - Normalizes both object form (`{ topic0, topic1, ... }`) and array form (`[topic0, topic1, ...]`).
     - Supports top-level convenience arguments (`topic0`, `topic1`, `topic2`, `topic3`).
     - Automatically pads 20-byte addresses to 32 bytes (`padHex(addr, { size: 32, dir: "left" })`) to match EVM indexed address topic encoding.
     - Validates 32-byte hex formats (`0x${64_hex_chars}`).
     - Trims trailing `null`s for JSON-RPC compliance.
     - Enforces max 4 topics (topic0..topic3), rejects empty inner arrays, and validates invalid hex strings with `ConfigurationValidationError`.
2. **Options Integration**:
   - Add `topics?: LogTopicsFilter` and optional `topic0..topic3` to `EVMEventLakeOptions`.
   - Add `topics?: LogTopicsFilter` and optional `topic0..topic3` to `UpdateOptions`.
   - `EVMEventLake.create(...)` configures default topics filter for the instance.
   - `update(options)` allows overriding or defaulting to the instance topics filter.
3. **RPC Ingestion Layer**:
   - `RpcPool.fetchLogs` and `fetchLogsBatch`: Pass `topics` in the `eth_getLogs` filter params when specified.
   - `AdaptiveLogFetcher`: Accepts `topics` and propagates it to all single and batch log fetch requests.
4. **Synchronization Engine**:
   - `UpdateService`: Resolves active topic filter, provisions `AdaptiveLogFetcher` with normalized topics.
   - `normalizeLogs`: Defensively validates returned logs against the active topics filter, rejecting non-matching logs with `StorageConsistencyError`.
   - Observability: Emits `topics` in logging and progress context.
5. **Testing & Documentation**:
   - Comprehensive unit tests in `tests/unit/topic-filter.test.ts`.
   - Integration tests with mock/real RPC verifying topic filter payloads.
   - Update `docs/SPEC.md` and `docs/AI/ARCHITECTURE.md`.

### Out-of-Scope
- Stored event query modifications (can be queried via existing indexed parameter / signature filters).
- Dynamic non-indexed topic filtering on RPC side (EVM RPC only filters indexed topics).

---

## Allowed Files
- `src/configuration/sdk-options.ts`
- `src/configuration/validate-sdk-options.ts`
- `src/rpc/rpc-pool.ts`
- `src/synchronization/adaptive-log-fetcher.ts`
- `src/synchronization/update-service.ts`
- `src/synchronization/synchronization-result.ts`
- `src/client/evm-event-lake.ts`
- `src/index.ts`
- `tests/unit/topic-filter.test.ts`
- `docs/SPEC.md`
- `docs/AI/ARCHITECTURE.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-014.md`

---

## Dependencies
- `TASK-000` through `TASK-013` (all completed).

---

## Inputs and Outputs
- **Input**: `topics` or `topic0..topic3` in `EVMEventLakeOptions` or `UpdateOptions`.
- **Output**: JSON-RPC `eth_getLogs` calls include standard EVM `topics` array; synchronization selectively ingests only matching events.

---

## Acceptance Criteria
1. `normalizeTopicsFilter` correctly parses array and object notations, lowercases hex values, pads 20-byte EVM addresses to 32 bytes, trims trailing nulls, and throws typed `ConfigurationValidationError` on invalid inputs.
2. `RpcPool.fetchLogs` and `RpcPool.fetchLogsBatch` serialize `topics` in the JSON-RPC `eth_getLogs` parameters.
3. `AdaptiveLogFetcher` and `UpdateService` propagate `topics` to single and batch range fetches.
4. `update({ topics })` overrides instance-level default topics for that run; omitting it uses instance default.
5. `normalizeLogs` validates incoming logs against topic filters defensively.
6. All existing 150 tests continue to pass with 0 regressions.
7. 100% typecheck, lint, and format compliance.

---

## Verification Commands
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run format:check`
- `pnpm test tests/unit/topic-filter.test.ts`
- `pnpm run test`
- `pnpm run build`
- `pnpm run verify`

---

## Status
DONE
