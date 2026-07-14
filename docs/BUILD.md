# EVMEventLake Node SDK Build and Usage Guide

Version: 1.0

Status: Implementation underway

## 1. Current Repository State

Step 4 was approved on 2026-07-14. The ESM package foundation, strict
TypeScript configuration, public errors, observability contracts, configuration
validation, target identity, ABI catalog, anonymous and standard event decoding,
lossless value codec, SQLite/PostgreSQL storage adapters, lockfile, and
unit/contract tests are implemented. Later RPC, synchronization, query,
integration, and release modules remain in progress.

## 2. Planned Toolchain

| Tool | Planned requirement | Purpose |
| --- | --- | --- |
| Node.js | 22 or newer; development verified with 24.2.0 | Runtime |
| TypeScript | 5.9.3 | Source and declarations |
| pnpm | 10.12.1 | Development and consumer examples |
| viem | 2.55.2 | HTTP EVM RPC and ABI primitives |
| Kysely | 0.29.3 | Typed SQL construction and dialect boundary |
| better-sqlite3 | 12.11.1 | SQLite adapter |
| pg | 8.22.0 | PostgreSQL adapter |
| Vitest | 4.1.10 | Unit and integration tests |

The exact versions are pinned in `package.json` and `pnpm-lock.yaml`.

## 3. Package and Distribution Model

### 3.1 No npm registry publication

The SDK is not published to the npm registry.

The package manifest:

- Uses the stable package name `@evm-event-lake/node-sdk`.
- Marks registry publication as disabled with `private: true`.
- Declares ESM runtime and type exports.
- Uses the standard `prepare` lifecycle for Git dependency installation.
- Requires Node.js 22 or newer.

No npm token or registry publish workflow is required.

### 3.2 Install from GitHub

Repository:

```text
https://github.com/xzsean666/EVMEventLake-Node-SDK
```

Planned pnpm installation from a release tag:

```bash
pnpm add github:xzsean666/EVMEventLake-Node-SDK#v0.1.0
```

Planned installation from an immutable commit:

```bash
pnpm add github:xzsean666/EVMEventLake-Node-SDK#<full-commit-sha>
```

Use a semantic version tag or full commit in production. Installing directly
from `main` is only suitable for temporary development because later installs
can resolve to different code.

### 3.3 Git-install build contract

The future package must work when the package manager:

1. Clones the requested Git reference.
2. Installs the package's build dependencies.
3. Runs the package preparation lifecycle.
4. Produces JavaScript and TypeScript declarations.
5. Links the built package into the consumer project.

Release verification must test this exact path from a clean temporary consumer
project. A local workspace link is not sufficient release evidence.

## 4. Planned Local Development Setup

After Step 4 creates the package, the expected setup will be:

```bash
corepack enable
pnpm install --frozen-lockfile
```

The repository must commit `pnpm-lock.yaml` and pin the package manager version
through the package manifest.

`pnpm-workspace.yaml` explicitly allows the `better-sqlite3` native install
script. No other dependency build script is allowlisted by default.

Expected quality commands:

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

Expected full verification command:

```bash
pnpm run verify
```

`verify` should compose deterministic local checks. It must not run paid or live
RPC tests unless an explicit live-test flag is set.

## 5. Planned Build Output

The build must produce a `dist/` package surface containing:

- Runtime JavaScript.
- Source maps.
- TypeScript declaration files.
- Only documented public exports.

The package must not expose internal adapter or synchronization files through
accidental deep imports. Consumers import from the package root unless a
documented subpath export is intentionally added.

Whether `dist/` is committed must be decided during implementation based on the
verified Git-install lifecycle. The release invariant is that a clean tag
installs successfully; source layout preference is secondary.

## 6. Database Preparation

### 6.1 SQLite

Use SQLite for local applications, scripts, tests, and low-concurrency embedded
workloads.

Planned relative database URL:

```text
sqlite://events.db
```

Planned absolute database URL:

```text
sqlite:///var/lib/my-application/events.db
```

The SQLite file may be created by SDK initialization. Its parent directory must
already exist and be writable by the application process.

### 6.2 PostgreSQL

Use PostgreSQL when multiple processes or targets share the database, when
write volume is larger, or when operational database tooling is required.

Planned URL form:

```text
postgresql://eventlake:password@127.0.0.1:5432/eventlake
```

The database and user must exist before SDK creation. The SDK owns its tables
and migrations but does not provision the PostgreSQL server or database.

### 6.3 Migrations

SDK creation applies required forward migrations before returning.

- Migration failure stops creation.
- Migrations do not silently delete event data.
- SQLite and PostgreSQL migration histories remain behaviorally aligned.
- A future breaking schema migration requires release notes and a tested upgrade
  path.

## 7. Planned Basic Usage

The intended public lifecycle is explicit asynchronous creation, one-shot
update, database query, and close.

```ts
import { EVMEventLake } from "@evm-event-lake/node-sdk";

const eventLake = await EVMEventLake.create({
  database: "sqlite://events.db",
  rpcUrls: [
    "https://rpc-one.example",
    "https://rpc-two.example",
  ],
  chainId: 1,
  contractAddress: "0x0000000000000000000000000000000000000000",
  abi: contractAbi,
  startBlock: 12_345_678n,
});

try {
  const updateResult = await eventLake.update({
    toBlock: 23_000_000n,
    blockRange: 2_000,
  });

  const events = await eventLake.events.findMany({
    where: {
      eventName: "Transfer",
      blockNumber: {
        greaterThanOrEqual: 22_990_000n,
        lessThanOrEqual: 23_000_000n,
      },
    },
    order: "ascending",
    limit: 100,
  });

  console.log(updateResult, events);
} finally {
  await eventLake.close();
}
```

This is a planned usage contract, not current runnable code.

## 8. Caller-Owned Continuous Update Pattern

Continuous operation belongs to the caller. A caller may place one-shot updates
inside its own loop, cron job, or worker.

Conceptual example:

```ts
while (!shutdownSignal.aborted) {
  try {
    await eventLake.update({ signal: shutdownSignal });
  } catch (error) {
    applicationLogger.error({ error }, "event update failed");
  }

  await applicationSleep(updateIntervalMs, shutdownSignal);
}
```

The SDK must not provide `startPolling`, `watch`, or an internal equivalent.
The caller decides delay, backoff, supervision, and shutdown behavior.

## 9. Caller-Owned Recent-Block Query Pattern

“Recent N blocks” is business logic because “recent” depends on whether the
application means chain head, confirmed head, or locally synchronized head.

For a local synchronized-window query, the caller uses database sync status:

```ts
const status = await eventLake.getSyncStatus();

if (status.syncedThroughBlock !== null) {
  const recentBlockCount = 100n;
  const earliestAvailableBlock = status.startBlock;
  const calculatedFromBlock =
    status.syncedThroughBlock - recentBlockCount + 1n;
  const fromBlock =
    calculatedFromBlock > earliestAvailableBlock
      ? calculatedFromBlock
      : earliestAvailableBlock;

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

This calculation remains in caller code. The query itself remains a normal,
composable database range query.

## 10. Planned Query Examples

### 10.1 Transaction hash

```ts
const transactionEvents = await eventLake.events.findMany({
  where: {
    transactionHash: "0x...",
  },
});
```

### 10.2 Exact event signature

Use the full signature when event names are overloaded.

```ts
const transfers = await eventLake.events.findMany({
  where: {
    eventSignature: "Transfer(address,address,uint256)",
  },
});
```

### 10.3 Indexed parameters

```ts
const receivedTransfers = await eventLake.events.findMany({
  where: {
    eventSignature: "Transfer(address,address,uint256)",
    indexedParameters: {
      to: "0x1111111111111111111111111111111111111111",
    },
  },
  limit: 100,
});
```

Indexed parameter matching is exact in V1. Dynamic indexed values are queried
by topic hash.

### 10.4 Cursor pagination

```ts
const firstPage = await eventLake.events.findMany({
  where: { eventName: "Transfer" },
  order: "ascending",
  limit: 100,
});

const secondPage = await eventLake.events.findMany({
  where: { eventName: "Transfer" },
  order: "ascending",
  limit: 100,
  after: firstPage.nextCursor,
});
```

## 11. Configuration Guidance

### 11.1 Keep secrets outside source

The SDK accepts explicit options. Applications may read database and RPC URLs
from environment variables, secret managers, configuration files, or another
caller-owned system.

The SDK itself must not read scattered environment variables implicitly.

### 11.2 Multiple RPC endpoints

Provide endpoints for the same chain only. The SDK validates each endpoint
before use and excludes chain mismatches.

Prefer independent providers where possible. Several URLs backed by one account
or infrastructure region may fail together even though they look distinct.

### 11.3 Confirmation policy

The default confirmation count is a convenience, not universal finality. Set a
chain-appropriate value for production or pass an explicit `toBlock` selected
by the caller.

### 11.4 Block range

Start with the default preferred range. Override it when a provider or dense
contract benefits from a different initial request size. Adaptive splitting is
a safety mechanism, not a reason to choose an unnecessarily large range.

## 12. Planned Test Commands

Expected focused suites:

```bash
pnpm run test:unit
pnpm run test:storage:sqlite
pnpm run test:storage:postgresql
pnpm run test:integration
pnpm run test:git-install
```

The PostgreSQL storage contract currently runs through `pg-mem` using Kysely's
PostgreSQL dialect and the standard `pg.Pool` interface. A real PostgreSQL
server verification remains required before release; `pg-mem` is not presented
as production database evidence.

Planned gated live test:

```bash
EVM_EVENT_LAKE_RUN_LIVE_RPC_TESTS=true \
EVM_EVENT_LAKE_LIVE_RPC_URL=https://example-rpc \
pnpm run test:live-rpc
```

The final environment variable names must be confirmed in Step 4 and then kept
consistent here and in the test code.

## 13. Planned Git Installation Verification

For each release candidate:

1. Commit all intended source, metadata, lockfile, and documentation.
2. Run the local deterministic verification suite.
3. Create a candidate Git tag locally.
4. In a new temporary directory, create a minimal consumer package.
5. Install the SDK from that exact tag or commit using pnpm.
6. Compile a TypeScript import of the public package root.
7. Run a SQLite create, no-op/query, and close smoke test.
8. Confirm no npm registry package was used.
9. Remove or replace a failed candidate tag before any push.

Do not push commits or tags unless the user explicitly requests it.

## 14. Troubleshooting Contract

### Git install succeeds but import fails

Check:

- Package `exports`, runtime entry, and declarations.
- Whether the Git preparation lifecycle built `dist/`.
- Supported Node.js version.
- ESM/CommonJS compatibility documented by the release.

### SQLite cannot open the database

Check:

- Parent directory exists.
- Process has read/write permissions.
- Relative path is being resolved from the expected working directory.
- Another process is not holding a conflicting filesystem lock.

### PostgreSQL update is locked

Check the target-scoped lease and whether its owner is still alive. Do not delete
lease rows manually unless the documented recovery path confirms the lease is
stale.

### RPC answers block number but log fetch fails

An endpoint that serves `eth_blockNumber` may still limit `eth_getLogs`. Inspect
structured retry, split, cooldown, and failover events. Do not broadly disable
range safety or chain validation.

### Synchronization repeatedly stops on one block

One block may contain more logs than every configured provider allows. Add a
capable endpoint or provider. The SDK must not skip the block or advance the
cursor falsely.

### Query works but no new data appears

Queries never trigger synchronization. The caller must explicitly run
`update`, inspect its result, and then query the committed range.

## 15. Release Checklist

Before describing a Git tag as installable:

- Local formatting, lint, typecheck, tests, and build pass.
- SQLite and PostgreSQL storage contract tests pass.
- Git install from the exact reference passes in a clean consumer.
- Public imports and declarations work.
- Documentation matches the public API and defaults.
- `EXTERNAL_DOCS.md` dependency links and versions are current.
- No secret or credential-bearing URL is present in tracked files.
- Registry publication remains disabled.
- No npm publish workflow or token is introduced.
- The user has explicitly approved any push or tag publication.
