# Example Course

This folder shows the recommended course-level orchestration layout.

Run the example with:

```bash
npx tsx apps/cli/src/cli.ts course-orchestrate --course-id 21 --from-file apps/cli/course-assets/example-course/orchestrator.json --dry-run
```

Folder notes:
- `orchestrator.json` defines the module template and per-session expansion.
- Authored content for this example lives under `apps/cli/session-assets/example-course/`.
- `apps/cli/session-assets/example-course/pages/` contains page fragments and markdown files referenced from the blueprint, such as the feedback page content.
- `apps/cli/session-assets/example-course/shared/` contains reusable course assets such as survey JSON files.
- `today-section` content is expected under `apps/cli/session-assets/example-course/<session-name>/What we are doing Today/notes.md`; use `--prepare-assets` to scaffold those files.
- Quiz prompts are expected under `apps/cli/session-assets/example-course/<session-name>/QUIZ/prompt.md`; use `--prepare-assets` to scaffold those files.
