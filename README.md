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
- `session-headers`: Adds standard Nexgen session subheaders to an existing Canvas module. This is used to scaffold a consistent module structure for a specific session number.
- `clone-survey`: Copies an existing quiz/survey into session-numbered variants. It can generate multiple target titles from a template and duplicate all questions from the source quiz.
- `teacher-notes`: Builds a canonical Teacher Notes page from existing session content. In live mode it updates module placement; in draft mode it prepares a safe draft page without changing live placement.
- `task-a-section`: Builds/updates a Task A page from `session-assets/<session>/<task-folder>/notes.md` and local media, applying processor tags and placing it under the `Session NN: Task A` header.
- `today-section`: Builds/updates the session introduction page for the `What we are doing Today` section. It rewrites notes via the intro agent, uploads local images to Canvas Files (`Session NN`), then applies final HTML.

### Plugins Runner (`apps/plugins-runner/src/cli.ts`)
- `list`: Shows available reusable Canvas workflow plugins that can be executed by the runner.
- `run`: Executes a selected plugin against a target course with optional plugin arguments for scoped behavior.

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
`npm run dev -- <command> -- [options]`

### Command: `create`
Create a quiz in Canvas from a JSON file or from an agent prompt.

Options:
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--from-file <path>`: Path to Nexgen quiz JSON input.
- `--prompt <text>`: Prompt used to generate quiz content via quiz agent.
- `--dry-run`: Validate/show summary only; no Canvas upload.

Rules:
- Provide exactly one of `--from-file` or `--prompt`.

Examples:
```bash
npx tsx apps/cli/src/cli.ts create --from-file apps/cli/examples/nexgen-quiz.example.json --dry-run
npx tsx apps/cli/src/cli.ts create --from-file apps/cli/examples/nexgen-quiz.example.json
npx tsx apps/cli/src/cli.ts create --prompt "Year 9 chemistry: acids and bases" --course-id 12345 --dry-run

# npm wrapper form
npm run dev -- create -- --from-file apps/cli/examples/nexgen-quiz.example.json --dry-run
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
npm run dev -- session-headers -- --course-id 12345 --module-name "Term 1 - Module" --session 1 --dry-run
```

### Command: `clone-survey`
Clone an existing quiz/survey into multiple session-numbered copies.

Options:
- `--source-title <title>`: Required. Exact source quiz title to clone.
- `--title-template <template>`: Optional. Use `{nn}` (zero-padded) and/or `{n}` (raw). If omitted, derived from source title.
- `--range <start-end>`: Inclusive session range (for example, `2-7`).
- `--sessions <numbers>`: Comma-separated sessions (for example, `2,3,5`).
- `--pad <number>`: Width for `{nn}` padding. Default `2`.
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--skip-existing`: Skip generated titles that already exist.
- `--dry-run`: Preview only.

Rules:
- Provide exactly one of `--range` or `--sessions`.

Examples:
```bash
# Copy Session-01 survey to Session-02..07
npx tsx apps/cli/src/cli.ts clone-survey --course-id 21 --source-title "Weekly-Check-In-Session-01" --range 2-7 --dry-run

# Custom template and explicit sessions
npx tsx apps/cli/src/cli.ts clone-survey --course-id 21 --source-title "Weekly-Check-In-Session-01" --title-template "Weekly-Check-In-Session-{nn}" --sessions 2,3,4,5,6,7

# npm wrapper form
npm run dev -- clone-survey --course-id 21 --source-title "Weekly-Check-In-Session-01" --range 2-7
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
npm run dev -- teacher-notes -- --course-id 21 --session-name "Session 03 - The LCD Screen & 3x4 Matrix Keypad" --page-title "The LCD Screen & 3x4 Matrix Keypad" --draft --dry-run
```

### Command: `task-a-section`
Generate/update the `Task A` page from local session assets.

Options:
- `--session-name <name>`: Required. Exact Canvas module name for the session.
- `--task-folder <name>`: Optional folder name under `session-assets/<session-name>/`. If omitted, CLI auto-detects or defaults to `Task A`.
- `--task-title <title>`: Optional Task A title override (otherwise read from `notes.md` `** Page Title` section).
- `--page-title <title>`: Optional Canvas page title override. Default: `notes.md` page title.
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--notes <text>`: Optional notes markdown override (saved to `notes.md`).
- `--notes-file <path>`: Optional notes markdown file override (saved to `notes.md`).
- `--publish`: Publish page after create/update. Default is unpublished.
- `--assets-root <path>`: Optional local assets root. Default: `apps/cli/session-assets`.
- `--dry-run`: Generate preview only; no Canvas updates or media uploads.

Task A asset skeleton (auto-created if missing):
- `notes.md` only (single source of truth)
- `images/` folder (for local image/video assets)

`notes.md` processor tags:
- `[IMAGE]file-name.jpg[/IMAGE]`
- `[YOUTUBE_LINK]https://youtu.be/...[/YOUTUBE_LINK]`
- `[NOTE]...[/NOTE]`, `[INFO]...[/INFO]`, `[WARNING]...[/WARNING]`, `[SUCCESS]...[/SUCCESS]`, `[QUESTION]...[/QUESTION]`
- `[AGENT]...[/AGENT]` (processor instruction only, not rendered)

Formatting behavior:
- `*** Heading` lines are converted to `<h3>`.
- Markdown bullet lists remain bullet lists.
- Page title in Canvas is used as the page heading (body heading is suppressed).
Global style override is supported via `.env` (`CONTENT_STYLE_NOTE`, `CONTENT_STYLE_INFO`, `CONTENT_STYLE_WARNING`, `CONTENT_STYLE_SUCCESS`, `CONTENT_STYLE_QUESTION`).
Use quotes around these values in `.env` so `#` color values parse correctly.

Local media behavior:
- Image/video files placed anywhere inside the Task A folder (including `images/`) are auto-detected.
- In non-dry-run mode they are uploaded to Canvas Files folder `Session NN` and embedded in the page.
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

### Command: `today-section`
Generate/update the intro page for the `What we are doing Today` section.

Options:
- `--session-name <name>`: Required. Exact Canvas module name for the session.
- `--page-title <title>`: Optional override. Default: `Introduction: <session topic>` (for example `Introduction: Soldering`).
- `--course-id <id>`: Canvas course id. Default: `CANVAS_TEST_COURSE_ID` from `.env`.
- `--notes <text>`: Optional raw notes draft. This is rewritten by the intro agent.
- `--notes-file <path>`: Optional raw notes file. This is rewritten by the intro agent.
- `--image-url <url>`: Optional image URL to embed.
- `--ai-image-prompt <text>`: Optional AI image brief text included in the page.
- `--publish`: Optional. Publish page after update/create. Default is unpublished.
- `--assets-root <path>`: Optional local assets root. Default: `apps/cli/session-assets`.
- `--dry-run`: Generate preview only; no Canvas updates.

Notes:
- The command creates local template files under:
  `apps/cli/session-assets/<session-name>/What we are doing Today/`
- Created templates:
  - `notes.md`
  - `image-url.txt`
  - `ai-image-prompt.txt`
- You can also place a local image file directly in that same folder (`image.png`, `image.jpg`, etc.).
- Local image file takes priority over `--image-url` and `image-url.txt`.
- Oversized local image files are auto-optimized (resize/compress) to keep web payloads controlled (target <= `450 KB`).
- On publish, local image files are uploaded to Canvas Files in `Session NN` first, then the page HTML is updated to use that uploaded file URL.
- Intro text is generated by the intro endpoint (`/today-intro`), not copied verbatim from notes.
- Ensure the deployed canvas agent supports `POST /today-intro`.

Examples:
```bash
# Preview (agent rewrite + final HTML preview)
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 04 - Prototyping the Safe" --dry-run

# Use raw notes and a direct image URL
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 04 - Prototyping the Safe" --notes "In this session students wire and test the safe prototype before uploading code." --image-url "https://example.com/safe-prototype.jpg"

# Use notes from file + AI image brief
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 04 - Prototyping the Safe" --notes-file docs/session-04-intro.md --ai-image-prompt "A bright STEM classroom scene with students prototyping an ESP32 safe"

# Publish with auto title (Introduction: <topic>)
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 05 - Soldering"

# Publish live (otherwise defaults to unpublished)
npx tsx apps/cli/src/cli.ts today-section --course-id 21 --session-name "Session 05 - Soldering" --publish
```

### Plugins Runner
Use this for reusable, composable Canvas workflows implemented as plugins.

Direct invocation:
```bash
npx tsx apps/plugins-runner/src/cli.ts list
npx tsx apps/plugins-runner/src/cli.ts run --plugin module-overview --course-id 21
npx tsx apps/plugins-runner/src/cli.ts run --plugin module-overview --course-id 21 --arg "moduleName=Session 03 - The LCD Screen & 3x4 Matrix Keypad"
```

Workspace script invocation:
```bash
npm run plugins:dev -- list
npm run plugins:dev -- run --plugin module-overview --course-id 21 --arg "moduleName=Session 03 - The LCD Screen & 3x4 Matrix Keypad"
```
