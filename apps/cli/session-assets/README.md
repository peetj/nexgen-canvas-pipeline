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
    QUIZ/
    Task A/
    Task B/
    Task C/
```

Notes:
- `shared/` is for truly course-wide content such as survey JSON files and shared media. Do not put per-session `today-section` notes here.
- `pages/` is for generic page content referenced from `page` steps in `orchestrator.json`.
- `<session-name>/...` contains workflow-backed working files for session-specific commands such as `today-section` and the task sections.
- For `today-section`, prefer editing `<session-name>/What we are doing Today/notes.md` directly. Keep image metadata in the `notes.md` frontmatter using `imageFile`, `imageUrl`, and `aiImagePrompt`.
- For session quizzes, keep the cloud-agent prompt in `<session-name>/QUIZ/prompt.md`.
- Task A, Task B, and Task C scaffold `notes.md` files include starter examples for headings, checklists, local images, video links, tables, callouts, and an optional `[AGENT]` block.
- Use `today-section.notesFile` in the blueprint only as an override when you intentionally want to source content from somewhere else.
- When `course-orchestrate` runs without `--assets-root`, it uses `apps/cli/session-assets/<course-name>/` automatically.
