# Canvas External App: Reflection Question

This repo now includes a second LTI 1.3 tool inside `agent/` for student reflections.

It is exposed from the worker at:
- `GET /reflection/config`
- `GET /.well-known/reflection-jwks.json`
- `GET|POST /reflection/login`
- `POST /reflection/launch`
- `POST /reflection/respond`

Unlike the reveal-answer tool, this one is a learner-facing app with persistence. It renders a simple reflection question, saves the learner response, and reloads the current saved answer when the learner comes back.

## What gets stored

Each saved reflection is keyed per learner and question, with metadata for:
- Canvas issuer / client / deployment
- learner id, name, email
- course context id and title
- resource link id and title
- session id and title
- task id and title
- question id and question text
- answer text
- created and updated timestamps

## 1) Create the D1 database

From the `agent/` folder:

```bash
wrangler d1 create nexgen-reflections
```

Then add the returned binding details to `agent/wrangler.toml`:

```toml
[[d1_databases]]
binding = "REFLECTIONS_DB"
database_name = "nexgen-reflections"
database_id = "<your-d1-database-id>"
```

Apply the schema:

```bash
wrangler d1 execute nexgen-reflections --file migrations/0001_reflection_responses.sql
```

## 2) Configure worker vars and secrets

The reflection tool reuses the same signing keys and state secret as the reveal-answer LTI tool.

Required vars:
- `REFLECTION_LTI_CLIENT_ID`
- `REFLECTION_LTI_TITLE` (optional override)
- `REFLECTION_LTI_DESCRIPTION` (optional override)
- `LTI_ALLOWED_ISSUERS`

Required secrets:
- `LTI_TOOL_PRIVATE_JWK`
- `LTI_STATE_SECRET`

Optional:
- `LTI_TOOL_PUBLIC_JWK`
- `REFLECTION_LTI_BASE_URL`

## 3) Deploy the worker

```bash
cd agent
npm run deploy
```

## 4) Create the Canvas Developer Key

1. Open Canvas `Admin` -> account -> `Developer Keys`.
2. Create a new `LTI Key`.
3. Use:
   - **Enter URL**: `https://<your-worker>.workers.dev/reflection/config`
4. Save and turn the key `ON`.
5. Copy the generated client id.

Set `REFLECTION_LTI_CLIENT_ID` in `agent/wrangler.toml`, then deploy again.

## 5) Install the app

1. Canvas `Admin` or course `Settings` -> `Apps`.
2. `View App Configurations` -> `+ App`.
3. Configuration Type: `By Client ID`.
4. Paste the reflection tool client id and install.

## 6) Launch metadata

The tool reads these LTI custom parameters when present:
- `reflection_question` or `question`
- `question_id`
- `task_title`
- `task_id`
- `session_title`
- `session_id`

Fallback behavior:
- If no question is passed, the tool defaults to `What did you learn from this task?`
- If no `question_id` is passed, it derives one from the question text
- If no task/session title is passed, it falls back to the resource link title and context title where available

## Notes

- The UI is intentionally minimal: one question label, one expanding textarea, one `Save reflection` button.
- Responses are upserted, so re-saving the same learner/question updates the existing record instead of creating duplicates.
- The feedback / achievements page is not implemented yet, but the stored metadata is shaped to support that next step.
