# Nexgen Canvas Pipeline

This repo hosts Canvas automations. It currently generates and uploads Nexgen-style multiple choice quizzes into Canvas using the Canvas API.

## Goals (v1)
- Validate quiz JSON using a locked schema (nexgen-quiz.v1)
- Create a Classic Quiz in the Nexgen Test course
- Add 5 multiple choice questions, 4 options each
- Support a --dry-run mode

## Setup
1. Install Node.js 18+.
2. Copy .env.example to .env and fill values.
   - Configure `CANVAS_AGENT_URL` (single worker base URL). CLI derives `/generate-quiz`, `/today-intro`, and `/task-a-content`.
3. Install deps:
   npm install

## Repo layout
- `apps/cli`: Canvas automation CLI app (quiz/session/task/teacher-notes commands)
- `apps/plugins-runner`: plugin runtime app for reusable Canvas plugins
- `apps/cli/config/nexgen-canvas-pipeline.config.json`: CLI config defaults
- `apps/cli/examples`: example quiz payloads
- `packages/canvas-sdk`: shared Canvas API client and types
- `agent/src/quiz`: Cloudflare quiz generator endpoint (`/generate-quiz`)
- `agent/src/todayIntro`: Cloudflare intro rewrite endpoint for `today-section` (`/today-intro`)
- `agent/src/taskA`: Cloudflare Task A enrichment endpoint for task pages (`/task-a-content`)

## Command Summary
### Main CLI (`apps/cli/src/cli.ts`)
- `create`: Creates a Canvas Classic Quiz either from a Nexgen JSON file or generated agent content. It validates the quiz structure and uploads questions to the selected course.
- `create-survey`: Creates a Canvas survey from a survey JSON file, with support for multiple choice, short answer, essay, and file upload questions.
- `course-files-scaffold`: Creates a Canvas Files folder scaffold in a course. It supports a built-in default session structure or a custom JSON tree.
- `session-headers`: Adds standard Nexgen session subheaders to an existing Canvas module. This is used to scaffold a consistent module structure for a specific session number and ensure the matching Canvas Files session folders exist.
- `clone-survey`: Copies an existing quiz/survey into session-numbered variants. It can generate multiple target titles from a template and duplicate all questions from the source quiz.
- `teacher-notes`: Builds a canonical Teacher Notes page from existing session content. In live mode it updates module placement; in draft mode it prepares a safe draft page without changing live placement.
- `task-a-section`: Builds/updates a Task A page from `session-assets/<session>/<task-folder>/notes.md` and local media, placing it under the `Session NN: Task A` header and uploading local media to Canvas Files under `Session_NN/task_a`.
- `task-b-section`: Builds/updates a Task B page from `session-assets/<session>/<task-folder>/notes.md` and local media, placing it under the `Session NN: Task B` header and uploading local media to Canvas Files under `Session_NN/task_b`.
- `task-c-section`: Builds/updates a Task C page from `session-assets/<session>/<task-folder>/notes.md` and local media, placing it under the `Session NN: Task C` header and uploading local media to Canvas Files under `Session_NN/task_c`.
- `today-section`: Builds/updates the session introduction page for the `What we are doing Today` section. It rewrites notes via the intro agent, uploads local images to Canvas Files under `Session_NN/what_are_we_doing_today`, then applies final HTML.
- `course-orchestrate`: Creates or updates multiple modules/pages from a JSON blueprint. It reuses existing section workflows such as `session-headers`, `today-section`, and task section generation instead of re-implementing them, and by default scopes local session assets under `apps/cli/session-assets/<course-name>/`.

### Plugins Runner (`apps/plugins-runner/src/cli.ts`)
- `list`: Shows available reusable Canvas workflow plugins that can be executed by the runner.
- `run`: Executes a selected plugin. Canvas-backed plugins require `--course-id`; standalone plugins (for example `reveal-answer`) do not.

## Config
All non-secret settings live in `apps/cli/config/nexgen-canvas-pipeline.config.json`. For session headers, edit
`sessions.headersTemplate`. Use `{nn}` for a zero-padded session number (e.g. 01) and `{n}` for
the raw session number (e.g. 1).

## Later
- Add agent integration: --prompt "..." will call the Cloudflare quiz agent.

## Creating and Uploading the Repository to Github
git init
git status
git add -A
git commit -m "Fix schema validation and JSON import"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/nexgen-canvas-pipeline.git
git push -u origin main


If you need to login to your repo (assuming you have the github cli installed)

gh auth login

## Usage
Use either invocation style:

1. Direct (most reliable across shells):
`npx tsx apps/cli/src/cli.ts <command> [options]`
Run once before direct mode (or whenever `packages/canvas-sdk/src` changes):
`npm run -w @nexgen/canvas-sdk build`
2. npm script wrapper:
`npm run dev -- <command> [options]`

### Command: `create`
Create a quiz in Canvas from a JSON file or from an agent prompt.

Options:
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--from-file <path>`: Path to Nexgen quiz JSON input.
- `--prompt <text>`: Prompt used to generate quiz content via quiz agent.
- `--prompt-file <path>`: Prompt file used to generate quiz content via quiz agent.
- `--title <title>`: Optional quiz title override.
- `--module-name <name>`: Optional module name to place the quiz into.
- `--after-header-title <title>`: Optional subheader title to place the quiz after. Requires `--module-name`.
- `--publish`: Publish quiz after create. Default is unpublished.
- `--skip-existing`: Reuse an existing quiz with the same target title.
- `--difficulty <level>`: Optional agent difficulty preference. One of `easy`, `medium`, `hard`, `mixed`.
- `--dry-run`: Validate/show summary only; no Canvas upload.

Rules:
- Provide exactly one of `--from-file`, `--prompt`, or `--prompt-file`.
- `--difficulty` only applies with `--prompt` or `--prompt-file`.
- If `--module-name` is provided, the quiz is placed under `QUIZ` by default unless `--after-header-title` is set explicitly.
- For file-based quizzes, set `settings.shuffleAnswers: true` in the JSON if you want the correct choice position randomized before upload.
- Agent-generated quizzes now request shuffled answers by default.

Examples:
```bash
npx tsx apps/cli/src/cli.ts create --from-file apps/cli/examples/nexgen-quiz.example.json --dry-run
npx tsx apps/cli/src/cli.ts create --from-file apps/cli/examples/nexgen-quiz.example.json
npx tsx apps/cli/src/cli.ts create --prompt "Year 9 chemistry: acids and bases" --course-id 12345 --dry-run
npx tsx apps/cli/src/cli.ts create --prompt "Year 9 chemistry: acids and bases" --difficulty hard --course-id 12345 --dry-run
npx tsx apps/cli/src/cli.ts create --prompt-file apps/cli/session-assets/example-course/Session\ 01\ -\ Example\ Build/QUIZ/prompt.md --title "Example Build Quiz" --module-name "Session 01 - Example Build" --skip-existing

# npm wrapper form
npm run dev -- create --from-file apps/cli/examples/nexgen-quiz.example.json --dry-run
```

### Command: `course-files-scaffold`
Create a folder scaffold in Canvas course `Files`.

Options:
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--from-file <path>`: Optional JSON file describing the folder tree. If omitted, the built-in default scaffold is used.
- `--dry-run`: Preview which folders would be created without changing Canvas.

Default scaffold:
- Top level: `Session_00` to `Session_08`, plus `BONUS_Session_09` and `BONUS_Session_10`
- Second level inside each top-level folder: `teachers_notes`, `what_are_we_doing_today`, `task_a`, `task_b`, `task_c`

JSON format:
- Either a root array of folders, or an object with a `folders` array.
- Each folder can be a string name or an object with `name` and optional `children`.
- Example file: `apps/cli/examples/course-files-scaffold.example.json`

Examples:
```bash
# Preview the built-in default structure
npx tsx apps/cli/src/cli.ts course-files-scaffold --course-id 21 --dry-run

# Create the built-in default structure in Canvas Files
npx tsx apps/cli/src/cli.ts course-files-scaffold --course-id 21

# Create a custom structure from JSON
npx tsx apps/cli/src/cli.ts course-files-scaffold --course-id 21 --from-file apps/cli/examples/course-files-scaffold.example.json
```

### Command: `session-headers`
Create standard session subheaders inside an existing module.

Options:
- `--module-name <name>`: Required. Exact Canvas module name.
- `--session <number>`: Required. Session number (for example, `1` for Session 01).
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--dry-run`: Preview headers only; no module updates.

Example:
```bash
npx tsx apps/cli/src/cli.ts session-headers --course-id 12345 --module-name "Term 1 - Module" --session 1 --dry-run

# npm wrapper form
npm run dev -- session-headers --course-id 12345 --module-name "Term 1 - Module" --session 1 --dry-run
```

### Command: `clone-survey`
Clone an existing quiz/survey into multiple session-numbered copies.

Options:
- `--source-title <title>`: Required. Exact source quiz title to clone.
- `--title-template <template>`: Optional. Use `{nn}` (zero-padded) and/or `{n}` (raw). If omitted, derived from source title.
- `--range <start-end>`: Inclusive session range (for example, `2-7`).
- `--sessions <numbers>`: Comma-separated sessions (for example, `2,3,5`).
- `--pad <number>`: Width for `{nn}` padding. Default `2`.
- `--source-course-id <id>`: Optional source Canvas course id. Defaults to `--course-id`.
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--skip-existing`: Skip generated titles that already exist.
- `--dry-run`: Preview only.

Rules:
- Provide exactly one of `--range` or `--sessions`.
- Cross-course clones strip course-scoped fields such as assignment group and availability dates.

Examples:
```bash
# Copy Session-01 survey to Session-02..07
npx tsx apps/cli/src/cli.ts clone-survey --course-id 21 --source-title "Weekly-Check-In-Session-01" --range 2-7 --dry-run

# Copy from a different source course into the target course
npx tsx apps/cli/src/cli.ts clone-survey --source-course-id 88 --course-id 21 --source-title "Weekly Check-In" --title-template "Weekly Check-In-Session-{nn}" --sessions 1,2,3,4,5,6,7,8 --skip-existing

# Custom template and explicit sessions
npx tsx apps/cli/src/cli.ts clone-survey --course-id 21 --source-title "Weekly-Check-In-Session-01" --title-template "Weekly-Check-In-Session-{nn}" --sessions 2,3,4,5,6,7

# npm wrapper form
npm run dev -- clone-survey --course-id 21 --source-title "Weekly-Check-In-Session-01" --range 2-7
```

### Command: `create-survey`
Create a Canvas survey from a `nexgen-survey.v1` JSON file.

Options:
- `--from-file <path>`: Required. Path to the survey JSON file.
- `--title <title>`: Optional survey title override.
- `--module-name <name>`: Optional module name to place the survey into.
- `--after-header-title <title>`: Optional subheader title to place the survey after. Requires `--module-name`.
- `--publish`: Publish survey after create. Default is unpublished.
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--skip-existing`: Reuse an existing survey with the same target title.
- `--dry-run`: Preview only.

Supported survey question types:
- `multiple_choice_question`
- `short_answer_question`
- `essay_question`
- `file_upload_question`

Examples:
```bash
# Preview survey creation only
npx tsx apps/cli/src/cli.ts create-survey --course-id 21 --from-file apps/cli/session-assets/example-course/shared/weekly-check-in.survey.json --title "Weekly Check-In-Session 01" --dry-run

# Create and place the survey under the Weekly Check-In header in a module
npx tsx apps/cli/src/cli.ts create-survey --course-id 21 --from-file apps/cli/session-assets/example-course/shared/weekly-check-in.survey.json --title "Weekly Check-In-Session 01" --module-name "Session 01 - Example Build" --after-header-title "Weekly Check-In" --skip-existing
```

### Command: `teacher-notes`
Generate teacher notes from existing session content.

Behavior notes:
- Uses whole-course session content (not just the target session module) to infer recurring teacher watchpoints.
- Uses a strict heading template from `apps/cli/src/session/teacherNotesTemplate.ts`, including a guaranteed `Most Common Issues` section.

Options:
- `--session-name <name>`: Required. Exact Canvas module name for the session.
- `--page-title <title>`: Required. Base title for teacher notes page.
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--draft`: Write/update draft notes page (`<page-title> (Draft)`), keep live module placement unchanged.
- `--dry-run`: Generate preview only; no Canvas updates.

Live mode behavior (default, when `--draft` is not set):
- Archives existing target page before overwrite.
- Creates or updates teacher notes page.
- Inserts/moves page to top of session module under `Teachers Notes`.

Draft mode behavior:
- Creates/updates draft page only.
- Does not archive live page.
- Does not change live module placement.

Examples:
```bash
# Draft iteration
npx tsx apps/cli/src/cli.ts teacher-notes --course-id 21 --session-name "Session 03 - The LCD Screen & 3x4 Matrix Keypad" --page-title "The LCD Screen & 3x4 Matrix Keypad" --draft

# Draft preview only
npx tsx apps/cli/src/cli.ts teacher-notes --course-id 21 --session-name "Session 03 - The LCD Screen & 3x4 Matrix Keypad" --page-title "The LCD Screen & 3x4 Matrix Keypad" --draft --dry-run

# Live publish (after draft approval)
npx tsx apps/cli/src/cli.ts teacher-notes --course-id 21 --session-name "Session 03 - The LCD Screen & 3x4 Matrix Keypad" --page-title "The LCD Screen & 3x4 Matrix Keypad"

# npm wrapper form
npm run dev -- teacher-notes --course-id 21 --session-name "Session 03 - The LCD Screen & 3x4 Matrix Keypad" --page-title "The LCD Screen & 3x4 Matrix Keypad" --draft --dry-run
```

### Command: `task-a-section`
Generate/update the `Task A` page from local session assets.

Options:
- `--session-name <name>`: Required. Exact Canvas module name for the session.
- `--task-folder <name>`: Optional folder name under `session-assets/<session-name>/`. If omitted, CLI auto-detects or defaults to `Task A`.
- `--page-title <title>`: Optional Canvas page title override. Default: `notes.md` `pageTitle` frontmatter value.
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--notes <text>`: Optional notes markdown override (saved to `notes.md`).
- `--notes-file <path>`: Optional notes markdown file override (saved to `notes.md`).
- `--publish`: Publish page after create/update. Default is unpublished.
- `--assets-root <path>`: Optional local assets root. Default: `apps/cli/session-assets`.
- `--dry-run`: Generate preview only; no Canvas updates or media uploads.

Task A asset skeleton (auto-created if missing):
- `notes.md` only (single source of truth)
- `images/` folder (for local image/video assets)
- New scaffolded `notes.md` files include starter sections for learning goals, materials, steps, a checklist, local image and video examples, a table example, callouts, a helpful link, and an optional `[AGENT]` block.

`notes.md` authoring:
- Preferred format is Markdown-first with `pageTitle` in frontmatter.
- Legacy processor tags still work during migration.

Legacy `notes.md` processor tags:
- `[IMAGE]file-name.jpg[/IMAGE]`
- `[YOUTUBE_LINK]https://youtu.be/...[/YOUTUBE_LINK]`
- `[NOTE]...[/NOTE]`, `[INFO]...[/INFO]`, `[WARNING]...[/WARNING]`, `[SUCCESS]...[/SUCCESS]`, `[QUESTION]...[/QUESTION]`
- `[AGENT]...[/AGENT]` (processor instruction only, not rendered)

Markdown-first reference example:
- See `docs/task-a-canonical-markdown-example.md` for a proposed canonical format based on `Session 05 - Soldering / TaskA / notes.md`.

Formatting behavior:
- `*** Heading` lines are converted to `<h3>`.
- Markdown bullet lists remain bullet lists.
- Page title in Canvas is used as the page heading (body heading is suppressed).
Global style override is supported via `.env` (`CONTENT_STYLE_NOTE`, `CONTENT_STYLE_INFO`, `CONTENT_STYLE_WARNING`, `CONTENT_STYLE_SUCCESS`, `CONTENT_STYLE_QUESTION`).
Use quotes around these values in `.env` so `#` color values parse correctly.

Local media behavior:
- Image/video files placed anywhere inside the Task A folder (including `images/`) are auto-detected.
- In non-dry-run mode they are uploaded to Canvas Files folder `Session_NN/task_a` and embedded in the page.
- In dry-run mode they are discovered but not uploaded.

Examples:
```bash
# Preview Task A HTML and discovered assets
npx tsx apps/cli/src/cli.ts task-a-section --course-id 21 --session-name "Session 05 - Soldering" --dry-run

# Use a custom task folder under session-assets and publish live
npx tsx apps/cli/src/cli.ts task-a-section --course-id 21 --session-name "Session 05 - Soldering" --task-folder "Soldering Basics" --publish

# Seed/update notes from a markdown file
npx tsx apps/cli/src/cli.ts task-a-section --course-id 21 --session-name "Session 05 - Soldering" --notes-file docs/session-05-task-a.md
```

### Command: `task-b-section`
Generate/update the `Task B` page from local session assets.

Options:
- `--session-name <name>`: Required. Exact Canvas module name for the session.
- `--task-folder <name>`: Optional folder name under `session-assets/<session-name>/`. If omitted, CLI auto-detects or defaults to `Task B`.
- `--page-title <title>`: Optional Canvas page title override. Default: `notes.md` `pageTitle` frontmatter value.
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--notes <text>`: Optional notes markdown override (saved to `notes.md`).
- `--notes-file <path>`: Optional notes markdown file override (saved to `notes.md`).
- `--publish`: Publish page after create/update. Default is unpublished.
- `--assets-root <path>`: Optional local assets root. Default: `apps/cli/session-assets`.
- `--dry-run`: Generate preview only; no Canvas updates or media uploads.

Behavior notes:
- Same Markdown-first / legacy-compatible authoring path as `task-a-section`.
- The default scaffold includes the same richer starter `notes.md` template used by Task A.
- Local media uploads target `Session_NN/task_b`.

Example:
```bash
npm run dev -- task-b-section --course-id 21 --session-name "Session 06 - Assembling the Safe" --dry-run
```

### Command: `task-c-section`
Generate/update the `Task C` page from local session assets.

Options:
- `--session-name <name>`: Required. Exact Canvas module name for the session.
- `--task-folder <name>`: Optional folder name under `session-assets/<session-name>/`. If omitted, CLI auto-detects or defaults to `Task C`.
- `--page-title <title>`: Optional Canvas page title override. Default: `notes.md` `pageTitle` frontmatter value.
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--notes <text>`: Optional notes markdown override (saved to `notes.md`).
- `--notes-file <path>`: Optional notes markdown file override (saved to `notes.md`).
- `--publish`: Publish page after create/update. Default is unpublished.
- `--assets-root <path>`: Optional local assets root. Default: `apps/cli/session-assets`.
- `--dry-run`: Generate preview only; no Canvas updates or media uploads.

Behavior notes:
- Same Markdown-first / legacy-compatible authoring path as `task-a-section`.
- The default scaffold includes the same richer starter `notes.md` template used by Task A.
- Local media uploads target `Session_NN/task_c`.

Example:
```bash
npm run dev -- task-c-section --course-id 21 --session-name "Session 06 - Assembling the Safe" --dry-run
```

### Command: `today-section`
Generate/update the intro page for the `What we are doing Today` section.

Options:
- `--session-name <name>`: Required. Exact Canvas module name for the session.
- `--page-title <title>`: Optional override. Default: `Introduction: <session topic>` (for example `Introduction: Soldering`).
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--notes <text>`: Optional raw notes draft. This is rewritten by the intro agent.
- `--notes-file <path>`: Optional raw notes file. This is rewritten by the intro agent.
- `--image-url <url>`: Optional image URL to embed.
- `--image-id <id>`: Optional existing Canvas file id to embed.
- `--image-file <path>`: Optional local image path relative to the active `What we are doing Today` assets folder.
- `--ai-image-prompt <text>`: Optional AI image brief text included in the page.
- `--publish`: Optional. Publish page after update/create. Default is unpublished.
- `--assets-root <path>`: Optional local assets root. Default: `apps/cli/session-assets`.
- `--dry-run`: Generate preview only; no Canvas updates.

Notes:
- The command creates local template files under:
  `apps/cli/session-assets/<session-name>/What we are doing Today/`
  or, when `course-orchestrate` derives a course-scoped root,
  `apps/cli/session-assets/<course-name>/<session-name>/What we are doing Today/`
- Created templates:
  - `notes.md`
  - `images/`
- If you override `--assets-root`, `--image-file` stays relative to that resolved session section folder.
- `--image-id` uses an already-uploaded Canvas file directly and skips local image discovery/upload for that run.
- `--image-url`, `--image-id`, and `--image-file` are mutually exclusive CLI inputs.
- `--image-file` selects a specific local image from that folder and disables the default auto-pick behavior.
- `--image-file` must stay inside that folder; absolute paths and escape paths are rejected.
- You can also place a local image file directly in that same folder (`image.png`, `image.jpg`, etc.).
- If `--image-id` is not used, the selected local image file takes priority over `--image-url` and `notes.md` `imageUrl`.
- Oversized local image files are auto-optimized (resize/compress) to keep web payloads controlled (target <= `450 KB`).
- On publish, local image files are uploaded to Canvas Files in `Session_NN/what_are_we_doing_today` first, then the page HTML is updated to use that uploaded file URL.
- Intro text is generated by the intro endpoint (`/today-intro`), not copied verbatim from notes.
- `notes.md` is the single source of truth and can include frontmatter keys `imageFile`, `imageUrl`, and `aiImagePrompt`.
- `imageFile` should be a relative path inside that same folder, for example `images/intro.jpg`.
- If `imageFile` is present and the file exists, it is used. If it does not exist, the section falls back to `imageUrl` or the placeholder image.
- `aiImagePrompt` stores the brief only. It does not generate an image by itself yet.
- Ensure the deployed canvas agent supports `POST /today-intro`.

Examples:
```bash
# Preview (agent rewrite + final HTML preview)
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 04 - Prototyping the Safe" --dry-run

# Use raw notes and a direct image URL
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 04 - Prototyping the Safe" --notes "In this session students wire and test the safe prototype before uploading code." --image-url "https://example.com/safe-prototype.jpg"

# Use an existing Canvas file id instead of uploading a new image
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 04 - Prototyping the Safe" --image-id 12345

# Use a specific local image file from the section assets folder
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 04 - Prototyping the Safe" --image-file "safe-prototype-2.jpg"

# Use notes from file + AI image brief
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 04 - Prototyping the Safe" --notes-file docs/session-04-intro.md --ai-image-prompt "A bright STEM classroom scene with students prototyping an ESP32 safe"

# Publish with auto title (Introduction: <topic>)
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 05 - Soldering"

# Publish live (otherwise defaults to unpublished)
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 05 - Soldering" --publish
```

### Command: `course-orchestrate`
Create or update multiple modules and pages from a JSON blueprint for an existing Canvas course.

Options:
- `--course-id <id>`: Required. Existing Canvas course id to target.
- `--from-file <path>`: Required. Path to the orchestration JSON blueprint.
- `--assets-root <path>`: Optional local root for section assets used by `today-section` and task section steps. If omitted, the default is `apps/cli/session-assets/<course-name>` derived from the blueprint folder name.
- `--prepare-assets`: Create/check local session asset files from the blueprint without Canvas writes.
- `--publish`: Publish supported content when a step does not set `publish` explicitly.
- `--dry-run`: Plan orchestration without Canvas writes.

Blueprint notes:
- Supported schema versions: `course-orchestrator.v1` and `course-orchestrator.v2`.
- `v1` uses the explicit shape `{ "schemaVersion": "course-orchestrator.v1", "modules": [...] }`.
- `v2` adds the template shape `{ "schemaVersion": "course-orchestrator.v2", "moduleTemplate": {...}, "sessions": [...] }`.
- `v2` is the recommended authoring format when you want to generate multiple session modules from one shared structure.
- Placeholders supported in `v2` string fields include `{n}`, `{nn}`, `{topic}`, and custom values from `sessions[].variables`.
- Each module entry can create the module if missing, then run ordered workflow steps.
- Supported step types: `session-headers`, `today-section`, `task-a-section`, `task-b-section`, `task-c-section`, `create-quiz`, `clone-survey`, `create-survey`, `subheader`, `page`.
- `page` steps use a typed `content` array. Supported content block types: `markdown`, `markdownFile`, `html`, `htmlFile`, `imageFile`.
- `today-section` and task section steps reuse the same logic as the standalone commands.
- `create-quiz` reuses the standalone quiz creation workflow and can generate a quiz from the cloud agent using a session-local prompt file under `QUIZ/prompt.md`.
- `--prepare-assets` is the recommended first pass for session-backed workflows. It materializes local `session-assets` folders and validates file-backed survey/page inputs before any live Canvas run.
- `clone-survey` reuses the survey clone workflow and can clone from another course into the target course, then place the survey under a module subheader such as `Weekly Check-In`.
- `clone-survey` step fields: `sourceTitle`, `title`, optional `sourceCourseId`, optional `afterHeaderTitle`, optional `skipExisting`.
- `create-quiz` step fields: optional `title`, optional `fromFile`, optional `prompt`, optional `promptFile`, optional `difficulty`, optional `afterHeaderTitle`, optional `skipExisting`, optional `publish`.
- `create-survey` creates a survey from a JSON file and can place it under a module subheader such as `Weekly Check-In`.
- `create-survey` step fields: `fromFile`, optional `title`, optional `afterHeaderTitle`, optional `skipExisting`, optional `publish`.
- Recommended repo layout:
  `apps/cli/course-assets/<course-name>/orchestrator.json`
  with authored content under `apps/cli/session-assets/<course-name>/...`.
- `page.content[].path`, `today-section.notesFile`, task `notesFile`, and `create-survey.fromFile` resolve relative to `apps/cli/session-assets/<course-name>/` first, then fall back to the blueprint file for backward compatibility.
- Prefer keeping `today-section` content in `apps/cli/session-assets/<course-name>/<session-name>/What we are doing Today/notes.md` and omit `today-section.notesFile` unless you explicitly want an override source.
- `course-orchestrate` stores session-backed local assets under `apps/cli/session-assets/<course-name>/...` by default so sessions from different courses do not mix.
- On a brand-new module, `--dry-run` can fully plan structural steps immediately. Module-aware content previews such as `today-section` may be skipped until the module exists or a live run creates it.
- Example blueprint: `apps/cli/course-assets/example-course/orchestrator.json`

Examples:
```bash
# Create/check local session asset folders and files before a live run
npx tsx apps/cli/src/cli.ts course-orchestrate --course-id 21 --from-file apps/cli/course-assets/example-course/orchestrator.json --prepare-assets

# Plan a multi-module orchestration run
npx tsx apps/cli/src/cli.ts course-orchestrate --course-id 21 --from-file apps/cli/course-assets/example-course/orchestrator.json --dry-run

# Apply the blueprint to the target course
npx tsx apps/cli/src/cli.ts course-orchestrate --course-id 21 --from-file apps/cli/course-assets/example-course/orchestrator.json
```

`clone-survey` step example:

```json
{
  "type": "clone-survey",
  "sourceCourseId": 88,
  "sourceTitle": "Weekly Check-In",
  "title": "Weekly Check-In-Session {nn}",
  "afterHeaderTitle": "Weekly Check-In",
  "skipExisting": true
}
```

`create-survey` step example:

```json
{
  "type": "create-survey",
  "fromFile": "shared/weekly-check-in.survey.json",
  "title": "Weekly Check-In-Session {nn}",
  "afterHeaderTitle": "Weekly Check-In",
  "skipExisting": true
}
```

`create-quiz` step example:

```json
{
  "type": "create-quiz",
  "title": "{topic} Quiz",
  "difficulty": "mixed",
  "skipExisting": true
}
```

### Plugins Runner
Use this for reusable, composable Canvas workflows implemented as plugins.
Reveal-answer plugin guide: `docs/reveal-answer-plugin.md`.
Canvas External App (LTI 1.3) guide: `docs/canvas-external-app-reveal-answer.md`.

Direct invocation:
```bash
npx tsx apps/plugins-runner/src/cli.ts list
npx tsx apps/plugins-runner/src/cli.ts run --plugin module-overview --course-id 21
npx tsx apps/plugins-runner/src/cli.ts run --plugin module-overview --course-id 21 --arg "moduleName=Session 03 - The LCD Screen & 3x4 Matrix Keypad"
npx tsx apps/plugins-runner/src/cli.ts run --plugin reveal-answer --arg "question=What is Ohm's Law?" --arg "answer=V = I * R"
npx tsx apps/plugins-runner/src/cli.ts run --plugin reveal-answer --arg "mode=both" --arg "answer=Your answer text" --arg "outDir=dist/reveal-answer-package"
```

Workspace script invocation:
```bash
npm run plugins:dev -- list
npm run plugins:dev -- run --plugin module-overview --course-id 21 --arg "moduleName=Session 03 - The LCD Screen & 3x4 Matrix Keypad"
npm run plugins:dev -- run --plugin reveal-answer --arg "answer=Your answer text"
```

`reveal-answer` packaging notes:
- Use `--arg outDir=<folder>` to generate a shareable folder with:
  - `reveal-answer.basic.html` (highest Canvas sanitizer compatibility)
  - `reveal-answer.enhanced.html` (open/close icon and pill state swap via `<style>`)
  - `reveal-answer.args.example.json` (editable parameter template)
  - `README.md` (Canvas install steps for others)
- Run with `--dry-run` to preview output paths without writing files.
- Fully parameterized text/design args are exposed in the command result under `parameterReference`.
