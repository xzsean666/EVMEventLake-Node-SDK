# Agent.md — EVMEventLake Node SDK Engineering Guide

This is the operating manual for every AI or human session in this repository.
Read it before making decisions or changing files. Project facts belong in
`docs/`; this file defines how work must be performed.

## 1. Required Read Order

Read these files in order at the start of every session:

1. `Agent.md` — working protocol and non-negotiable rules.
2. `docs/nextsession.md` — current progress, pending work, and known risks.
3. `docs/ARCHITECTURE.md` — module boundaries, data flow, and design decisions.
4. `docs/SPEC.md` — required observable behavior and acceptance criteria.
5. `docs/BUILD.md` — supported toolchain, Git installation, and verification.
6. `docs/EXTERNAL_DOCS.md` — official documentation for dependencies and
   related projects.

If documents disagree, stop implementation and resolve the conflict in this
order: explicit current user instruction, `docs/SPEC.md`,
`docs/ARCHITECTURE.md`, then this guide. Update all affected documents in the
same change.

## 2. Core Philosophy

The goal is not the most elegant or abstract system. The goal is a system that
an AI can reliably understand, modify, test, and extend within limited context.

Optimize for:

- Explicit behavior.
- Local understandability.
- Narrow module responsibilities.
- Predictable data flow.
- Incremental buildability.
- Stable public contracts.

## 3. Mandatory Execution Protocol

Before starting any step, the agent must:

1. State the current step.
2. Explain what the step will produce.
3. State whether implementation code is allowed.
4. Follow the step order.

| Step | Name | Required output | Implementation code allowed |
| --- | --- | --- | --- |
| 1 | Architecture Design | Overall architecture, directory structure, module definitions, data flow, key decisions | No |
| 2 | Documentation | `docs/SPEC.md`, `docs/BUILD.md`, external references, working guide | No |
| 3 | Context Handoff | `docs/nextsession.md` | No |
| 4 | Implementation | Source code, package configuration, migrations, tests, examples | Only after explicit user approval |

The repository is currently a documentation-only baseline. Step 4 must not
begin until the user explicitly asks to implement the SDK.

## 4. Product Definition

EVMEventLake Node SDK is an embedded TypeScript library for one EVM contract per
SDK instance.

It:

- Fetches logs through HTTP JSON-RPC.
- Parses every event in the supplied ABI.
- Incrementally stores raw and decoded event logs.
- Maintains durable synchronization state.
- Supports SQLite and PostgreSQL.
- Provides database-only event queries.
- Executes one finite synchronization run per explicit `update` call.

It does not own:

- Polling loops, cron, workers, queues, or process supervision.
- WebSocket subscriptions or event listeners.
- HTTP/GraphQL servers.
- Business definitions such as recent-block windows.
- Analytics, alerts, notifications, or downstream domain logic.
- Multi-contract orchestration inside one instance.

Do not move caller-owned behavior into the SDK merely because one application
needs it.

## 5. Architecture Rules

### 5.1 Cognitive decomposition

Split modules according to whether they can be understood in isolation, not by
line count or file size.

### 5.2 Single responsibility

Every module must have:

- One primary purpose.
- Clear inputs and outputs.
- Explicit dependencies.
- No hidden state changes.

### 5.3 Local understandability

A file should not require reading the entire repository. Keep behavior with the
module that owns it. Do not scatter one decision across unrelated files.

### 5.4 Naming is documentation

Use descriptive names. Avoid abbreviations such as `cfg`, `tmp`, `svc`, `mgr`,
or ambiguous names such as `helper`, `common`, and `misc`.

### 5.5 Explicit behavior

Avoid hidden I/O, magic fallbacks, implicit global state, and lazy side effects.
The public lifecycle must make database and RPC operations visible.

### 5.6 Complexity control

Prefer simple control flow, bounded loops, flat composition, and pure functions.
Avoid deep nesting, multipurpose functions, and inheritance hierarchies.

### 5.7 Explicit dependencies

Dependencies must be imported from visible origins and passed deliberately.
Avoid service locators, global mutable registries, and implicit injection.

### 5.8 No utility dumping ground

Do not create broad `utils`, `common`, or `core` business modules. A codec,
normalizer, or validator belongs to the domain that owns its rules.

## 6. Required Module Boundaries

`docs/ARCHITECTURE.md` is the source of truth. Primary boundaries are:

- `client` — public façade and lifecycle delegation.
- `configuration` — option definitions, defaults, and validation.
- `contract-target` — immutable chain and contract identity.
- `rpc` — HTTP RPC pool, endpoint validation, error classification, failover.
- `abi` — event catalog, decoding, and lossless value conversion.
- `synchronization` — finite update orchestration, range planning, splitting,
  checkpoint validation, and rewind decisions.
- `storage` — dialect-neutral contract plus SQLite and PostgreSQL adapters.
- `query` — database-only filters, ordering, pagination, and rehydration.
- `observability` — optional structured log and progress contracts.
- `errors` — stable typed error taxonomy.

If new behavior does not fit a named boundary, update the architecture before
creating code.

## 7. Non-Negotiable Behavior Invariants

1. One SDK instance owns exactly one `chainId + contractAddress` target.
2. Multiple instances may share one database without sharing in-memory state.
3. `update` runs once and returns; it never creates a timer or background loop.
4. Query code never imports or calls RPC code.
5. RPC uses HTTP JSON-RPC only; no WebSocket implementation belongs in V1.
6. Every endpoint must pass chain ID validation before serving sync data.
7. Range-limit failures split ranges; endpoint failures trigger bounded
   retry/cooldown/failover.
8. A single-block failure across all endpoints is a typed terminal error, not
   an infinite loop.
9. Logs and cursor progression commit atomically for each contiguous range.
10. A failed or partially fetched range is never marked complete.
11. Raw logs are preserved even when the ABI cannot decode them.
12. Reorg handling validates stored block hashes and rewinds explicitly.
13. SQLite and PostgreSQL pass the same storage contract tests.
14. Query ordering is deterministic and pagination is cursor-based.
15. SQL is parameterized; credentials are redacted from errors and logs.

## 8. Public API Discipline

- Keep the primary surface limited to create, update, sync status, event query,
  and close operations.
- Prefer an explicit asynchronous factory over hidden lazy initialization.
- Keep query operations database-only so they remain available during RPC
  outages.
- Use native domain names such as `database`, `rpcUrls`, `contractAddress`, and
  `startBlock`; do not shorten them for convenience.
- Make optional policy groups centralized and typed.
- Treat all block boundaries as explicit inclusive/exclusive contracts.
- Return structured results and typed errors; do not require log parsing to
  understand an operation outcome.
- Do not expose arbitrary SQL as a substitute for a designed query contract.

## 9. GitHub Distribution Rules

This SDK will be installed directly from GitHub. It will not be published to
the npm registry unless the user makes a new explicit decision.

Implementation and release work must preserve:

- Standard Node package metadata and exports.
- Generated JavaScript and TypeScript declarations that work after Git install.
- A Git-install-compatible build lifecycle.
- A package guard against accidental registry publication.
- Semantic version Git tags for releases.
- Support for pinning a tag or immutable commit.
- A clean consumer-project test that installs the exact Git reference.

Do not tell consumers to depend on `main` for production. Do not add an npm
publish token, npm registry release workflow, or `npm publish` step.

## 10. Testing Rules for Step 4

Tests must follow the architecture rather than only happy-path examples.

Required layers:

- Unit tests for configuration, range planning, error classification, ABI
  catalog behavior, cursor encoding, and value codecs.
- Storage contract tests that run unchanged against SQLite and PostgreSQL.
- Integration tests for update transactions, retries, failover, resumption,
  cancellation, leases, and reorg rewind.
- Database-only query tests that run with RPC unavailable.
- Opt-in live RPC tests using a documented stable chain sample.
- A clean GitHub installation smoke test from a temporary consumer project.

Live tests must be gated by explicit environment variables. Ordinary test runs
must not require network access or paid RPC credentials.

## 11. Documentation Rules

All project documentation except this root operating guide belongs in `docs/`.

Update documentation with the behavior it describes:

| Change type | Required documents |
| --- | --- |
| Architecture or module boundary | `ARCHITECTURE.md`, `SPEC.md`, `nextsession.md` |
| Public API or observable behavior | `SPEC.md`, `BUILD.md`, `nextsession.md` |
| Build, installation, supported runtime, or release | `BUILD.md`, `EXTERNAL_DOCS.md`, `nextsession.md` |
| External dependency or connected project | `EXTERNAL_DOCS.md`, `nextsession.md` |
| Risk, incomplete work, or discovered limitation | `nextsession.md` and the owning canonical document |

When the SDK integrates another project or tool, add to
`docs/EXTERNAL_DOCS.md`:

- Official project name.
- Official documentation URL.
- Why this repository depends on it.
- Which module uses it.
- Whether it is a runtime dependency, development dependency, protocol, or
  reference only.
- Date the link was verified.

Do not leave essential external URLs only in chat history, issue comments, or
source comments.

## 12. Git Workflow

After each major step:

```text
git add .
git commit -m "feat: <describe current step>"
```

Do not push unless the user explicitly requests it.

Do not rewrite history or revert user changes without explicit approval.

Use focused commits. Documentation-only steps must not contain premature source
implementation.

## 13. Self-Correction Rule

Stop and correct the design or implementation when any of these appears:

- Source implementation before Step 4 approval.
- A module gains multiple unrelated responsibilities.
- Query logic begins depending on RPC availability.
- Caller scheduling or business logic moves into the SDK.
- RPC retries or range splitting can continue without a bound.
- Storage behavior differs silently between SQLite and PostgreSQL.
- Configuration or side effects become scattered.
- A generic helper module begins accumulating business behavior.

Do not continue building on a known architectural violation.

## 14. Step 4 Approval Gate

Before creating `package.json`, TypeScript source, migrations, tests, examples,
or CI workflows, receive explicit user approval to begin implementation.

When approved, follow the incremental order in
`docs/ARCHITECTURE.md`. Complete and verify one phase before starting the next.

## 15. Final Principle

The SDK should be easy to install, easy to call once, safe to call again, and
easy to embed in larger systems without taking control of those systems.

Optimize for AI comprehension and explicit contracts, not abstraction for its
own sake.
