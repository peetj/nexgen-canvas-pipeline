# Course Assets

Store course-level orchestration files here, one folder per course shell.

Recommended layout:

```text
apps/cli/course-assets/<course-name>/
  orchestrator.json
  pages/
  shared/
  README.md
```

Notes:
- `orchestrator.json` is the blueprint consumed by `course-orchestrate`.
- Paths used by `page.content[].path`, `today-section.notesFile`, and task `notesFile` entries are resolved relative to the blueprint file.
- Survey JSON files referenced by `create-survey.fromFile` are also resolved relative to the blueprint file.
- Reused session workflows such as `today-section` and `task-a-section` still use `apps/cli/session-assets/<session-name>/...` for their authored session folders and local media.
