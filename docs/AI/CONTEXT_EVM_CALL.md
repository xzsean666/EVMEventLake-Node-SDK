# evm-call 底座协同与联调上下文 (EVM-Call Context & Workflow Guide)

本文档记录了 EVMEventLake Node SDK 与其核心底层依赖 `evm-call` 的协同开发规范。

---

## 1. 核心准则：不要被底层底座卡住 (Never Get Blocked by Foundation)

- `evm-call` 是 EVMEventLake 的 **EVM 基础设施底座**。
- 本地源码路径：**`/ssd0/git/evm-call`**
- GitHub 远端仓库：**`https://github.com/xzsean666/evm-call.git`**
- **非阻塞原则**：在 EVMEventLake 开发过程中，如果发现 `evm-call` 缺少某些方法、类型定义、事件属性、配置选项，或者存在 Bug / 性能瓶颈，**严禁在 SDK 层停滞或绕弯折衷**。直接前往 `/ssd0/git/evm-call` 补充或修复，然后更新本仓库引用的 Git commit hash。

---

## 2. 标准联调与更新流程

当需要修改或增强 `evm-call` 时，请严格按照以下 5 步流程执行：

### 第一步：在 `/ssd0/git/evm-call` 目录进行修改
1. 切换/确认当前工作目录为 `/ssd0/git/evm-call`：
   ```bash
   # 检查当前状态
   git status
   ```
2. 进行所需的源码调整、类型扩展或功能增强（如 `src/domain/`, `src/execution/`, `src/pool/` 等）。

### 第二步：在 `/ssd0/git/evm-call` 编译与测试验证
必须确保修改后的 `evm-call` 能够成功构建且通过自身测试：
```bash
# 运行类型检查与构建输出 (生成 dist/)
pnpm run build

# 运行自动化测试
pnpm test
```

### 第三步：提交并推送至 GitHub
按照全局账号路由守则（`/ssd0/git` 匹配账号 `xzsean666`），完成提交并推送到 GitHub `main` 分支：
```bash
git add .
git commit -m "feat/fix: <简要描述修改内容>"
git push origin main
```
获取最新的完整 commit hash：
```bash
git rev-parse HEAD
# 例如输出: a1b2c3d4e5f6...
```

### 第四步：在 EVMEventLake 中更新依赖 Hash
回到 `/ssd0/git/EVMEventLake-Node-SDK` 目录，通过 pnpm 更新指向新的 commit hash：
```bash
pnpm add git+https://github.com/xzsean666/evm-call.git#<commit-hash>
```
这会自动拉取最新提交，触发 `evm-call` 的 `prepare` 脚本编译 `dist/`，并更新 `package.json` 与 `pnpm-lock.yaml`。

### 第五步：在 EVMEventLake 运行验证
验证新特性在 EVMEventLake 中的编译与测试：
```bash
pnpm run typecheck
pnpm run test
```

---

## 3. 本地快速热联调技巧 (可选)

在开发复杂功能或频繁调试阶段，如果不想频繁提交 git commit，可临时使用软链接：
```bash
# 在 EVMEventLake 目录中临时 link 本地 evm-call
pnpm link /ssd0/git/evm-call
```
> **注意**：本地联调完成后，在任务交接与标记 DONE 前，**必须**将修改推送到 `evm-call` 的 GitHub 仓库，并在 `package.json` 中换回带有最新 commit hash 的 GitHub 引用，确保仓库具备随时从干净环境安装的能力。

---

## 4. 常见场景排查与应对

| 现象 / 需求 | 处理方式 |
| --- | --- |
| `EvmLog` 缺少字段或类型不匹配 | 在 `/ssd0/git/evm-call/src/domain/log.ts` 中扩展，并在 `export * from "./domain"` 中导出。 |
| 日志切片参数需要更精细控制 | 在 `/ssd0/git/evm-call/src/execution/chunked.ts` 中增补 options 选项并暴露。 |
| RPC Pool 冷却策略需要特殊定制 | 在 `/ssd0/git/evm-call/src/pool/` 中增加对应的策略配置项。 |
| `缺少某个 JSON-RPC 原生方法封装` | 在 `/ssd0/git/evm-call/src/transport/` 或 client 中增加便捷调用入口。 |

---

## 5. 下游消费项目复用规范 (Downstream Consumer Re-export)

为了避免其他使用 `@evm-event-lake/node-sdk` 的项目在自身的 `package.json` 中重复声明 `evm-call`（导致维护双份 git commit hash 或在 pnpm 隔离环境下产生幽灵依赖报错），本 SDK 已完整 Re-export 底座：

1. **子路径导出（首选，细粒度）**：
   ```ts
   import {
     EvmCallClient,
     CooldownTracker,
     MULTICALL3_ADDRESS,
     normalizeEvmLog,
   } from "@evm-event-lake/node-sdk/evm-call";
   ```
2. **根命名空间导出（聚合快捷方式）**：
   ```ts
   import { EVMEventLake, EvmCall } from "@evm-event-lake/node-sdk";
   ```
3. **维护原则**：
   - 下游项目严禁在自身 `package.json` 单独引入 `evm-call`，统一通过 SDK 锁定底层版本；
   - 保持 SDK 根路径顶层符号干净，不污染内部实现，防止 `RpcPool` 等同名类冲突。
