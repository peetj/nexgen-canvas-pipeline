# Nexgen Canvas Plugin Ideas And Roadmap

## Purpose
Capture high-value backend plugin opportunities for Nexgen STEM School and define an implementation roadmap that is safe, incremental, and practical.

## Plugin Ideas Backlog

### Read-Only (Low Risk, High Early Value)
1. `course-audit`
- Check each session module for required structure (`Teachers Notes`, `QUIZ`, `Task A/B/C...`).
- Report missing headers, missing pages, duplicate items, out-of-order items.

2. `session-readiness-report`
- Per session: content completeness, quiz readiness, known blockers.
- Output concise status (`Ready`, `Needs Fix`, `Missing Core Content`).

3. `content-link-check`
- Scan pages for broken links and missing file/image references.
- Flag unsafe/temporary URLs and malformed embeds.

4. `quiz-quality-audit`
- Validate quiz settings and consistency (question count, attempts, publish state, naming).
- Highlight sessions with no quiz or weak quiz alignment.

5. `outcome-coverage`
- Check whether session objectives are represented in task pages and quizzes.
- Flag content gaps by session.

6. `student-progress-report`
- Summarize completion patterns and identify intervention cohorts.
- Export teacher-facing digest by course/session.

### Controlled Write Plugins (Higher Value, Requires Guardrails)
7. `teacher-notes-generator`
- Promote existing notes generation logic into plugin workflow.
- Draft-first then live publish.

8. `safe-publish`
- Publish only when readiness/audit thresholds pass.
- Prevent accidental publish of incomplete sessions.

9. `bulk-fix-naming`
- Enforce title conventions for modules/pages/quizzes.
- Apply changes in batches with preview and rollback logging.

10. `extension-pack-injector`
- Add beginner and extension prompts to task sections in consistent format.
- Use per-session context to keep examples realistic.

11. `term-cloner`
- Copy module/content structure into new term course shell.
- Optional remap of dates, due windows, and naming patterns.

## Concrete Plugin Roadmap

## Phase 0: Foundation (Done / In Progress)
1. Plugin runtime scaffold (`apps/plugins-runner`).
2. Plugin contract and registry.
3. First plugin: `module-overview` (read-only validation plugin).

Exit criteria:
- `list` and `run` commands stable.
- Shared Canvas SDK integration stable.

## Phase 1: Operational Visibility (Read-Only)
1. Build `course-audit`.
2. Build `session-readiness-report`.
3. Build `content-link-check`.

Deliverables:
- Machine-readable JSON output.
- Human-readable summary output.
- Standard severity levels (`critical`, `warning`, `info`).

Exit criteria:
- Can audit a full course with no writes.
- Reports are useful enough for weekly planning meetings.

## Phase 2: Quality Controls (Read-Only + Recommendations)
1. Build `quiz-quality-audit`.
2. Build `outcome-coverage`.
3. Add recommendation engine to suggest exact fixes (still no writes).

Exit criteria:
- Consistent quality score per session.
- Clear fix list that maps to concrete pages/quizzes.

## Phase 3: Safe Writes (Draft First)
1. Migrate `teacher-notes-generator` into plugin runner.
2. Build `safe-publish` with hard gates.
3. Add `bulk-fix-naming` with preview mode.

Required safeguards:
1. `--dry-run` mandatory first.
2. Explicit `--course-id` required.
3. Draft mode default for content generation.
4. Archive-before-overwrite policy for page updates.
5. Optional allowlist for writable course IDs.

Exit criteria:
- Zero accidental production regressions.
- All write actions logged with before/after metadata.

## Phase 4: Scale And Reuse
1. Build `term-cloner`.
2. Build `extension-pack-injector`.
3. Add schedule-friendly execution mode (nightly audits).

Exit criteria:
- Setup time for new term reduced materially.
- Repeatable quality baseline across courses.

## Priority Recommendation (Next 4 Plugins)
1. `course-audit` (highest immediate operational value, low risk).
2. `session-readiness-report` (direct teacher planning value).
3. `content-link-check` (prevents classroom disruption from broken resources).
4. `teacher-notes-generator` pluginization (reuses proven workflow).

## Suggested Success Metrics
1. Percentage of sessions that pass readiness audit.
2. Number of broken links/resources detected before class.
3. Time saved per term setup/cloning cycle.
4. Reduction in last-minute manual fixes before teaching.
5. Teacher adoption rate (weekly plugin report usage).

## Implementation Notes
1. Start with read-only plugins to build trust.
2. Keep plugin outputs deterministic and testable.
3. Use shared SDK for all Canvas calls.
4. Standardize plugin outputs to support future dashboards.
5. Add integration tests against a test course before enabling writes.
