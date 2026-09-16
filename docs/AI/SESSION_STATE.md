# Session State: EVMEventLake Node SDK

Last updated: 2026-09-16  

---

### 1. 当前 Goal
全面安全、性能与逻辑正确性审计加固，以及文档规格升级（TASK-000 至 TASK-011）：在 `evm-call` 核心底座与三端存储契约对齐的基础上，彻底排查并消除大规模数据同步与多端运行时的崩溃隐患、逻辑状态不同步漏洞、浏览器同构兼容性缺陷与低效游标全表扫描，将 SDK 打造成工业级安全可靠、高性能、无 Node 专有全局依赖的生产就绪版本。

---

## 2. 当前 Task
**TASK-012: Subpath and Namespace Re-Export for evm-call Foundation SDK**
- **创建子路径模块 `src/evm-call.ts`**:
  - 全量重新导出底层底座 `export * from "evm-call"`。
  - 构建生成 `dist/evm-call.js` 与 `dist/evm-call.d.ts`。
- **配置 `package.json` Subpath Exports**:
  - 注册 `"./evm-call": { "types": "./dist/evm-call.d.ts", "import": "./dist/evm-call.js" }`。
- **根路径聚合导出 `EvmCall` 命名空间**:
  - 在 `src/index.ts` 中暴露 `export * as EvmCall from "./evm-call.js"`。
  - 确保根命名空间不泄漏 `RpcPool` 等冲突符号，保持 EventLake 原有公共 API 抽象隔离。
- **全链路用例与下游工程验证**:
  - 编写 `tests/unit/evm-call-export.test.ts` 专项单测；
  - 增强 `tests/unit/public-api.test.ts`；
  - 扩展 `example/typecheck.ts` 与 `example/test/github-installed-sdk.test.mjs`，验证独立 Git 安装与消费工程中的开箱即用体验。
- **文档与规范同步**:
  - 更新 `README.md`、`docs/SPEC.md`、`docs/AI/ARCHITECTURE.md` 与 `docs/AI/CONTEXT_EVM_CALL.md`。

---

## 3. 当前状态
**DONE** (All tasks TASK-000 through TASK-012 are completed and verified)

---

## 4. 已完成任务总览 (Master Task Registry)
1. **`TASK-000`**: Core V1 SDK Implementation (`DONE`)
2. **`TASK-001`**: EVM Infrastructure Migration (`evm-call` Rebase) (`DONE`)
3. **`TASK-002`**: Universal Packaging & Driver Decoupling (`DONE`)
4. **`TASK-003`**: IndexedDB Storage Adapter Implementation (`DONE`)
5. **`TASK-004`**: Storage Contract Parity for IndexedDB (`DONE`)
6. **`TASK-005`**: Universal Client Integration & Frontend Example (`DONE`)
7. **`TASK-006`**: License Selection & Release Tag Preparation (`DONE`)
8. **`TASK-007`**: SQLite Cross-Platform Path & URL Normalization (`DONE`)
9. **`TASK-008`**: Proxy Contract Historical Re-decoding Design (`DONE`)
10. **`TASK-009`**: RPC Batch Requesting & Adaptive Pipelining (`DONE`)
11. **`TASK-010`**: Indexed Dynamic Values & Parameter Search (`DONE`)
12. **`TASK-011`**: Comprehensive Audit Hardening & Security, Performance, and Correctness Optimization (`DONE`)
13. **`TASK-012`**: Subpath and Namespace Re-Export for evm-call Foundation SDK (`DONE`)

---

## 5. 本次 Task 修改过的文件
- `src/evm-call.ts` (新建)
- `src/index.ts`
- `package.json`
- `tests/unit/evm-call-export.test.ts` (新建)
- `tests/unit/public-api.test.ts`
- `example/typecheck.ts`
- `example/test/github-installed-sdk.test.mjs`
- `README.md`
- `docs/SPEC.md`
- `docs/AI/ARCHITECTURE.md`
- `docs/AI/CONTEXT_EVM_CALL.md`
- `docs/AI/tasks/TASK-012.md` (新建)
- `docs/AI/TASK_INDEX.md`
- `docs/AI/SESSION_STATE.md`

---

## 6. 已运行的验证命令及结果
- `pnpm run format:check`：全部文件格式匹配 Prettier（Exit code 0）。
- `pnpm run lint`：0 错误，0 警告（Exit code 0）。
- `pnpm run typecheck`：通过（Exit code 0）。
- `pnpm test tests/unit/evm-call-export.test.ts`：专项导出单测通过（Exit code 0）。
- `pnpm run test`：31 个测试套件，143 个测试全部通过（2 个外部真实环境测试跳过）（Exit code 0）。
- `pnpm run build`：编译成功生成 `dist/index.js`, `dist/index.d.ts`, `dist/evm-call.js`, `dist/evm-call.d.ts`（Exit code 0）。
- `node scripts/test-git-install.mjs`：独立临时消费工程克隆并安装 Git 提交产物，验证通过 `@evm-event-lake/node-sdk/evm-call` 与 `EvmCall` 的解构使用与类型推断（Exit code 0）。
- `pnpm run verify`：流水线五步全量验证完整通过（Exit code 0）。

---

## 7. 未解决问题
无。已完全满足下游项目零重复声明、直接复用底层 `evm-call` 基础设施的诉求。

---

## 8. 风险和假设
- 下游使用者若需要精细化控制 Tree-shaking，推荐使用子路径 `@evm-event-lake/node-sdk/evm-call`。
- 根导出保留 `EvmCall` 命名空间，顶层绝不平铺透出 `RpcPool`，确保核心 EventLake SDK 的 API 独立性与清晰度。

---

## 9. 最新维护记录
- **evm-call 底座子路径导出与命名空间复用 (TASK-012)**:
  - 新增 `src/evm-call.ts` 并注册 package.json `"./evm-call"` 子路径导出；
  - 根路径导出 `EvmCall` 命名空间；
  - 外部独立安装工程验证通过，下游完全无需安装或声明 `evm-call`。

---

## 10. 下一步计划
- 保持准备就绪状态。待用户确认后可打上 Git Tag 发布。
