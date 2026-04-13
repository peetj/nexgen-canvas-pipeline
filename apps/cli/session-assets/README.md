# Session Assets

Store all authored course content here, one folder per course.

Recommended layout:

```text
apps/cli/session-assets/<course-name>/
  shared/
  pages/
  <session-name>/
    What we are doing Today/
      images/
    Task A/
    Task B/
    Task C/
```

Notes:
- `shared/` is for truly course-wide content such as survey JSON files and shared media. Do not put per-session `today-section` notes here.
- `pages/` is for generic page content referenced from `page` steps in `orchestrator.json`.
- `<session-name>/...` contains workflow-backed working files for session-specific commands such as `today-section` and the task sections.
- For `today-section`, prefer editing `<session-name>/What we are doing Today/notes.md` directly. Keep image metadata in the `notes.md` frontmatter using `imageFile`, `imageUrl`, and `aiImagePrompt`.
- Use `today-section.notesFile` in the blueprint only as an override when you intentionally want to source content from somewhere else.
- When `course-orchestrate` runs without `--assets-root`, it uses `apps/cli/session-assets/<course-name>/` automatically.
