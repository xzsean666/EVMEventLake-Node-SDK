# AGENTS.md — EVMEventLake Node SDK Engineering Guide

This is the operating manual for every AI engineering agent or human developer working in this repository.

Read this file before making decisions or changing files. Project facts belong in `docs/AI/`; this file defines how work must be conducted.

---

## 1. Required Read Order

Read these files in order at the start of every session:

1. `AGENTS.md` — working protocol, safety rules, and non-negotiable invariants.
2. `docs/AI/SESSION_STATE.md` — current progress, active task, completed items, and known risks.
3. `docs/AI/GOAL.md` — overarching project goal, boundaries, and optimization roadmap.
4. `docs/AI/TASK_INDEX.md` — master registry of all tasks, dependencies, and statuses.
5. Current Task file (`docs/AI/tasks/TASK-xxx.md`) — detailed scope, acceptance criteria, allowed files, and verification commands.
6. `docs/AI/ARCHITECTURE.md` — module boundaries, data flow, storage model, and component contracts.
7. `docs/AI/DECISIONS.md` — key architectural decision records (ADRs).
8. `docs/AI/CONTEXT_EVM_CALL.md` — evm-call base foundation development & local modification workflow.
9. `docs/SPEC.md` — observable behavior, public API, and data contracts.
10. `docs/BUILD.md` — toolchain, scripts, and verification procedures.
11. `docs/EXTERNAL_DOCS.md` — verified official references for dependencies and protocols.


If documents disagree, resolve the conflict in this priority order:
1. Explicit current user instruction
2. `docs/AI/SESSION_STATE.md`
3. `docs/SPEC.md`
4. `docs/AI/ARCHITECTURE.md`
5. `AGENTS.md`

Update all affected documents in the same change.

---

## 2. Core Principles & Philosophy

The goal is not excessive abstraction for its own sake. The goal is a system that an AI agent or human engineer can reliably understand, modify, test, and extend within limited context.

1. **One Task at a Time**: Process exactly one Goal and one current Task per session.
2. **Strict Scope Control**: Do not implement features outside the current Task. Do not edit unrelated files.
3. **Non-Destructive Operations**: Never delete, overwrite, or roll back user modifications. Never perform destructive git commands (`git reset --hard`, `git checkout .`, recursive deletions).
4. **No Premature Releases**: Do not push to remote, publish to npm, or modify production environments unless explicitly authorized.
5. **Empirical Verification**: All conclusions must be based on actual file reads or actual command execution results. Never claim tests passed without running them.
6. **Task Decomposition**: When discovering extra required work, record it as a new Task in `docs/AI/tasks/` and `docs/AI/TASK_INDEX.md` rather than implementing it immediately.

---

## 3. Product Definition & Boundaries

EVMEventLake Node SDK is an embedded TypeScript library for **one EVM contract per SDK instance**.

### It Owns:
- Fetching logs through HTTP JSON-RPC multi-endpoint pool.
- Parsing every event in the supplied ABI into a deterministic event catalog.
- Incrementally storing raw and decoded event logs.
- Maintaining durable synchronization state and monotonic cursors.
- Supporting SQLite, PostgreSQL, and IndexedDB with 100% contract parity.
- Providing database-only event queries.
- Executing one finite synchronization run per explicit `update()` call.

### It Does NOT Own (Explicit Caller Responsibilities):
- Polling loops, intervals, cron, workers, queues, or process supervision.
- WebSocket subscriptions or long-lived event listeners.
- HTTP / REST / GraphQL server endpoints.
- Business definitions such as recent-block windows or threshold alerts.
- Analytics, notifications, or downstream domain logic.
- Multi-contract orchestration inside one instance.

---

## 4. Architecture Rules

1. **Cognitive Decomposition**: Split modules according to whether they can be understood in isolation.
2. **Single Responsibility**: Every module must have one primary purpose, clear inputs/outputs, and explicit dependencies.
3. **Local Understandability**: A file should not require reading the entire repository.
4. **Naming is Documentation**: Use descriptive names; avoid abbreviations (`cfg`, `tmp`, `svc`, `mgr`, `utils`, `common`).
5. **Explicit Behavior**: Avoid hidden I/O, magic fallbacks, implicit global state, and lazy side effects.
6. **Complexity Control**: Flat composition and pure functions over deep inheritance or multipurpose abstractions.
7. **No Utility Dumping Grounds**: Codecs, normalizers, and validators belong to the domain module that owns their rules.

---

## 5. Non-Negotiable Invariants

1. One SDK instance owns exactly one `chainId + contractAddress` target.
2. Multiple instances may share one database without sharing in-memory state.
3. `update()` runs once and returns; it never creates an internal timer or background loop.
4. Query code never imports or calls RPC code.
5. RPC uses HTTP JSON-RPC only; no WebSocket implementation in V1.
6. Every endpoint must pass chain ID validation before serving sync data.
7. Range-limit failures split ranges; endpoint failures trigger bounded retry, cooldown, and failover.
8. A single-block failure across all endpoints is a typed terminal error, not an infinite loop.
9. Logs, checkpoints, and cursor progression commit atomically for each contiguous range.
10. A failed or partially fetched range is never marked complete.
11. Raw logs are preserved even when the ABI cannot decode them.
12. Reorg handling validates stored block hashes and rewinds explicitly.
13. SQLite, PostgreSQL, and IndexedDB pass the same storage contract tests.
14. Query ordering is deterministic and pagination is opaque cursor-based.
15. SQL is parameterized; credentials and sensitive URL paths are redacted from errors and logs.
16. Installed directly from GitHub (`private: true`); never published to npm.

---

## 6. Task Lifecycle & Scoping Rules

### Task State Machine
Every task transitions strictly according to the following state machine:

```text
TODO -> IN_PROGRESS -> REVIEW -> DONE
                    \-> BLOCKED
```

- **`TODO`**: Task defined, scoped, and ready to be scheduled once dependencies are met.
- **`IN_PROGRESS`**: Currently active task in the ongoing session. At most ONE task is in progress per session.
- **`REVIEW`**: Implementation completed; undergoing verification, testing, or review.
- **`DONE`**: All acceptance criteria satisfied, verification executed and recorded, docs updated.
- **`BLOCKED`**: Blocked by an unmet external dependency, missing maintainer input, or technical impediment.

### Task Sizing & Scoping Checklist
Every task must satisfy:
- Exactly one clear objective producing observable, verifiable results.
- Bounded time scope (typically 30–90 minutes of focused engineering).
- Bounded file modifications (aim for <= 5 implementation files and <= 3 test files).
- Explicit inputs, outputs, acceptance criteria, allowed files, and verification commands.
- If a task expands beyond these boundaries, decompose it into new numbered tasks in `docs/AI/tasks/` and register them in `docs/AI/TASK_INDEX.md`.

---

## 7. Pre-Implementation Planning Format

Before modifying code, the agent must output:

```text
Request Type:
Goal:
Current Behavior:
Current Task:
Dependencies:
Files To Read:
Files To Modify:
Files To Create:
Implementation Approach:
Acceptance Criteria:
Verification Method:
Risks and Assumptions:
```

---

## 8. Verification & Session Handoff

Every session must end by updating `docs/AI/SESSION_STATE.md` and providing the final handoff summary:

```text
Goal:
Task:
Status: DONE | BLOCKED | REVIEW

Changed Files:
Created Files:

Implementation Summary:

Verification and Test Results:

Known Issues:

Remaining Work:

Next Task:
```
