# TASK-006: Repository License Selection and Release Tag Preparation

## Objective
Establish the formal open-source license for the repository, update package manifest metadata, and prepare the repository for its first semantic release tag (`v0.1.0`), incorporating both backend and frontend support.

## Scope
- Solicit explicit user/maintainer decision regarding the public license (e.g. MIT, Apache-2.0).
- Add the corresponding `LICENSE` file to the repository root.
- Update `package.json` with the chosen `"license"` field.
- Run GitHub installation verification against the newly pushed commit containing the license.
- Prepare Git tag `v0.1.0` creation guidelines without pushing prematurely.

## Allowed Files
- `LICENSE`
- `package.json`
- `README.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/tasks/TASK-006.md`

## Dependencies
- TASK-005 (Universal Client Integration & Frontend dApp Example).

## Inputs and Outputs
- **Inputs**: User confirmation of preferred open-source license (e.g. MIT, Apache-2.0).
- **Outputs**: `LICENSE` file committed, `package.json` license metadata updated, release tag `v0.1.0` ready.

## Acceptance Criteria
- [x] User provides explicit choice of license (MIT License chosen).
- [x] `LICENSE` exists in root and matches `package.json` `"license"` identifier (SPDX format: `"MIT"`).
- [x] `pnpm run verify` passes completely.
- [x] `pnpm run test:git-install` passes.
- [x] Tag `v0.1.0` is tagged only after explicit user approval.

## Verification Commands
```bash
pnpm run verify
pnpm run test:git-install
```

## Risks and Assumptions
- Must not assume or invent a license without explicit user authorization.
- Git tag must not be pushed without explicit user request.

## Status
DONE
