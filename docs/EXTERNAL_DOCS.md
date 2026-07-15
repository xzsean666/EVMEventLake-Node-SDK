# External and Related Project Documentation

Last reviewed: 2026-07-15

## 1. Purpose

This file is the durable index of official documentation used by this
repository. It exists so future AI sessions do not need to rediscover dependency
and integration documentation from chat history.

When a dependency, protocol, database, build tool, or connected project is
added or upgraded, update:

- Official documentation URL.
- Why the project is used.
- Owning SDK module.
- Dependency relationship.
- Verified date.

Prefer versionless “current” documentation URLs only when the project maintains
them as stable latest-version entry points. Record version-specific URLs when
behavior depends on a major version.

## 2. Related EVMEventLake Project

### EVMEventLake Rust service

- Repository: <https://github.com/xzsean666/EVMEventLake>
- Latest repository docs: <https://github.com/xzsean666/EVMEventLake/tree/main/docs>
- Relationship: Related project and architectural reference only.
- Runtime dependency: No.
- Why referenced: It contains prior EventLake work on HTTP RPC behavior,
  adaptive `eth_getLogs` windows, checkpoints, decoding, search, and deployment.
- SDK areas informed: `rpc`, `synchronization`, storage semantics, live RPC
  testing.
- Important boundary: The Node SDK does not call, embed, or require the Rust
  service. Do not copy its server, background-worker, REST API, or deployment
  responsibilities into this SDK.
- Verified: 2026-07-14.

If a future task introduces a real runtime integration between these projects,
document its protocol, version compatibility, and failure boundary in a new
subsection here before implementation.

## 3. EVM Protocol and JSON-RPC

### Ethereum JSON-RPC API

- Official docs: <https://ethereum.org/en/developers/docs/apis/json-rpc/>
- `eth_getLogs` section: <https://ethereum.org/en/developers/docs/apis/json-rpc/#eth_getlogs>
- Relationship: Required external protocol.
- SDK areas: `rpc`, `synchronization`, `contract-target`.
- Why used: Defines chain ID, block, block-header, and event-log request and
  response behavior.
- Verified: 2026-07-14.

### Ethereum Execution APIs specification

- Official specification: <https://ethereum.github.io/execution-apis/>
- Relationship: Required protocol reference.
- SDK areas: `rpc`, live RPC tests.
- Why used: More formal reference for execution-layer JSON-RPC methods and data
  shapes.
- Verified: 2026-07-14.

RPC providers may impose stricter `eth_getLogs` range, response-size, timeout,
or rate limits than the base protocol. Provider-specific operational limits
should be added here only when the SDK or its tests intentionally depend on a
specific provider.

### Base mainnet live-test network

- Connect to Base: <https://docs.base.org/base-chain/quickstart/connecting-to-base>
- Base `eth_getLogs` reference:
  <https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_getLogs>
- Circle USDC contract addresses:
  <https://developers.circle.com/stablecoins/usdc-contract-addresses>
- Relationship: External protocol and gated live-test fixture only.
- Runtime dependency: No; ordinary SDK tests do not contact Base.
- SDK areas: `tests/live-rpc`, `rpc`, `synchronization`, `abi`, SQLite storage,
  and query verification.
- Why used: Base USDC block `48625053` is a fixed public sample that exercises
  real `eth_getLogs`, ABI decoding, persistence, and database-only query.
- Verified values: Base chain ID `8453`, USDC address
  `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, 76 contract logs and 57
  `Transfer` logs in the sample block.
- Operational note: `https://mainnet.base.org` is a rate-limited public RPC and
  can be replaced through `EVM_EVENT_LAKE_LIVE_RPC_URL`.
- Verified: 2026-07-14.

## 4. Runtime Libraries

Runtime versions are pinned in `package.json` and `pnpm-lock.yaml`.

### viem

- Selected version: `2.55.2`.

- Main docs: <https://viem.sh/docs/getting-started>
- Read logs: <https://viem.sh/docs/actions/public/getLogs>
- Decode event log: <https://viem.sh/docs/contract/decodeEventLog>
- Fallback transport: <https://viem.sh/docs/clients/transports/fallback>
- HTTP transport: <https://viem.sh/docs/clients/transports/http>
- Relationship: Runtime dependency.
- SDK areas: `rpc`, `abi`, `contract-target`.
- Why used: Provides maintained EVM JSON-RPC, address, ABI, topic, and event
  decoding primitives. The SDK still owns endpoint eligibility, range splitting,
  retries, and durable synchronization semantics.
- Verified: 2026-07-14.

### Kysely

- Selected version: `0.29.3`.

- Main docs: <https://kysely.dev/docs/intro>
- Migrations: <https://kysely.dev/docs/migrations>
- API docs: <https://kysely-org.github.io/kysely-apidoc/>
- Relationship: Runtime dependency.
- SDK areas: `storage/sqlite`, `storage/postgresql`, query compilation.
- Why used: Provides typed SQL construction while keeping database execution
  and dialect-specific behavior explicit.
- Verified: 2026-07-14.

Kysely must not become the public storage contract. Adapter behavior is defined
by this repository and tested against both databases.

### better-sqlite3

- Selected version: `12.11.1`.

- Repository: <https://github.com/WiseLibs/better-sqlite3>
- API docs: <https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md>
- Relationship: Runtime dependency for SQLite installations.
- SDK area: `storage/sqlite` only.
- Why used: Mature embedded SQLite driver supported by Kysely's SQLite
  dialect.
- Verified: 2026-07-14.

### node-postgres (`pg`)

- Selected version: `8.22.0`.

- Main docs: <https://node-postgres.com/>
- Features: <https://node-postgres.com/features/connecting>
- API docs: <https://node-postgres.com/apis/pool>
- Relationship: Runtime dependency for PostgreSQL installations.
- SDK area: `storage/postgresql` only.
- Why used: Standard PostgreSQL driver for Node.js and Kysely's PostgreSQL
  dialect.
- Verified: 2026-07-14.

## 5. Database Documentation

### SQLite

- Official docs index: <https://www.sqlite.org/docs.html>
- Transactions: <https://www.sqlite.org/lang_transaction.html>
- Write-ahead logging: <https://www.sqlite.org/wal.html>
- Relationship: Supported storage engine.
- SDK area: `storage/sqlite`.
- Why used: Embedded local database for scripts and low-concurrency
  applications.
- Verified: 2026-07-14.

### PostgreSQL

- Current official manual: <https://www.postgresql.org/docs/current/index.html>
- Transactions tutorial: <https://www.postgresql.org/docs/current/tutorial-transactions.html>
- Explicit locking: <https://www.postgresql.org/docs/current/explicit-locking.html>
- Relationship: Supported storage engine.
- SDK area: `storage/postgresql`.
- Why used: Shared and concurrent durable database for larger or multi-process
  applications.
- Verified: 2026-07-14.

## 6. Node, TypeScript, and Git Package Installation

### Node.js

- Supported runtime: Node.js 22 or newer.
- Development verification: Node.js `24.2.0`.

- Official docs: <https://nodejs.org/docs/latest/api/>
- Built-in test runner: <https://nodejs.org/docs/latest/api/test.html>
- Release/LTS status: <https://nodejs.org/en/about/previous-releases>
- Relationship: Required runtime.
- SDK areas: Entire package and release compatibility.
- Why used: Runtime for the SDK and consumer applications. The standalone
  `example/` consumer uses the built-in test runner so it does not need a second
  runtime test framework.
- Verified: 2026-07-15.

Check the LTS table again before changing the Node.js 22 minimum in a future
release.

### TypeScript

- Selected version: `5.9.3`.

- Official docs: <https://www.typescriptlang.org/docs/>
- Declaration publishing guidance:
  <https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html>
- Relationship: Source/build development dependency.
- SDK areas: Public types, source, declarations, build.
- Why used: Stable typed API for Node.js consumers.
- Verified: 2026-07-14.

### pnpm

- Selected version: `10.12.1`.

- Main docs: <https://pnpm.io/>
- Add command and Git-hosted dependencies: <https://pnpm.io/cli/add>
- Package manifest settings: <https://pnpm.io/package_json>
- Relationship: Required development package manager and recommended consumer
  installation path.
- SDK areas: Build, lockfile, Git installation, release verification.
- Why used: Reproducible dependency management and direct GitHub dependency
  installation.
- Verified: 2026-07-14.

### npm package lifecycle reference

- Package scripts and `prepare` lifecycle:
  <https://docs.npmjs.com/cli/v11/using-npm/scripts/>
- Package manifest reference:
  <https://docs.npmjs.com/cli/v11/configuring-npm/package-json/>
- Relationship: Package format reference only; not a registry publication path.
- SDK areas: Package manifest and Git-install build lifecycle.
- Why referenced: Git dependencies use standard Node package manifest and
  lifecycle conventions even though this SDK is not published to npm.
- Verified: 2026-07-14.

## 7. Test Tooling

### Vitest

- Selected version: `4.1.10`.

- Official guide: <https://vitest.dev/guide/>
- API reference: <https://vitest.dev/api/>
- Relationship: Development dependency.
- SDK areas: Unit, storage contract, integration, and gated live tests.
- Why used: TypeScript-native test runner with focused and workspace-friendly
  test execution.
- Verified: 2026-07-14.

### pg-mem

- Selected version: `3.0.14`.
- Repository and docs: <https://github.com/oguimbal/pg-mem>
- Relationship: Development dependency only.
- SDK area: PostgreSQL storage contract tests.
- Why used: Executes PostgreSQL-dialect SQL through a `pg`-compatible in-memory
  adapter when a real PostgreSQL server is unavailable in the local workspace.
- Important limitation: It does not replace required real PostgreSQL release
  verification.
- Verified: 2026-07-14.

## 8. Mature Design References

These projects are references only. They must not become runtime dependencies
without an explicit architecture and documentation update.

### ethers

- Provider and event docs: <https://docs.ethers.org/v6/api/providers/>
- Relationship: Comparative reference only.
- Why referenced: Mature provider and log-query behavior, including the reality
  that backend providers may limit event query ranges.
- SDK areas informed: `rpc`, public event result design.
- Verified: 2026-07-14.

### Ponder

- Official docs: <https://ponder.sh/docs/get-started>
- Why Ponder: <https://ponder.sh/docs/why-ponder>
- Relationship: Architectural reference only.
- Why referenced: Demonstrates separation between blockchain indexing and
  application event handling.
- SDK areas informed: System boundary and caller-owned business logic.
- Important difference: Ponder is an application indexing framework; this
  project remains an embedded one-shot SDK.
- Verified: 2026-07-14.

## 9. Update Checklist

Before merging a dependency or integration change:

- Add or update its official docs URL here.
- Record the selected version or Git reference.
- State the owning module and relationship type.
- Verify the URL is reachable.
- Record the current date.
- Update `ARCHITECTURE.md` if module boundaries change.
- Update `SPEC.md` if observable behavior changes.
- Update `BUILD.md` if installation, build, or runtime requirements change.
- Update `nextsession.md` with progress and migration risks.
