# EVMEventLake Node SDK

An embedded TypeScript SDK that incrementally copies ABI-defined events from one EVM contract into **SQLite** or **PostgreSQL**, and provides fast, deterministic, **database-only** queries.

- **One-shot synchronization**: Every `update()` call performs one deterministic sync up to the confirmed head or `toBlock`. No hidden background threads or uncontrollable polling loops.
- **Resilient RPC transport**: Multi-endpoint failover, chain ID validation, automatic retries, and adaptive `eth_getLogs` range splitting when providers reject large queries.
- **Zero RPC queries**: All event reads (`findMany`, `findFirst`) and status checks (`getSyncStatus`) query the local database directly—fast, offline-friendly, with zero RPC rate-limit consumption.
- **Production-ready storage**: Supports embedded SQLite (`sqlite://...`) and shared PostgreSQL (`postgresql://...`) with target-scoped distributed leases to prevent concurrent write collisions.

---

## Installation

This package is installed directly from GitHub tags or immutable commit SHAs (Node.js >= 22 required):

```bash
# Install via release tag (Recommended)
pnpm add github:xzsean666/EVMEventLake-Node-SDK#v0.1.0

# Or install via full commit SHA
pnpm add github:xzsean666/EVMEventLake-Node-SDK#<full-commit-sha>
```

---

## Quick Start (极简快速上手)

Copy-paste ready example using Base Mainnet USDC:

```ts
import { EVMEventLake } from "@evm-event-lake/node-sdk";

// 1. Define event ABI (only include events you want to index)
const erc20Abi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

// 2. Initialize instance (creates tables/migrations automatically)
const eventLake = await EVMEventLake.create({
  database: "sqlite://events.db",
  rpcUrls: ["https://mainnet.base.org"],
  chainId: 8453,
  contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // Base USDC
  abi: erc20Abi,
  startBlock: 48_625_053n,
});

try {
  // 3. One-shot sync: fetches logs and commits them atomically
  const result = await eventLake.update({ toBlock: 48_625_053n });
  console.log(`Synced ${result.storedLogs} logs in ${result.durationMs}ms`);

  // 4. Query from database (instant, no RPC calls!)
  const transfers = await eventLake.events.findMany({
    where: {
      eventName: "Transfer",
      indexedParameters: {
        to: "0xCf40563a1159bf8B8126255E5866E1A29469423C",
      },
    },
    order: "descending",
    limit: 10,
  });

  console.log("Transfers:", transfers.items);
} finally {
  // 5. Always close to release database locks and connections
  await eventLake.close();
}
```

---

## Runnable Examples (可直接运行的示例)

The repository provides fully documented, standalone TypeScript examples in the [`examples/`](./examples/README.md) directory:

| Example | Description | Run Command |
| --- | --- | --- |
| [`01-erc20-basic.ts`](./examples/01-erc20-basic.ts) | Quickstart: sync & query ERC-20 transfers with SQLite | `pnpm run example:quickstart` |
| [`02-advanced-queries.ts`](./examples/02-advanced-queries.ts) | Filter by indexed params, block range, tx hash, cursor pagination | `pnpm run example:query` |
| [`03-continuous-sync-worker.ts`](./examples/03-continuous-sync-worker.ts) | Production polling worker with graceful shutdown (`SIGINT` / `AbortSignal`) | `pnpm run example:worker` |
| [`04-postgresql-storage.ts`](./examples/04-postgresql-storage.ts) | PostgreSQL setup, distributed leases & multi-process query architecture | `pnpm run example:postgres` |
| [`05-observability-and-progress.ts`](./examples/05-observability-and-progress.ts) | Structured logging & stage-by-stage progress callbacks (`onProgress`) | `pnpm run example:observability` |
| [`06-erc721-nft-tracker.ts`](./examples/06-erc721-nft-tracker.ts) | Track NFT mints (zero address) and token history with indexed `tokenId` | `pnpm run example:nft` |

---

## Common Use Cases & Code Snippets (常见场景代码速查)

### 1. Advanced Queries (多样化条件过滤)

```ts
// A. Filter by indexed parameter (exact match)
const userTransfers = await eventLake.events.findMany({
  where: {
    eventSignature: "Transfer(address,address,uint256)",
    indexedParameters: {
      to: "0x1111111111111111111111111111111111111111",
    },
  },
});

// B. Filter by block range
const rangeEvents = await eventLake.events.findMany({
  where: {
    blockNumber: {
      greaterThanOrEqual: 48_000_000n,
      lessThanOrEqual: 48_001_000n,
    },
  },
});

// C. Find by transaction hash
const txEvents = await eventLake.events.findMany({
  where: {
    transactionHash: "0xabc...",
  },
});

// D. Find first matching event (e.g. latest event)
const latestEvent = await eventLake.events.findFirst({
  where: { eventName: "Transfer" },
  order: "descending",
});
```

### 2. Cursor Pagination (游标翻页遍历)

Use `limit`, `order`, and `after` cursor for deterministic, high-performance pagination:

```ts
let cursor: string | undefined = undefined;

do {
  const page = await eventLake.events.findMany({
    where: { eventName: "Transfer" },
    limit: 50,
    order: "ascending",
    ...(cursor ? { after: cursor } : {}),
  });

  for (const record of page.items) {
    console.log(record.blockNumber, record.arguments);
  }

  cursor = page.nextCursor ?? undefined;
} while (cursor);
```

### 3. Continuous Background Worker (常驻后台轮询与优雅停机)

The caller controls execution cadence and process lifecycle. Pass `signal: AbortSignal` to support instant cancellation:

```ts
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

while (!controller.signal.aborted) {
  try {
    // Calling update() without toBlock syncs to the latest confirmed head
    const update = await eventLake.update({ signal: controller.signal });
    console.log(`Synced through ${update.toBlock} (${update.storedLogs} new logs)`);
  } catch (error) {
    if (error instanceof OperationCancelledError) break;
    console.error("Sync error, retrying next loop:", error);
  }

  await sleep(5_000, controller.signal).catch(() => {});
}

await eventLake.close();
```

### 4. Shared PostgreSQL & Read-Only API Servers (生产多进程读写分离)

In production, run one syncing worker while your API servers query the database with **zero** RPC configuration:

```ts
// Web / API Process: Only needs PostgreSQL connection, NO RPC needed!
const readOnlyLake = await EVMEventLake.create({
  database: "postgresql://user:pass@db.internal:5432/eventlake",
  rpcUrls: [], // Empty! Read queries never hit RPC
  chainId: 8453,
  contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  abi: erc20Abi,
  startBlock: 48_625_053n,
});

// Fast, local DB read with zero rate limit risk
const events = await readOnlyLake.events.findMany({ limit: 100 });
```

### 5. Observability & Progress Tracking (实时进度与结构化日志)

```ts
const eventLake = await EVMEventLake.create({
  // ... options
  observability: {
    logger: {
      log: (event) => console.log(`[${event.level}] ${event.event}: ${event.message}`),
    },
    onProgress: (event) => {
      // stages: "update_started" | "endpoint_validated" | "range_fetch_started"
      //         | "range_split" | "range_committed" | "reorg_rewind" | "update_completed"
      console.log(`Stage changed: ${event.stage}`);
    },
  },
});
```

### 6. Durable Local Status & "Recent Blocks" Window

Inspect sync progress without network access:

```ts
const status = await eventLake.getSyncStatus();
console.log(`Next block to sync: ${status.nextBlock}`);
console.log(`Synced through block: ${status.syncedThroughBlock}`);

// Calculate recent N blocks window
if (status.syncedThroughBlock !== null) {
  const windowSize = 50n;
  const fromBlock = status.syncedThroughBlock > windowSize
    ? status.syncedThroughBlock - windowSize + 1n
    : status.startBlock;

  const recentEvents = await eventLake.events.findMany({
    where: {
      blockNumber: {
        greaterThanOrEqual: fromBlock,
        lessThanOrEqual: status.syncedThroughBlock,
      },
    },
  });
}
```

### 7. Custom Event Enrichment & Additional Data (`enrichEvent` & `additionalData`)

Pass an asynchronous or synchronous `enrichEvent` function at SDK initialization or per `update()` call. The enricher receives the full raw and decoded event context (`EventEnrichmentContext`), and its returned JSON object is persistently saved in the database (`additional_data`) across SQLite, PostgreSQL, and IndexedDB, available on `record.additionalData`:

```ts
const lake = await EVMEventLake.create({
  // ... target options
  enrichEvent: async (event) => {
    // Access decoded arguments, eventName, txHash, blockNumber, etc.
    return {
      category: "defi",
      syncedAt: new Date().toISOString(),
      tx: event.transactionHash,
    };
  },
});

await lake.update();

// Query returns both decoded arguments and persistent additionalData
const record = await lake.events.findFirst({ where: { eventName: "Transfer" } });
console.log(record?.arguments);      // Decoded ABI parameters
console.log(record?.additionalData); // { category: "defi", syncedAt: "...", tx: "0x..." }
```

### 8. Native getLogs Topic Filtering (原生 getLogs topic0~topic3 过滤)

Filter logs directly at the EVM JSON-RPC node layer to drastically reduce network bandwidth and avoid RPC log limit errors. Supports `Hex` (32-byte topics & 20-byte addresses), `bigint`, `number`, `boolean`, logical OR arrays, and wildcard omissions:

```ts
// A. Set default topic filter on instance creation (omit topic0 to sync any event):
const lake = await EVMEventLake.create({
  // ... target options
  // Target only specific indexed topics; omitted topics (e.g. topic0) become wildcards:
  topic1: "0x1111111111111111111111111111111111111111", // 20-byte addresses automatically padded to 32 bytes!
  topic3: 12345n,                                       // Native bigint (e.g. ERC721 tokenId) encoded to 32-byte hex!
});

// B. Or override per update() call using array or object format:
await lake.update({
  // Standard JSON-RPC array format with logical OR, numbers, booleans, and wildcards:
  topics: [
    ["0xddf252ad...", "0x8c5be1e5..."], // topic0: Transfer OR Approval
    null,                               // topic1: Wildcard (any sender)
    "0x2222222222222222222222222222222222222222", // topic2: Specific recipient
    42,                                 // topic3: Safe number encoded to 32 bytes
  ],
});
```

---

## Public API Reference

| Method / Property | Description |
| --- | --- |
| `EVMEventLake.create(options)` | Asynchronously initializes configuration, validates ABI, runs database migrations. Does not require RPC network connection. |
| `eventLake.update(options?)` | Runs one incremental synchronization pass. Validates RPC endpoints, adaptively splits ranges, commits atomically. |
| `eventLake.getSyncStatus()` | Returns current local cursor (`nextBlock`, `syncedThroughBlock`, `latestCheckpoint`, `hasActiveLease`) from database only. |
| `eventLake.events.findMany(query?)` | Returns paginated event records matching `where` filters (`eventName`, `eventSignature`, `blockNumber`, `transactionHash`, `indexedParameters`). |
| `eventLake.events.findFirst(query?)` | Returns the first matching event record or `null`. |
| `eventLake.close()` | Cancels active synchronization, releases distributed database leases and closes database connections. |

---

## Foundation SDK Re-use (`evm-call` 底座能力复用)

下游项目依赖 `@evm-event-lake/node-sdk` 时，可**直接复用底层 `evm-call` 基础设施**，无需在项目自身的 `package.json` 中重复声明或安装 `evm-call`，彻底杜绝多版本冲突与双重依赖维护：

### 1. 子路径导入 (Subpath Import - 推荐 🌟)
开箱即用支持细粒度、Tree-shaking 友好的按需引用：
```ts
import {
  EvmCallClient,
  CooldownTracker,
  MULTICALL3_ADDRESS,
  normalizeEvmLog,
} from "@evm-event-lake/node-sdk/evm-call";

// 创建轻量级 RPC 客户端或执行 Multicall
const client = new EvmCallClient({
  chainId: 8453,
  customRpcUrls: ["https://mainnet.base.org"],
});
await client.init();
```

### 2. 根命名空间导入 (Root Namespace Import)
通过根导出的 `EvmCall` 命名空间聚合访问：
```ts
import { EVMEventLake, EvmCall } from "@evm-event-lake/node-sdk";

const tracker = new EvmCall.CooldownTracker();
```

---

## Storage Options

- **SQLite**: `sqlite://events.db` or `sqlite:///var/data/events.db` (single-process / embedded Node.js).
- **PostgreSQL**: `postgresql://user:password@host:5432/database` (multi-process / shared database with distributed lease).
- **IndexedDB**: `idb://my-lake` or `indexeddb://my-lake` (browser dApps, frontend SPAs, offline client cache).

---

## Documentation

- [Examples Directory (`examples/`)](./examples/README.md)
- [Architecture Guide (`docs/AI/ARCHITECTURE.md`)](docs/AI/ARCHITECTURE.md)
- [Specification (`docs/SPEC.md`)](docs/SPEC.md)
- [Build & Verification (`docs/BUILD.md`)](docs/BUILD.md)
- [External Dependencies (`docs/EXTERNAL_DOCS.md`)](docs/EXTERNAL_DOCS.md)
- [AI Agent Roadmap & Tasks (`docs/AI/TASK_INDEX.md`)](docs/AI/TASK_INDEX.md)

---

## License

[MIT License](LICENSE) © 2026 EVMEventLake Contributors


