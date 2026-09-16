# TASK-012: Subpath and Namespace Re-Export for evm-call Foundation SDK

---

## 1. Objective

Enable downstream consumer projects of `@evm-event-lake/node-sdk` to seamlessly use the underlying `evm-call` foundation SDK without duplicate `package.json` dependency declarations, version mismatches, or phantom dependency errors in strict package managers like `pnpm`.

This is achieved by providing:
1. A **subpath export** (`@evm-event-lake/node-sdk/evm-call`) exposing all named exports of `evm-call` for granular, tree-shakeable imports.
2. A **root namespace export** (`EvmCall`) on `@evm-event-lake/node-sdk` for convenient single-statement aggregate importing without polluting the top-level SDK namespace.

---

## 2. Scope

- **Create `src/evm-call.ts`**: Re-export all entities from `evm-call`.
- **Update `package.json`**: Add `"./evm-call"` subpath to `exports` mapping with proper ESM `import` and TypeScript `types` paths.
- **Update `src/index.ts`**: Re-export `evm-call` as the `EvmCall` namespace.
- **Unit Test Coverage**: Create `tests/unit/evm-call-export.test.ts` testing both subpath and namespace exports.
- **Consumer Verification**: Update `example/typecheck.ts` and `example/test/github-installed-sdk.test.mjs` to ensure the subpath export works in standalone consumers.
- **Documentation**: Update `docs/SPEC.md`, `docs/AI/ARCHITECTURE.md`, `docs/AI/CONTEXT_EVM_CALL.md`, and `README.md`.

---

## 3. Allowed Files

- `src/evm-call.ts` (create)
- `src/index.ts`
- `package.json`
- `tests/unit/evm-call-export.test.ts` (create)
- `example/typecheck.ts`
- `example/test/github-installed-sdk.test.mjs`
- `docs/SPEC.md`
- `docs/AI/ARCHITECTURE.md`
- `docs/AI/CONTEXT_EVM_CALL.md`
- `docs/AI/tasks/TASK-012.md` (create)
- `docs/AI/TASK_INDEX.md`
- `docs/AI/SESSION_STATE.md`

---

## 4. Dependencies

- Completed: `TASK-000` through `TASK-011`.
- Upstream: `evm-call` (`github:xzsean666/evm-call#d7a5c16d2bcbda6255d05f1f5b745eac88f699c0`).

---

## 5. Inputs and Outputs

- **Inputs**:
  - Direct dependency on `evm-call` in `package.json`.
- **Outputs**:
  - `dist/evm-call.js` and `dist/evm-call.d.ts` generated during build.
  - Subpath `"@evm-event-lake/node-sdk/evm-call"` accessible to downstream Node.js and TypeScript callers.
  - Root namespace `EvmCall` accessible from `@evm-event-lake/node-sdk`.

---

## 6. Acceptance Criteria

1. Consumers can import directly from `@evm-event-lake/node-sdk/evm-call` (e.g. `import { EvmRpcClient, MulticallClient } from "@evm-event-lake/node-sdk/evm-call"`).
2. Consumers can import `EvmCall` from `@evm-event-lake/node-sdk` (e.g. `import { EvmCall } from "@evm-event-lake/node-sdk"`).
3. The root SDK export does not pollute its top level with implementation details or duplicate names like `RpcPool`.
4. `pnpm run verify` and `pnpm run test:git-install` pass cleanly with zero lint, type, or runtime errors.
5. All documentation updated to reflect the subpath and namespace export patterns.

---

## 7. Verification Commands

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm test tests/unit/evm-call-export.test.ts
pnpm run test
pnpm run build
pnpm run test:git-install
pnpm run verify
```

---

## 8. Status

DONE
