# Example Course

This folder shows the recommended course-level layout for orchestration work.

Run the example with:

```bash
npx tsx apps/cli/src/cli.ts course-orchestrate --course-id 21 --from-file apps/cli/course-assets/example-course/orchestrator.json --dry-run
```

Folder notes:
- `orchestrator.json` defines the module template and per-session expansion.
- `pages/` contains page fragments and markdown files referenced from the blueprint.
- `shared/` is for course-wide reusable assets such as survey JSON files, shared images, or HTML snippets.
