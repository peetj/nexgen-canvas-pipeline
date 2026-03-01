import { Command } from "commander";
import fs from "node:fs/promises";
import { env } from "./env.js";
import { validateNexgenQuiz } from "./quiz/schema/validate.js";
import { CanvasClient } from "./canvas/canvasClient.js";
import { mapToCanvasQuiz } from "./quiz/quizMapper.js";
import { generateQuizFromAgent } from "./agent/quiz/quizAgentClient.js";
import { buildSessionHeaderTitles, resolveModuleByName } from "./session/sessionHeaders.js";
import { buildTeacherNotesForSession } from "./session/teacherNotes.js";
import { loadConfig } from "./config.js";

const program = new Command();
const TOKEN_PADDED = "{nn}";
const TOKEN_RAW = "{n}";
const QUIZ_READ_ONLY_FIELDS = new Set([
  "id",
  "quiz_id",
  "position",
  "quiz_group_id",
  "assessment_question_id",
  "created_at",
  "updated_at"
]);
const ANSWER_READ_ONLY_FIELDS = new Set([
  "id",
  "quiz_question_id",
  "question_id",
  "assessment_question_id",
  "position",
  "created_at",
  "updated_at"
]);

program
  .name("nexgen-canvas")
  .description("Run Nexgen Canvas automation workflows.")
  .version("0.1.0");

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function parsePositiveInteger(input: string, fieldName: string): number {
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${fieldName}. Provide a positive integer.`);
  }
  return parsed;
}

function parseRange(input: string): number[] {
  const match = input.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    throw new Error("Invalid --range. Use format start-end (for example, 2-7).");
  }

  const start = parsePositiveInteger(match[1], "--range start");
  const end = parsePositiveInteger(match[2], "--range end");

  if (end < start) {
    throw new Error("Invalid --range. End must be greater than or equal to start.");
  }

  const numbers: number[] = [];
  for (let value = start; value <= end; value += 1) {
    numbers.push(value);
  }
  return numbers;
}

function parseSessionList(input: string): number[] {
  const items = input
    .split(/[,\s]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (items.length === 0) {
    throw new Error("Invalid --sessions. Provide comma-separated numbers (for example, 2,3,5).");
  }

  const unique = new Set<number>();
  for (const item of items) {
    unique.add(parsePositiveInteger(item, "--sessions"));
  }

  return Array.from(unique).sort((a, b) => a - b);
}

function resolveSessionNumbers(rangeValue: string | undefined, sessionsValue: string | undefined): number[] {
  if (rangeValue && sessionsValue) {
    throw new Error("Use either --range or --sessions, not both.");
  }
  if (!rangeValue && !sessionsValue) {
    throw new Error("Provide one of --range or --sessions.");
  }
  return rangeValue ? parseRange(rangeValue) : parseSessionList(String(sessionsValue));
}

function deriveTitleTemplate(sourceTitle: string): string {
  const trimmed = sourceTitle.trim();
  const match = trimmed.match(/^(.*?)(\d+)\s*$/);
  if (match) {
    return `${match[1]}${TOKEN_PADDED}`;
  }
  return `${trimmed}-${TOKEN_PADDED}`;
}

function ensureTemplateToken(template: string): string {
  if (template.includes(TOKEN_PADDED) || template.includes(TOKEN_RAW)) {
    return template;
  }
  const separator = template.endsWith("-") ? "" : "-";
  return `${template}${separator}${TOKEN_PADDED}`;
}

function renderTitle(template: string, sessionNumber: number, pad: number): string {
  const padded = String(sessionNumber).padStart(pad, "0");
  return template.replaceAll(TOKEN_PADDED, padded).replaceAll(TOKEN_RAW, String(sessionNumber));
}

function sanitizeQuestionForCreate(raw: unknown): Record<string, unknown> {
  const source = typeof raw === "object" && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
  for (const field of QUIZ_READ_ONLY_FIELDS) {
    delete source[field];
  }

  if (Array.isArray(source.answers)) {
    source.answers = source.answers.map((answer) => {
      if (typeof answer !== "object" || answer === null) return answer;
      const clean = { ...(answer as Record<string, unknown>) };
      for (const field of ANSWER_READ_ONLY_FIELDS) {
        delete clean[field];
      }
      return clean;
    });
  }

  return source;
}

function buildQuizCloneInput(
  sourceQuiz: Record<string, unknown>,
  title: string
): {
  title: string;
  description?: string;
  quiz_type?: string;
  published?: boolean;
  time_limit?: number;
  allowed_attempts?: number;
  assignment_group_id?: number;
  shuffle_answers?: boolean;
  show_correct_answers?: boolean;
  scoring_policy?: string;
  one_question_at_a_time?: boolean;
  cant_go_back?: boolean;
  access_code?: string;
  ip_filter?: string;
  due_at?: string;
  lock_at?: string;
  unlock_at?: string;
  lock_questions_after_answering?: boolean;
  hide_results?: string;
} {
  return {
    title,
    description: typeof sourceQuiz.description === "string" ? sourceQuiz.description : undefined,
    quiz_type: typeof sourceQuiz.quiz_type === "string" ? sourceQuiz.quiz_type : undefined,
    published: typeof sourceQuiz.published === "boolean" ? sourceQuiz.published : undefined,
    time_limit: typeof sourceQuiz.time_limit === "number" ? sourceQuiz.time_limit : undefined,
    allowed_attempts: typeof sourceQuiz.allowed_attempts === "number" ? sourceQuiz.allowed_attempts : undefined,
    assignment_group_id:
      typeof sourceQuiz.assignment_group_id === "number" ? sourceQuiz.assignment_group_id : undefined,
    shuffle_answers: typeof sourceQuiz.shuffle_answers === "boolean" ? sourceQuiz.shuffle_answers : undefined,
    show_correct_answers:
      typeof sourceQuiz.show_correct_answers === "boolean" ? sourceQuiz.show_correct_answers : undefined,
    scoring_policy: typeof sourceQuiz.scoring_policy === "string" ? sourceQuiz.scoring_policy : undefined,
    one_question_at_a_time:
      typeof sourceQuiz.one_question_at_a_time === "boolean" ? sourceQuiz.one_question_at_a_time : undefined,
    cant_go_back: typeof sourceQuiz.cant_go_back === "boolean" ? sourceQuiz.cant_go_back : undefined,
    access_code: typeof sourceQuiz.access_code === "string" ? sourceQuiz.access_code : undefined,
    ip_filter: typeof sourceQuiz.ip_filter === "string" ? sourceQuiz.ip_filter : undefined,
    due_at: typeof sourceQuiz.due_at === "string" ? sourceQuiz.due_at : undefined,
    lock_at: typeof sourceQuiz.lock_at === "string" ? sourceQuiz.lock_at : undefined,
    unlock_at: typeof sourceQuiz.unlock_at === "string" ? sourceQuiz.unlock_at : undefined,
    lock_questions_after_answering:
      typeof sourceQuiz.lock_questions_after_answering === "boolean"
        ? sourceQuiz.lock_questions_after_answering
        : undefined,
    hide_results: typeof sourceQuiz.hide_results === "string" ? sourceQuiz.hide_results : undefined
  };
}

program.command("create")
  .description("Create a quiz in Canvas from a JSON file or from an agent prompt.")
  .option("--course-id <id>", "Canvas course id to upload to", String(env.canvasTestCourseId))
  .option("--from-file <path>", "Load Nexgen quiz JSON from file")
  .option("--prompt <text>", "Generate quiz from agent using a prompt")
  .option("--dry-run", "Validate and show a summary without uploading", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);

    if (!opts.fromFile && !opts.prompt) {
      throw new Error("Provide either --from-file or --prompt.");
    }
    if (opts.fromFile && opts.prompt) {
      throw new Error("Provide only one of --from-file or --prompt.");
    }

    let raw: unknown;

    if (opts.fromFile) {
      const txt = await fs.readFile(String(opts.fromFile), "utf8");
      raw = JSON.parse(txt);
    } else {
      raw = await generateQuizFromAgent(String(opts.prompt));
    }

    const quiz = validateNexgenQuiz(raw);
    const mapped = mapToCanvasQuiz(quiz);

    console.log(`Quiz: ${quiz.title}`);
    console.log(`Questions: ${quiz.questions.length} (expected 5)`);
    console.log(`Target course: ${courseId}`);
    if (opts.dryRun) {
      console.log("Dry run: no upload performed.");
      return;
    }

    const client = new CanvasClient();
    const created = await client.createQuiz(courseId, mapped.canvasQuiz);

    for (const q of mapped.canvasQuestions) {
      await client.addQuizQuestion(courseId, created.id, q);
    }

    if (mapped.canvasQuiz.published === false) {
      try {
        await client.updateQuiz(courseId, created.id, { published: true });
        await client.updateQuiz(courseId, created.id, { published: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: unable to refresh quiz question count. You can publish/unpublish manually. ${message}`);
      }
    }

    const urlGuess = created.html_url ?? `${env.canvasBaseUrl}/courses/${courseId}/quizzes/${created.id}`;
    console.log(`Created quiz id: ${created.id}`);
    console.log(`Quiz URL: ${urlGuess}`);
  });

program.command("session-headers")
  .description("Create session text headers inside an existing Canvas module.")
  .requiredOption("--module-name <name>", "Canvas module name to add headers to")
  .requiredOption("--session <number>", "Session number (e.g. 1 for Session 01)")
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--dry-run", "Show headers without creating them", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    const sessionNumber = Number(opts.session);
    const config = await loadConfig();
    const headers = buildSessionHeaderTitles(sessionNumber, config.sessions);
    const moduleName = String(opts.moduleName);

    const client = new CanvasClient();
    const module = await resolveModuleByName(client, courseId, moduleName);

    console.log(`Module: ${module.name} (${module.id})`);
    console.log(`Session: ${String(sessionNumber).padStart(2, "0")}`);
    console.log("Headers:");
    for (const title of headers) {
      console.log(`- ${title}`);
    }

    if (opts.dryRun) {
      console.log("Dry run: no module items created.");
      return;
    }

    for (const title of headers) {
      await client.createModuleSubHeader(courseId, module.id, title);
    }

    console.log("Session headers created.");
  });

program.command("clone-survey")
  .description("Clone a source quiz/survey into session-numbered copies with new titles.")
  .requiredOption("--source-title <title>", "Exact source quiz title to copy from")
  .option("--title-template <template>", "Title template using {nn} and/or {n}; defaults from source title")
  .option("--range <start-end>", "Inclusive session number range (for example, 2-7)")
  .option("--sessions <numbers>", "Comma-separated session numbers (for example, 2,3,5)")
  .option("--pad <number>", "Zero-padding width for {nn}", "2")
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--skip-existing", "Skip generated titles that already exist in the course", false)
  .option("--dry-run", "Show planned copies without creating quizzes", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    const sourceTitle = String(opts.sourceTitle).trim();
    if (!sourceTitle) {
      throw new Error("Invalid --source-title. Provide a non-empty quiz title.");
    }

    const pad = parsePositiveInteger(String(opts.pad), "--pad");
    const sessionNumbers = resolveSessionNumbers(
      opts.range ? String(opts.range) : undefined,
      opts.sessions ? String(opts.sessions) : undefined
    );
    const client = new CanvasClient();

    const sourceCandidates = await client.listQuizzes(courseId, sourceTitle);
    const sourceMatches = sourceCandidates.filter((quiz) => normalizeName(quiz.title) === normalizeName(sourceTitle));
    if (sourceMatches.length === 0) {
      const suggestions = sourceCandidates.map((quiz) => quiz.title).join(", ");
      if (!suggestions) {
        throw new Error(`No quizzes found matching "${sourceTitle}".`);
      }
      throw new Error(`No exact source quiz match for "${sourceTitle}". Closest matches: ${suggestions}`);
    }
    if (sourceMatches.length > 1) {
      const names = sourceMatches.map((quiz) => `${quiz.title} (${quiz.id})`).join(", ");
      throw new Error(`Multiple source quizzes matched "${sourceTitle}": ${names}`);
    }

    const sourceQuizSummary = sourceMatches[0];
    const sourceQuiz = await client.getQuiz(courseId, sourceQuizSummary.id);
    const sourceQuestions = await client.listQuizQuestions(courseId, sourceQuizSummary.id);

    const rawTemplate = opts.titleTemplate
      ? String(opts.titleTemplate)
      : deriveTitleTemplate(sourceQuizSummary.title);
    const titleTemplate = ensureTemplateToken(rawTemplate);
    const planned = sessionNumbers.map((sessionNumber) => ({
      sessionNumber,
      title: renderTitle(titleTemplate, sessionNumber, pad)
    }));

    const duplicatePlannedTitle = planned.find((item, index) =>
      planned.findIndex((other) => normalizeName(other.title) === normalizeName(item.title)) !== index
    );
    if (duplicatePlannedTitle) {
      throw new Error(`Generated duplicate title "${duplicatePlannedTitle.title}". Adjust --title-template.`);
    }

    const existingQuizzes = await client.listQuizzes(courseId);
    const existingTitleSet = new Set(existingQuizzes.map((quiz) => normalizeName(quiz.title)));
    const existingTargets = planned.filter((item) => existingTitleSet.has(normalizeName(item.title)));
    if (existingTargets.length > 0 && !opts.skipExisting) {
      const names = existingTargets.map((item) => item.title).join(", ");
      throw new Error(`Generated titles already exist: ${names}. Use --skip-existing to continue.`);
    }

    console.log(`Course: ${courseId}`);
    console.log(`Source quiz: ${sourceQuizSummary.title} (${sourceQuizSummary.id})`);
    console.log(`Source type: ${sourceQuiz.quiz_type ?? "assignment"}`);
    console.log(`Questions to copy: ${sourceQuestions.length}`);
    console.log(`Title template: ${titleTemplate}`);
    console.log("Planned copies:");
    for (const item of planned) {
      const exists = existingTitleSet.has(normalizeName(item.title));
      console.log(`- Session ${String(item.sessionNumber).padStart(pad, "0")}: ${item.title}${exists ? " [exists]" : ""}`);
    }

    if (opts.dryRun) {
      console.log("Dry run: no quizzes created.");
      return;
    }

    const skipped: string[] = [];
    const created: Array<{ id: number; title: string; html_url?: string }> = [];
    for (const item of planned) {
      if (existingTitleSet.has(normalizeName(item.title))) {
        if (opts.skipExisting) {
          skipped.push(item.title);
          continue;
        }
      }

      const newQuiz = await client.createQuiz(courseId, buildQuizCloneInput(sourceQuiz as Record<string, unknown>, item.title));
      for (const sourceQuestion of sourceQuestions) {
        await client.addQuizQuestion(courseId, newQuiz.id, sanitizeQuestionForCreate(sourceQuestion));
      }
      created.push(newQuiz);
      existingTitleSet.add(normalizeName(item.title));
      console.log(`Created: ${item.title} (${newQuiz.id})`);
    }

    console.log(`Created ${created.length} quiz copy/copies.`);
    if (skipped.length > 0) {
      console.log(`Skipped ${skipped.length} existing title(s): ${skipped.join(", ")}`);
    }
  });

program.command("teacher-notes")
  .description("Generate canonical-style Teacher Notes from an existing session module and insert the page at the top.")
  .requiredOption("--session-name <name>", "Exact Canvas module name for the session")
  .requiredOption("--page-title <title>", "Canvas page title for the generated Teacher Notes")
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--draft", "Publish/update a draft notes page and leave live module placement unchanged", false)
  .option("--dry-run", "Generate and preview without uploading", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    const sessionName = String(opts.sessionName);
    const rawPageTitle = String(opts.pageTitle);
    const isDraftMode = Boolean(opts.draft);
    const pageTitle = isDraftMode && !/\(draft\)\s*$/i.test(rawPageTitle)
      ? `${rawPageTitle} (Draft)`
      : rawPageTitle;
    const client = new CanvasClient();

    const built = await buildTeacherNotesForSession(client, courseId, sessionName, pageTitle);

    console.log(`Course: ${courseId}`);
    console.log(`Session module: ${built.module.name} (${built.module.id})`);
    console.log(`Mode: ${isDraftMode ? "draft" : "live"}`);
    console.log(`Source pages: ${built.modulePages.length}`);
    console.log(`Teacher notes title: ${pageTitle}`);
    console.log(`Target module position: ${built.insertionPosition}`);

    if (opts.dryRun) {
      console.log("Dry run: no Canvas updates performed.");
      console.log("Generated HTML preview:");
      console.log(built.notesHtml.split("\n").slice(0, 40).join("\n"));
      return;
    }

    const normalize = (v: string): string => v.trim().toLowerCase();
    const archivePage = async (pageUrl: string): Promise<string | undefined> => {
      const current = await client.getPage(courseId, pageUrl);
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      const archiveTitle = `${current.title} (Archive ${stamp})`;
      const archived = await client.createPage(courseId, {
        title: archiveTitle,
        body: current.body ?? "",
        published: false
      });
      return archived.title;
    };
    const existingModulePage = built.moduleItems.find(
      (item) => item.type === "Page" && normalize(item.title) === normalize(pageTitle) && !!item.page_url
    );

    let pageUrl: string;
    let createdPage = false;
    let createdModuleItem = false;
    let movedModuleItem = false;

    if (existingModulePage?.page_url) {
      pageUrl = existingModulePage.page_url;
      const archivedTitle = isDraftMode ? undefined : await archivePage(pageUrl);
      await client.updatePage(courseId, pageUrl, {
        title: pageTitle,
        body: built.notesHtml,
        published: true
      });
      if (archivedTitle) {
        console.log(`Archived previous page content: ${archivedTitle}`);
      }
    } else {
      const pages = await client.listPages(courseId, pageTitle);
      const existingPage = pages.find((page) => normalize(page.title) === normalize(pageTitle));

      if (existingPage) {
        pageUrl = existingPage.url;
        const archivedTitle = isDraftMode ? undefined : await archivePage(pageUrl);
        await client.updatePage(courseId, pageUrl, {
          title: pageTitle,
          body: built.notesHtml,
          published: true
        });
        if (archivedTitle) {
          console.log(`Archived previous page content: ${archivedTitle}`);
        }
      } else {
        const created = await client.createPage(courseId, {
          title: pageTitle,
          body: built.notesHtml,
          published: true
        });
        pageUrl = created.url;
        createdPage = true;
      }
    }

    if (!isDraftMode) {
      const moduleItemForPage = built.moduleItems.find(
        (item) => item.type === "Page" && item.page_url === pageUrl
      );

      if (!moduleItemForPage) {
        await client.createModulePageItem(courseId, built.module.id, {
          title: pageTitle,
          pageUrl,
          position: built.insertionPosition
        });
        createdModuleItem = true;
      } else if (moduleItemForPage.position !== built.insertionPosition) {
        await client.updateModuleItemPosition(
          courseId,
          built.module.id,
          moduleItemForPage.id,
          built.insertionPosition
        );
        movedModuleItem = true;
      }
    }

    console.log(createdPage ? "Created page." : "Updated existing page.");
    if (isDraftMode) {
      console.log("Draft mode: module placement unchanged.");
    } else {
      if (createdModuleItem) console.log("Added page to session module.");
      if (movedModuleItem) console.log("Moved module item to top of session.");
      if (!createdModuleItem && !movedModuleItem) console.log("Module item placement already correct.");
    }
    console.log(`Page URL: ${env.canvasBaseUrl}/courses/${courseId}/pages/${pageUrl}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
