# EVMEventLake 示例代码库 (Examples)

本目录提供了可以直接运行、注释详尽的 TypeScript 示例代码，涵盖了使用 EVMEventLake SDK 的全部主流业务场景。

## 示例清单

| 文件                                                                     | 适用场景                        | 核心知识点                                                                                                                   | 运行命令                         |
| ------------------------------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| [`01-erc20-basic.ts`](./01-erc20-basic.ts)                               | **极简入门 / 快速上手**         | SQLite 实例初始化、ABI 定义、单次 `update` 同步、基础转账查询与实例关闭                                                      | `pnpm run example:quickstart`    |
| [`02-advanced-queries.ts`](./02-advanced-queries.ts)                     | **高级查询与游标分页**          | `findFirst`、按 `indexedParameters` 精准过滤、区块范围过滤、游标翻页（Cursor Pagination）、读取原始 Topics/Data 与解码结果   | `pnpm run example:query`         |
| [`03-continuous-sync-worker.ts`](./03-continuous-sync-worker.ts)         | **生产级常驻后台轮询服务**      | `while` 轮询循环、优雅停机（`SIGINT`/`SIGTERM` + `AbortController`）、网络错误重试、租约互斥处理、基于同步游标消费新区块事件 | `pnpm run example:worker`        |
| [`04-postgresql-storage.ts`](./04-postgresql-storage.ts)                 | **PostgreSQL 生产存储与多进程** | PostgreSQL 连接串配置、自动迁移（Schema Migrations）、分布式租约（Lease）并发互斥、无 RPC 依赖的 Web/API 只读查询服务        | `pnpm run example:postgres`      |
| [`05-observability-and-progress.ts`](./05-observability-and-progress.ts) | **监控与生命周期阶段追踪**      | 自定义结构化 `SdkLogger`、`onProgress` 阶段回调（节点校验、自适应拆分、落库原子提交、重组回滚）、`UpdateResult` 详尽统计     | `pnpm run example:observability` |
| [`06-erc721-nft-tracker.ts`](./06-erc721-nft-tracker.ts)                 | **NFT (ERC-721) 追踪**          | ERC-721 Indexed TokenId 特性、零地址判定 NFT 铸造（Mint）、单 Token 历史流转追溯、按买家地址聚合                             | `pnpm run example:nft`           |
| [`07-browser-indexeddb/`](./07-browser-indexeddb/)                       | **浏览器前端与 dApp 集成**      | 纯前端 `idb://` 模式、零 Node 原生依赖绑定、浏览器 IndexedDB 持久化缓存、离线事件检索、Vite 构建集成                         | 详见目录内说明                   |
| [`08-event-enrichment-hook.ts`](./08-event-enrichment-hook.ts)           | **业务数据富化挂钩**            | `enrichEvent` 领域数据增强计算、`additional_data` 三端持久化、复杂类型支持、查询检索与 `update` 动态覆写                     | `pnpm run example:enrichment`    |
| [`09-native-topic-filters.ts`](./09-native-topic-filters.ts)             | **原生 getLogs Topic 过滤**     | `topic0`..`topic3` 精准过滤、地址自动 32 字节补齐、`bigint`/`number`/`boolean`/`bytes32` 支持、通配符与逻辑 OR 过滤          | `pnpm run example:topics`        |
| [`10-evm-call-foundation-reuse.ts`](./10-evm-call-foundation-reuse.ts)   | **底座能力复用 (evm-call)**     | 命名空间与子路径导出、`EvmCallClient` 直接复用、内置节点列表、零额外依赖安装                                                 | `pnpm run example:evm-call`      |

---

## 快速运行

本项目要求 **Node.js 22 或更高版本**，依赖使用 **pnpm** 管理。
得益于 Node.js 22+ 的原生 TypeScript 类型剥离支持，运行示例无需安装额外的编译工具或 tsx：

```bash
# 1. 安装项目依赖并构建
pnpm install
pnpm run build

# 2. 运行任意示例（以极简入门为例）
pnpm run example:quickstart
```

也可以直接使用 Node 运行指定的 TypeScript 脚本：

```bash
node --experimental-strip-types examples/01-erc20-basic.ts
```

---

## 常见场景代码速查 (Cheatsheet)

### 1. 初始化 SQLite 实例

```ts
import { EVMEventLake } from "@evm-event-lake/node-sdk";

const eventLake = await EVMEventLake.create({
  database: "sqlite://./data/events.db",
  rpcUrls: ["https://mainnet.base.org"],
  chainId: 8453,
  contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  abi: erc20Abi,
  startBlock: 48625053n,
});
```

### 2. 执行一次增量同步 (One-shot Update)

```ts
// 同步到最新确认区块
const result = await eventLake.update();

// 或同步到指定区块
const result = await eventLake.update({ toBlock: 50_000_000n });

console.log(
  `同步完成: 新增 ${result.storedLogs} 条日志, 状态: ${result.outcome}`,
);
```

### 3. 按 indexed 参数过滤 (如查询特定收款人)

```ts
const userTransfers = await eventLake.events.findMany({
  where: {
    eventSignature: "Transfer(address,address,uint256)",
    indexedParameters: {
      to: "0xCf40563a1159bf8B8126255E5866E1A29469423C",
    },
  },
  order: "descending",
  limit: 20,
});
```

### 4. 游标分页遍历 (Cursor-based Pagination)

```ts
let cursor: string | undefined = undefined;

do {
  const page = await eventLake.events.findMany({
    where: { eventName: "Transfer" },
    limit: 50,
    order: "ascending",
    ...(cursor ? { after: cursor } : {}),
  });

  for (const event of page.items) {
    // 处理 event.arguments ...
  }

  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

### 5. 查看本地同步状态 (离线，无需网络)

```ts
const status = await eventLake.getSyncStatus();
console.log(`当前起始区块: ${status.startBlock}`);
console.log(`下一次待同步区块: ${status.nextBlock}`);
console.log(`已成功同步并确认的最高区块: ${status.syncedThroughBlock}`);
```

### 6. 自定义事件业务富化 (enrichEvent & additionalData)

```ts
const eventLake = await EVMEventLake.create({
  // ...
  enrichEvent: (context) => ({
    tier: (context.arguments as any)?.value > 1000n ? "whale" : "normal",
    syncedAt: new Date().toISOString(),
  }),
});

// 查询时直接读取业务元数据
const page = await eventLake.events.findMany({ limit: 10 });
console.log(page.items[0].additionalData); // { tier: "whale", syncedAt: "..." }
```

### 7. 原生 getLogs Topic 过滤 (topic0..topic3)

```ts
// 仅拉取命中特定收款人与特定 tokenId 的事件，节约网络带宽并绕过 RPC 日志上限
await eventLake.update({
  topic2: "0xRecipientAddress", // 20 字节地址自动补齐为 32 字节
  topic3: 12345n, // 原生 bigint 自动转换为 32 字节十六进制
});
```

### 8. 底座能力复用 (无需额外安装 evm-call)

```ts
import {
  createEvmCallClient,
  BUILTIN_BASE_RPCS,
} from "@evm-event-lake/node-sdk/evm-call";

const client = createEvmCallClient({
  chainId: 8453,
  customRpcUrls: [BUILTIN_BASE_RPCS[0]?.url ?? "https://mainnet.base.org"],
});
await client.init();
const latest = await client.findLatestBlockNumber();
console.log("Base latest block:", latest.blockNumber);
client.close();
```
