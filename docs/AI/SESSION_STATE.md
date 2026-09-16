# Session State: EVMEventLake Node SDK

Last updated: 2026-09-16  

---

### 1. 当前 Goal
完成全部规划任务（TASK-000 至 TASK-010）：在 `evm-call` 核心通信与日志底座就绪的基础上，完成前端（IndexedDB）与后端（SQLite/PostgreSQL）同构架构、通用打包驱动解耦、存储测试对齐、许可证与发布准备、跨平台路径规范化、代理合约历史日志重解码（`redecode`）、RPC 批量请求自适应降级（Batching & Adaptive Pipelining）以及动态参数透明哈希与非索引字段加速检索（TASK-010）。

---

## 2. 当前 Task
**TASK-010: Indexed Dynamic Values and Unindexed Parameter Search Optimization**
- 扩展 `client.events.findMany` / `findFirst` 查询选项，在 `where` 条件中支持 `unindexedParameters?: Readonly<Record<string, unknown>>`，实现非索引字段在本地数据库中的快速精准检索。
- 在 `EventQueryService` 中对 Solidity 动态索引参数（`string`、`bytes`）实现透明客户端 Keccak-256 哈希计算：调用方直接输入明文字符串（如 `{ username: "Alice" }`）或字节时，自动哈希匹配链上 Topic；同时保留对 32 字节原始 Topic 哈希查询的向下兼容。
- 在 `EventQueryService` 中对非索引参数执行 ABI 类型校验与规范化（`address`、`uint`/`int` 边界与 BigInt 校验、`bool`、`string`、`bytes`），匹配 `input.indexed !== true` 字段。
- 在 SQLite 与 PostgreSQL 底层存储适配器 `queryEvents` 中，基于 `event_parameters` 复合索引 `event_parameters_lookup (target_key, name, comparable_value, is_indexed)` 添加 `is_indexed = 0` 的查询过滤。
- 在 IndexedDB 底层存储适配器 `queryEvents` 中，基于 `by_lookup (targetKey, name, comparableValue, indexed)` 索引对非索引参数执行 `indexed = 0` 的高效多字段联合过滤。
- 在测试层面：
  - 更新 `tests/unit/event-query-validation.test.ts` 支持动态明文字符串校验。
  - 新增 `tests/unit/query/dynamic-parameter-query.test.ts` 专项单测覆盖字符串自动哈希、直接 32 字节哈希向下兼容、`bytes` 动态十六进制及 `Uint8Array` 自动哈希、复杂动态类型限制与非索引字段校验报错。
  - 在 `tests/query/query-service.contract.ts` 契约套件中新增动态索引字符串查询与非索引字段过滤测试用例，覆盖 SQLite、PostgreSQL 及 IndexedDB。
  - 在 `tests/storage-contract/storage-adapter.contract.ts` 契约套件中覆盖存储层直接非索引参数检索。
- 更新 `docs/SPEC.md` 第 13 节，规范化动态索引参数透明哈希规则与非索引参数加速索引说明。
- 执行 `pnpm run verify`，29 个测试套件全量通过，132 个测试全部通过（2 个真实环境测试跳过），格式检查、ESLint、TypeScript 类型检查和项目编译全量通过。

---

## 3. 当前状态
**DONE** (All tasks TASK-000 through TASK-010 are completed and verified)

---

## 4. 已完成任务总览 (Master Task Registry)
1. **TASK-000**: Core V1 SDK Implementation (`DONE`)
2. **TASK-001**: EVM Infrastructure Migration (`evm-call` Rebase) (`DONE`)
3. **TASK-002**: Universal Packaging & Driver Decoupling (`DONE`)
4. **TASK-003**: IndexedDB Storage Adapter Implementation (`DONE`)
5. **TASK-004**: Storage Contract Parity for IndexedDB (`DONE`)
6. **TASK-005**: Universal Client Integration & Frontend Example (`DONE`)
7. **TASK-006**: License Selection & Release Tag Preparation (`DONE`)
8. **TASK-007**: SQLite Cross-Platform Path & URL Normalization (`DONE`)
9. **TASK-008**: Proxy Contract Historical Re-decoding Design (`DONE`)
10. **TASK-009**: RPC Batch Requesting & Adaptive Pipelining (`DONE`)
11. **TASK-010**: Indexed Dynamic Values & Parameter Search (`DONE`)

---

## 5. 本次 Task 修改过的文件
- `src/query/event-query.ts`
- `src/storage/storage-models.ts`
- `src/query/event-query-service.ts`
- `src/storage/sql-storage-adapter.ts`
- `src/storage/indexeddb/indexeddb-storage-adapter.ts`
- `tests/unit/event-query-validation.test.ts`
- `tests/unit/query/dynamic-parameter-query.test.ts` (新建)
- `tests/query/query-service.contract.ts`
- `tests/storage-contract/storage-adapter.contract.ts`
- `docs/SPEC.md`
- `docs/AI/tasks/TASK-010.md`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/SESSION_STATE.md`

---

## 6. 已运行的验证命令及结果
- `pnpm run format:check`：全部文件格式匹配 Prettier（Exit code 0）。
- `pnpm run lint`：0 错误，0 警告（Exit code 0）。
- `pnpm run typecheck`：通过（Exit code 0）。
- `pnpm run test:storage:sqlite`：7 个存储契约测试全部通过（Exit code 0）。
- `pnpm run test:storage:postgresql`：7 个存储契约测试全部通过（Exit code 0）。
- `pnpm run test:storage:indexeddb`：12 个存储与查询契约测试全部通过（Exit code 0）。
- `pnpm run test`：29 个测试套件，132 个测试全部通过（2 个外部真实环境测试跳过）（Exit code 0）。
- `pnpm run build`：编译成功生成 `dist/`（Exit code 0）。
- `pnpm run verify`：全部流水线步骤完整通过（Exit code 0）。

---

## 7. 未解决问题
无。全部规划任务完成。

---

## 8. 风险和假设
- Solidity 动态类型经 Keccak-256 压缩后不可逆，链上原始 Topic 仅保留 32 字节哈希。SDK 客户端通过将查询输入哈希为对应 32 字节 Topic 与存储层比对，行为完全确定且符合 EVM 标准。

---

## 9. 最新维护记录
- **文档冗余清理与整合 (Documentation Cleanup & Consolidation)**:
  - 移除了根目录下不完整镜像存根 [`Agent.md`](file:///ssd0/git/EVMEventLake-Node-SDK/Agent.md)。
  - 移除了 `docs/AI_AGENT_PROMPT.md`（早期未维护的中文模版提示词），将其任务状态机（`TODO -> IN_PROGRESS -> REVIEW -> DONE`）及任务拆分粒度准则整合至官方工程手册 [`AGENTS.md`](file:///ssd0/git/EVMEventLake-Node-SDK/AGENTS.md)。
  - 移除了单文件跳转存根 `docs/AI/CONTEXT.md`，直接由 [`AGENTS.md`](file:///ssd0/git/EVMEventLake-Node-SDK/AGENTS.md) 对接核心底座上下文 [`docs/AI/CONTEXT_EVM_CALL.md`](file:///ssd0/git/EVMEventLake-Node-SDK/docs/AI/CONTEXT_EVM_CALL.md)。
  - 更新 [`docs/AI/ARCHITECTURE.md`](file:///ssd0/git/EVMEventLake-Node-SDK/docs/AI/ARCHITECTURE.md) 第 5 节的目录树结构，确保与实际文件系统完全一致。
  - 校验通过：`pnpm run format:check`、`pnpm run lint`、`pnpm run typecheck` 均 0 错误通过。

---

## 10. 下一步计划
- 项目全部 11 个任务及文档整合已全量完成并验证。可按需提交 git commit 或打 release 标签。
