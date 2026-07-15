# EVMEventLake Node SDK

An embedded TypeScript SDK that incrementally copies every ABI-defined event
from one EVM contract into SQLite or PostgreSQL, then exposes deterministic
database-only queries.

The SDK performs one finite synchronization run for each explicit `update()`
call. It does not create polling loops, background workers, WebSocket listeners,
servers, analytics, or business-specific “recent blocks” behavior.

## Install from GitHub

This package is not published to npm. Install a semantic version tag or immutable
commit directly from GitHub:

```bash
pnpm add github:xzsean666/EVMEventLake-Node-SDK#v0.1.0
```

```bash
pnpm add github:xzsean666/EVMEventLake-Node-SDK#<full-commit-sha>
```

Do not pin production applications to `main`, because it can resolve to a
different build later. Node.js 22 or newer is required.

## Quick start

```ts
import { EVMEventLake } from "@evm-event-lake/node-sdk";

const eventLake = await EVMEventLake.create({
  database: "sqlite://events.db",
  rpcUrls: ["https://rpc-one.example", "https://rpc-two.example"],
  chainId: 1,
  contractAddress: "0x0000000000000000000000000000000000000000",
  abi: contractAbi,
  startBlock: 12_345_678n,
});

try {
  const update = await eventLake.update({
    toBlock: 23_000_000n,
    blockRange: 2_000,
  });

  const transfers = await eventLake.events.findMany({
    where: {
      eventSignature: "Transfer(address,address,uint256)",
      indexedParameters: {
        to: "0x1111111111111111111111111111111111111111",
      },
    },
    order: "ascending",
    limit: 100,
  });

  console.log(update, transfers.items);
} finally {
  await eventLake.close();
}
```

`create()` initializes storage without requiring a working RPC endpoint.
`update()` validates endpoint chain IDs, retries and fails over between HTTP RPC
endpoints, and adaptively splits `eth_getLogs` ranges when providers reject a
large request. Logs and synchronization progress commit atomically.

## Public lifecycle

- `EVMEventLake.create(options)` initializes one chain and contract target.
- `eventLake.update(options?)` runs one incremental synchronization operation.
- `eventLake.getSyncStatus()` reads the durable local cursor without RPC.
- `eventLake.events.findMany(query?)` returns cursor-paginated events.
- `eventLake.events.findFirst(query?)` returns the first matching event.
- `eventLake.close()` cancels an active update and releases owned resources.

Queries support block number/range, transaction hash, event name, full event
signature, and exact indexed parameter filters. Unknown or decode-failed logs
remain stored with their raw topics and data.

## Caller-owned scheduling and recent blocks

Applications decide when to call `update()`. Put it in your own cron job, worker,
or loop if continuous operation is required.

“Recent N blocks” is also caller logic:

```ts
const status = await eventLake.getSyncStatus();

if (status.syncedThroughBlock !== null) {
  const count = 100n;
  const calculatedStart = status.syncedThroughBlock - count + 1n;
  const fromBlock =
    calculatedStart > status.startBlock ? calculatedStart : status.startBlock;

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

## Storage

- SQLite: `sqlite://events.db` for embedded and low-concurrency use.
- PostgreSQL: `postgresql://user:password@host:5432/database` for shared or
  multi-process use.

The SDK applies its own forward migrations. It does not provision PostgreSQL or
create missing parent directories for SQLite files.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Specification](docs/SPEC.md)
- [Build, usage, and verification](docs/BUILD.md)
- [External dependency documentation](docs/EXTERNAL_DOCS.md)
- [Current implementation handoff](docs/nextsession.md)

Development and verification:

```bash
pnpm install --frozen-lockfile
pnpm run verify
pnpm run test:git-install
```

Live RPC tests are opt-in; see `docs/BUILD.md` for the fixed Base USDC sample.

[`example/`](example/README.md) is a standalone consumer project with its own
pnpm boundary. It installs the SDK from GitHub and exercises the public
TypeScript/runtime API, local RPC failover and range splitting, SQLite
persistence, queries, pagination, offline reads, observability, and lifecycle
behavior without importing this repository's source or workspace packages.
