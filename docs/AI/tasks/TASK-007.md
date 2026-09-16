# TASK-007: Cross-Platform SQLite Path and URL Normalization Tests

## Objective
Verify and standardize SQLite connection URL resolution across different operating systems, particularly handling relative paths, absolute paths, Windows drive letters (e.g. `C:\`), and `file://` URIs.

## Scope
- Audit `src/configuration/validate-sdk-options.ts` and `src/storage/sqlite/` for SQLite URL parsing.
- Add comprehensive cross-platform path parsing unit tests in `tests/unit/configuration/`.
- Ensure paths containing special characters, drive letters, and relative references (`./data.db`, `../data.db`, `sqlite:./data.db`, `sqlite:///C:/path/db.sqlite`) behave deterministically.
- Document supported SQLite URL formats in `docs/BUILD.md` and `docs/SPEC.md`.

## Allowed Files
- `src/configuration/validate-sdk-options.ts`
- `src/storage/sqlite/sqlite-database-factory.ts`
- `tests/unit/configuration/sqlite-url-parsing.test.ts`
- `docs/SPEC.md`
- `docs/BUILD.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-007.md`

## Dependencies
- TASK-000 (Core V1 SDK Implementation - DONE).

## Inputs and Outputs
- **Inputs**: Diverse SQLite connection strings across POSIX and Windows formats.
- **Outputs**: Robust, cross-platform path normalizer and test coverage for all valid SQLite connection patterns.

## Acceptance Criteria
- [x] Relative paths (e.g. `sqlite:events.db`, `./events.db`) resolve correctly relative to process current working directory.
- [x] Absolute POSIX paths (`sqlite:///var/data/events.db`) resolve accurately.
- [x] Windows drive paths (`sqlite:///C:/data/events.db` or `sqlite:C:\data\events.db`) parse without escaping errors.
- [x] In-memory SQLite flags (`sqlite::memory:`) are explicitly handled and validated.
- [x] Unit tests pass across all supported URL forms.

## Verification Commands
```bash
pnpm run test:unit
pnpm run verify
```

## Risks and Assumptions
- Must not break existing POSIX path parsing.
- Must ensure SQLite in-memory databases remain isolated or explicitly documented as non-persistent.

## Status
DONE
