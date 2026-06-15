# Teacher Notes Handoff

Date: 2026-04-26
Branch: `teacher-notes`

## Current Position

- Human contract exists in `docs/teacher-notes-contract.md`.
- Runtime contract exists in `apps/cli/src/session/teacherNotesContract.ts`.
- Teacher notes are live-only. There is no draft/review/publish workflow.
- Contract tests pass:
  - `node --import tsx --test apps/cli/src/session/teacherNotesContract.test.ts`
- Verified dry-run:
  - `node --import tsx apps/cli/src/cli.ts teacher-notes --course-id 26 --session-name "Session 01 - Nexgen Zippy Demo" --page-title "Nexgen Zippy Demo" --dry-run`
  - Result: `Generation mode: agent`
  - No contract-validation fallback

## Reference Courses

- Course `21`: best current full-content reference
- Course `26`: target session-structure reference
- Course `27+`: expected to follow course `26` structure, including a mixed-domain Session `01`

## What Was Fixed

- Starter-template task scaffold is stripped before domain detection and validation.
- Domain routing is driven by broader session evidence:
  - intro page
  - task titles and task bodies
  - quiz title and questions
- Mixed-domain Session `01` can now route in agent mode without falling back.
- Task context building is more tolerant when course structure varies across revisions.

## Verified Session Status

- Course `26`, `Session 01 - Nexgen Zippy Demo`
  - full session content exists
  - dry-run succeeds in `agent` mode
  - all major teacher-notes sections are filled

## Known Quality Gaps

- Session `01` is structurally complete, but some wording is still generic and will benefit from hand editing.
- Mixed-domain polish still needs more work so demo/setup/soldering guidance feels sharper and less blended.
- Wider sweep work remains for later sessions and for legacy course variants.

## Next Resume Point

1. Use the generated artefact for manual editing now.
2. When resuming automation work, continue with mixed-domain quality tuning on course `26`.
3. After that, sweep sessions `02` to `08` against:
   - course `26` for target structure
   - course `21` for full-content reference quality
4. Keep the solution evidence-driven. Do not add course-id-specific routing logic.

## Deployment Note

- No redeploy is required for the current CLI dry-run/testing path.
- Redeploy only if worker-side prompt/runtime behavior needs to be kept in sync with repo changes.
