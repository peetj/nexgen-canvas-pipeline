# Course Assets

Store course-level orchestration files here, one folder per course shell.

Recommended layout:

```text
apps/cli/course-assets/<course-name>/
  orchestrator.json
  README.md

apps/cli/session-assets/<course-name>/
  shared/
  pages/
  <session-name>/
```

Notes:
- `orchestrator.json` is the blueprint consumed by `course-orchestrate`.
- Keep authored content in `apps/cli/session-assets/<course-name>/...`.
- Relative paths used by `page.content[].path`, `today-section.notesFile`, task `notesFile`, and `create-survey.fromFile` are resolved against `apps/cli/session-assets/<course-name>/` first, then fall back to the blueprint folder for backward compatibility.
- Reused session workflows such as `today-section` and `task-a-section` use `apps/cli/session-assets/<course-name>/<session-name>/...` by default when run through `course-orchestrate`.
