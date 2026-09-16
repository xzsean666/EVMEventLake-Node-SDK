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


