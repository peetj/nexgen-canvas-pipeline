import { Command } from "commander";
import { marked } from "marked";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";
import { validateNexgenQuiz } from "./quiz/schema/validate.js";
import { validateNexgenSurvey } from "./survey/schema/validate.js";
import { CanvasClient } from "./canvas/canvasClient.js";
import type { CanvasFolder, CanvasModuleItem, CanvasModuleSummary } from "./canvas/canvasClient.js";
import { mapToCanvasQuiz } from "./quiz/quizMapper.js";
import { mapToCanvasSurvey } from "./survey/surveyMapper.js";
import { generateQuizFromAgent } from "./agent/quiz/quizAgentClient.js";
import type { QuizDifficulty } from "./agent/quiz/quizAgentClient.js";
import { generateTodayIntroFromAgent } from "./agent/sessionIntro/todayIntroAgentClient.js";
import { buildSessionHeaderTitles, ensureModuleByName, resolveModuleByName } from "./session/sessionHeaders.js";
import { buildTeacherNotesForSession } from "./session/teacherNotes.js";
import {
  buildTaskASection,
  buildTaskBSection,
  buildTaskCSection,
  type TaskACalloutStyles,
  type TaskAMediaAsset
} from "./session/taskASection.js";
import { buildWhatAreWeDoingTodaySection } from "./session/whatAreWeDoingToday.js";
import { loadConfig } from "./config.js";
import { findLocalImageFile, LOCAL_IMAGE_EXTENSIONS } from "./localImage.js";

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
const TODAY_SECTION_ASSET_TITLE = "What we are doing Today";
const TASK_A_DEFAULT_FOLDER_NAME = "Task A";
const TASK_B_DEFAULT_FOLDER_NAME = "TaskB";
const TASK_C_DEFAULT_FOLDER_NAME = "TaskC";
const NOTE_PLACEHOLDER_TOKEN = "[ADD NOTES]";
const AI_PROMPT_PLACEHOLDER_TOKEN = "[ADD AI IMAGE PROMPT]";
const IMAGE_URL_PLACEHOLDER_TOKEN = "https://example.com/your-image.jpg";
const TASK_A_DEFAULT_PHILOSOPHY_TEXT =
  "Task A builds core confidence first: complete the essentials clearly and safely before moving into extension complexity.";

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

function parseQuizDifficulty(input: string, fieldName: string): QuizDifficulty {
  const normalized = input.trim().toLowerCase();
  if (
    normalized === "easy" ||
    normalized === "medium" ||
    normalized === "hard" ||
    normalized === "mixed"
  ) {
    return normalized;
  }
  throw new Error(`Invalid ${fieldName}. Use one of: easy, medium, hard, mixed.`);
}

function buildDefaultCanvasCourseFilesStructure(): CanvasFolderNode[] {
  const childNames = [
    "teacher_notes",
    "what_are_we_doing_today",
    "task_a",
    "task_b",
    "task_c"
  ];
  const standardSessions = Array.from({ length: 9 }, (_, idx) => `Session_${String(idx).padStart(2, "0")}`);
  const bonusSessions = ["BONUS_Session_09", "BONUS_Session_10"];

  return [...standardSessions, ...bonusSessions].map((name) => ({
    name,
    children: childNames.map((child) => ({ name: child }))
  }));
}

function parseCanvasFolderStructureInput(input: unknown): CanvasFolderNode[] {
  let root: unknown[] | undefined;
  if (Array.isArray(input)) {
    root = input;
  } else if (
    typeof input === "object" &&
    input !== null &&
    Array.isArray((input as CanvasFolderStructureFile).folders)
  ) {
    root = (input as CanvasFolderStructureFile).folders as unknown[];
  }

  if (!root) {
    throw new Error('Folder structure JSON must be an array or an object with a "folders" array.');
  }

  return root.map((entry, idx) => parseCanvasFolderNode(entry, `folders[${idx}]`));
}

function parseCanvasFolderNode(input: unknown, pathLabel: string): CanvasFolderNode {
  if (typeof input === "string") {
    return { name: validateCanvasFolderName(input, `${pathLabel}.name`) };
  }

  if (typeof input !== "object" || input === null) {
    throw new Error(`${pathLabel} must be a string or object.`);
  }

  const record = input as Record<string, unknown>;
  const name = validateCanvasFolderName(record.name, `${pathLabel}.name`);
  const childrenRaw = record.children;
  if (childrenRaw === undefined) {
    return { name };
  }
  if (!Array.isArray(childrenRaw)) {
    throw new Error(`${pathLabel}.children must be an array when provided.`);
  }

  return {
    name,
    children: childrenRaw.map((child, idx) => parseCanvasFolderNode(child, `${pathLabel}.children[${idx}]`))
  };
}

function validateCanvasFolderName(input: unknown, fieldName: string): string {
  if (typeof input !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} cannot be empty.`);
  }
  if (trimmed.includes("/")) {
    throw new Error(`${fieldName} cannot contain "/".`);
  }
  return trimmed;
}

function buildCanvasFolderPath(parentPath: string | undefined, folderName: string): string {
  return parentPath ? `${parentPath}/${folderName}` : folderName;
}

async function resolveExistingCourseFolder(
  client: CanvasClient,
  courseId: number,
  folderPath: string
): Promise<CanvasFolder | undefined> {
  try {
    const resolved = await client.resolveCourseFolderPath(courseId, folderPath);
    return resolved[resolved.length - 1];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("Canvas API error 404")) {
      return undefined;
    }
    throw err;
  }
}

async function ensureCanvasFolderTree(input: {
  client: CanvasClient;
  courseId: number;
  folders: CanvasFolderNode[];
  dryRun: boolean;
}): Promise<{
  createdPaths: string[];
  existingPaths: string[];
}> {
  const createdPaths: string[] = [];
  const existingPaths: string[] = [];

  for (const folder of input.folders) {
    await ensureCanvasFolderNode(
      input.client,
      input.courseId,
      folder,
      undefined,
      input.dryRun,
      createdPaths,
      existingPaths
    );
  }

  return { createdPaths, existingPaths };
}

async function ensureCanvasFolderNode(
  client: CanvasClient,
  courseId: number,
  folder: CanvasFolderNode,
  parentPath: string | undefined,
  dryRun: boolean,
  createdPaths: string[],
  existingPaths: string[]
): Promise<void> {
  const fullPath = buildCanvasFolderPath(parentPath, folder.name);
  const existing = await resolveExistingCourseFolder(client, courseId, fullPath);

  if (existing) {
    existingPaths.push(fullPath);
  } else if (dryRun) {
    createdPaths.push(fullPath);
  } else {
    await client.createCourseFolder(courseId, {
      name: folder.name,
      parentFolderPath: parentPath
    });
    createdPaths.push(fullPath);
  }

  for (const child of folder.children ?? []) {
    await ensureCanvasFolderNode(client, courseId, child, fullPath, dryRun, createdPaths, existingPaths);
  }
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
  title: string,
  options?: {
    preserveAssignmentGroup?: boolean;
    preserveAvailabilityDates?: boolean;
  }
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
  const preserveAssignmentGroup = options?.preserveAssignmentGroup ?? true;
  const preserveAvailabilityDates = options?.preserveAvailabilityDates ?? true;
  return {
    title,
    description: typeof sourceQuiz.description === "string" ? sourceQuiz.description : undefined,
    quiz_type: typeof sourceQuiz.quiz_type === "string" ? sourceQuiz.quiz_type : undefined,
    published: typeof sourceQuiz.published === "boolean" ? sourceQuiz.published : undefined,
    time_limit: typeof sourceQuiz.time_limit === "number" ? sourceQuiz.time_limit : undefined,
    allowed_attempts: typeof sourceQuiz.allowed_attempts === "number" ? sourceQuiz.allowed_attempts : undefined,
    assignment_group_id:
      preserveAssignmentGroup && typeof sourceQuiz.assignment_group_id === "number"
        ? sourceQuiz.assignment_group_id
        : undefined,
    shuffle_answers: typeof sourceQuiz.shuffle_answers === "boolean" ? sourceQuiz.shuffle_answers : undefined,
    show_correct_answers:
      typeof sourceQuiz.show_correct_answers === "boolean" ? sourceQuiz.show_correct_answers : undefined,
    scoring_policy: typeof sourceQuiz.scoring_policy === "string" ? sourceQuiz.scoring_policy : undefined,
    one_question_at_a_time:
      typeof sourceQuiz.one_question_at_a_time === "boolean" ? sourceQuiz.one_question_at_a_time : undefined,
    cant_go_back: typeof sourceQuiz.cant_go_back === "boolean" ? sourceQuiz.cant_go_back : undefined,
    access_code: typeof sourceQuiz.access_code === "string" ? sourceQuiz.access_code : undefined,
    ip_filter: typeof sourceQuiz.ip_filter === "string" ? sourceQuiz.ip_filter : undefined,
    due_at:
      preserveAvailabilityDates && typeof sourceQuiz.due_at === "string" ? sourceQuiz.due_at : undefined,
    lock_at:
      preserveAvailabilityDates && typeof sourceQuiz.lock_at === "string" ? sourceQuiz.lock_at : undefined,
    unlock_at:
      preserveAvailabilityDates && typeof sourceQuiz.unlock_at === "string" ? sourceQuiz.unlock_at : undefined,
    lock_questions_after_answering:
      typeof sourceQuiz.lock_questions_after_answering === "boolean"
        ? sourceQuiz.lock_questions_after_answering
        : undefined,
    hide_results: typeof sourceQuiz.hide_results === "string" ? sourceQuiz.hide_results : undefined
  };
}

async function findExactQuizByTitleIfExists(
  client: CanvasClient,
  courseId: number,
  quizTitle: string
): Promise<Awaited<ReturnType<CanvasClient["listQuizzes"]>>[number] | undefined> {
  const matches = (await client.listQuizzes(courseId, quizTitle)).filter(
    (quiz) => normalizeName(quiz.title) === normalizeName(quizTitle)
  );
  if (matches.length > 1) {
    const names = matches.map((quiz) => `${quiz.title} (${quiz.id})`).join(", ");
    throw new Error(`Multiple quizzes matched "${quizTitle}" in course ${courseId}: ${names}`);
  }
  return matches[0];
}

async function resolveExactQuizCloneSource(input: {
  client: CanvasClient;
  sourceCourseId: number;
  sourceTitle: string;
}): Promise<{
  summary: Awaited<ReturnType<CanvasClient["listQuizzes"]>>[number];
  quiz: Awaited<ReturnType<CanvasClient["getQuiz"]>>;
  questions: Awaited<ReturnType<CanvasClient["listQuizQuestions"]>>;
}> {
  const sourceCandidates = await input.client.listQuizzes(input.sourceCourseId, input.sourceTitle);
  const sourceMatches = sourceCandidates.filter(
    (quiz) => normalizeName(quiz.title) === normalizeName(input.sourceTitle)
  );
  if (sourceMatches.length === 0) {
    const suggestions = sourceCandidates.map((quiz) => quiz.title).join(", ");
    if (!suggestions) {
      throw new Error(
        `No quizzes found in source course ${input.sourceCourseId} matching "${input.sourceTitle}".`
      );
    }
    throw new Error(
      `No exact source quiz match for "${input.sourceTitle}" in course ${input.sourceCourseId}. Closest matches: ${suggestions}`
    );
  }
  if (sourceMatches.length > 1) {
    const names = sourceMatches.map((quiz) => `${quiz.title} (${quiz.id})`).join(", ");
    throw new Error(`Multiple source quizzes matched "${input.sourceTitle}": ${names}`);
  }

  const summary = sourceMatches[0];
  const quiz = await input.client.getQuiz(input.sourceCourseId, summary.id);
  const questions = await input.client.listQuizQuestions(input.sourceCourseId, summary.id);
  return { summary, quiz, questions };
}

async function cloneQuizToCourse(input: {
  client: CanvasClient;
  sourceCourseId: number;
  targetCourseId: number;
  sourceQuiz: Awaited<ReturnType<CanvasClient["getQuiz"]>>;
  sourceQuestions: Awaited<ReturnType<CanvasClient["listQuizQuestions"]>>;
  title: string;
}): Promise<{ id: number; title: string; html_url?: string }> {
  const preserveCourseScopedFields = input.sourceCourseId === input.targetCourseId;
  const created = await input.client.createQuiz(
    input.targetCourseId,
    buildQuizCloneInput(input.sourceQuiz as Record<string, unknown>, input.title, {
      preserveAssignmentGroup: preserveCourseScopedFields,
      preserveAvailabilityDates: preserveCourseScopedFields
    })
  );

  for (const sourceQuestion of input.sourceQuestions) {
    await input.client.addQuizQuestion(
      input.targetCourseId,
      created.id,
      sanitizeQuestionForCreate(sourceQuestion)
    );
  }

  return created;
}

type TodaySectionAssets = {
  folderPath: string;
  notesText?: string;
  imageUrl?: string;
  aiImagePrompt?: string;
  createdFiles: string[];
  imageSource: "local-file" | "cli-url" | "file-url" | "canvas-file-id" | "none";
  canvasImageId?: number;
  canvasImageDisplayName?: string;
  localImagePath?: string;
  localImageOriginalBytes?: number;
  localImageOutputBytes?: number;
  localImageOptimized?: boolean;
  localImageOutputMimeType?: string;
  localImageOutputBuffer?: Buffer;
  localImageOutputFileName?: string;
};

type TaskALocalMediaAsset = {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  contentType: string;
  kind: TaskAMediaAsset["kind"];
};

type TaskAAssets = {
  folderPath: string;
  createdFiles: string[];
  pageTitle?: string;
  notesText?: string;
  authoredBodyText?: string;
  iframeTemplate?: string;
  youtubeEmbedWidth?: number;
  philosophyText: string;
  calloutStyles?: TaskACalloutStyles;
  mediaUrls: TaskAMediaAsset[];
  localMedia: TaskALocalMediaAsset[];
};

type TaskAParsedNotes = {
  pageTitle?: string;
  authoredBodyText?: string;
  iframeTemplate?: string;
  youtubeEmbedWidth?: number;
  philosophy?: string;
  styles?: TaskACalloutStyles;
  mediaUrls: TaskAMediaAsset[];
};

type SessionMetadata = {
  sessionNumber?: number;
  sessionNumberPadded?: string;
  topic: string;
};
type CanvasFolderNode = {
  name: string;
  children?: CanvasFolderNode[];
};
type CanvasFolderStructureFile = {
  folders?: unknown;
};

type UpsertCoursePageResult = {
  pageUrl: string;
  createdPage: boolean;
};

type EnsureModulePagePlacementResult = {
  createdModuleItem: boolean;
  movedModuleItem: boolean;
};

type OrchestratorBlueprint = {
  schemaVersion: "course-orchestrator.v1" | "course-orchestrator.v2";
  modules: OrchestratorModuleSpec[];
};

type OrchestratorModuleSpec = {
  name: string;
  sessionNumber?: number;
  position?: number;
  steps: OrchestratorStep[];
};

type OrchestratorModuleTemplateSpec = {
  name: string;
  position?: number;
  steps: OrchestratorStep[];
};

type OrchestratorTemplateSessionSpec = {
  sessionNumber: number;
  topic: string;
  position?: number;
  variables?: Record<string, string>;
};

type OrchestratorSessionHeadersStep = {
  type: "session-headers";
  sessionNumber?: number;
};

type OrchestratorSubheaderStep = {
  type: "subheader";
  title: string;
};

type OrchestratorPageContentBlock =
  | { type: "markdown"; value: string }
  | { type: "markdownFile"; path: string }
  | { type: "html"; value: string }
  | { type: "htmlFile"; path: string }
  | { type: "imageFile"; path: string; alt?: string; filesFolder: string };

type OrchestratorPageStep = {
  type: "page";
  title: string;
  publish?: boolean;
  afterHeaderTitle?: string;
  content: OrchestratorPageContentBlock[];
};

type OrchestratorTodaySectionStep = {
  type: "today-section";
  pageTitle?: string;
  notes?: string;
  notesFile?: string;
  imageUrl?: string;
  imageId?: number;
  imageFile?: string;
  aiImagePrompt?: string;
  publish?: boolean;
};

type OrchestratorTaskSectionStep = {
  type: "task-a-section" | "task-b-section" | "task-c-section";
  taskFolder?: string;
  pageTitle?: string;
  notes?: string;
  notesFile?: string;
  publish?: boolean;
};

type OrchestratorCloneSurveyStep = {
  type: "clone-survey";
  sourceTitle: string;
  title: string;
  sourceCourseId?: number;
  afterHeaderTitle?: string;
  skipExisting?: boolean;
};

type OrchestratorCreateSurveyStep = {
  type: "create-survey";
  fromFile: string;
  title?: string;
  afterHeaderTitle?: string;
  skipExisting?: boolean;
  publish?: boolean;
};

type OrchestratorStep =
  | OrchestratorSessionHeadersStep
  | OrchestratorSubheaderStep
  | OrchestratorPageStep
  | OrchestratorTodaySectionStep
  | OrchestratorTaskSectionStep
  | OrchestratorCloneSurveyStep
  | OrchestratorCreateSurveyStep;
const LOCAL_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".ogg",
  ".m4v",
  ".mov"
]);
const TASK_A_TEMPLATE_FILE_NAMES = new Set(["notes.md"]);
const MAX_LOCAL_IMAGE_BYTES = 450 * 1024;
const LOCAL_IMAGE_WEBP_WIDTHS = [1920, 1600, 1366, 1280, 1024, 900, 768, 640];
const LOCAL_IMAGE_WEBP_QUALITIES = [82, 76, 70, 64, 58, 52, 46];

function toFilesystemSegment(input: string): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "untitled";
  return cleaned;
}

function parseSessionMetadata(sessionName: string): SessionMetadata {
  const trimmed = sessionName.replace(/\s+/g, " ").trim();
  const match = trimmed.match(/^Session\s*(\d+)\s*-\s*(.+)$/i);
  if (!match) {
    return { topic: trimmed || "Session Overview" };
  }
  const number = Number(match[1]);
  const topic = match[2].trim();
  return {
    sessionNumber: Number.isFinite(number) ? number : undefined,
    sessionNumberPadded: Number.isFinite(number) ? String(number).padStart(2, "0") : undefined,
    topic: topic || trimmed
  };
}

function buildIntroductionPageTitle(sessionName: string): string {
  const meta = parseSessionMetadata(sessionName);
  return `Introduction: ${meta.topic}`;
}

function buildCanvasSectionFilesFolderPath(
  sessionMeta: SessionMetadata,
  sectionFolderName: string
): string {
  if (!sessionMeta.sessionNumberPadded) {
    throw new Error("Session number is required to build a Canvas Files folder path.");
  }
  return `Session_${sessionMeta.sessionNumberPadded}/${sectionFolderName}`;
}

async function ensureFileWithTemplate(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false;
  } catch (err) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") throw err;
    await fs.writeFile(filePath, content, "utf8");
    return true;
  }
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") return undefined;
    throw err;
  }
}

function normalizeNotesText(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const normalized = input.replace(/\r\n/g, "\n").trim();
  if (!normalized) return undefined;
  if (normalized.toLowerCase().includes(NOTE_PLACEHOLDER_TOKEN.toLowerCase())) return undefined;
  return normalized;
}

function normalizeSingleLineInput(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const normalized = input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  if (!normalized) return undefined;

  const lower = normalized.toLowerCase();
  if (lower.includes(AI_PROMPT_PLACEHOLDER_TOKEN.toLowerCase())) return undefined;
  if (lower.includes(IMAGE_URL_PLACEHOLDER_TOKEN.toLowerCase())) return undefined;
  return normalized;
}

function normalizeTaskInlineInput(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const normalized = input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
  if (!normalized) return undefined;
  return normalized;
}

function normalizeTaskBlockText(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const normalized = input.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function mimeTypeForImageExtension(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".avif":
      return "image/avif";
    default:
      return undefined;
  }
}

function mimeTypeForTaskMedia(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".avif":
      return "image/avif";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".ogg":
      return "video/ogg";
    case ".m4v":
      return "video/x-m4v";
    case ".mov":
      return "video/quicktime";
    default:
      return undefined;
  }
}

function classifyTaskMediaKindByPath(filePath: string): TaskAMediaAsset["kind"] {
  const ext = path.extname(filePath).toLowerCase();
  if (LOCAL_IMAGE_EXTENSIONS.has(ext)) return "image";
  if (LOCAL_VIDEO_EXTENSIONS.has(ext)) return "video";
  return "file";
}

function classifyTaskMediaKindByUrl(url: string): TaskAMediaAsset["kind"] {
  const normalized = url.trim();
  if (!normalized) return "file";
  const lower = normalized.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be") || lower.includes("vimeo.com")) {
    return "video";
  }

  try {
    const parsed = new URL(normalized);
    const ext = path.extname(parsed.pathname).toLowerCase();
    if (LOCAL_IMAGE_EXTENSIONS.has(ext)) return "image";
    if (LOCAL_VIDEO_EXTENSIONS.has(ext)) return "video";
  } catch {
    const ext = path.extname(normalized).toLowerCase();
    if (LOCAL_IMAGE_EXTENSIONS.has(ext)) return "image";
    if (LOCAL_VIDEO_EXTENSIONS.has(ext)) return "video";
  }

  return "file";
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/svg+xml":
      return ".svg";
    case "image/avif":
      return ".avif";
    default:
      return "";
  }
}

async function optimizeImageBufferWithSharp(
  source: Buffer,
  maxBytes: number
): Promise<{ buffer: Buffer; mimeType: string; optimized: boolean }> {
  const sharpModule = await import("sharp");
  const sharp = sharpModule.default;

  let best = source;
  for (const width of LOCAL_IMAGE_WEBP_WIDTHS) {
    for (const quality of LOCAL_IMAGE_WEBP_QUALITIES) {
      const candidate = await sharp(source, { failOn: "none", animated: false })
        .rotate()
        .resize({ width, withoutEnlargement: true, fit: "inside" })
        .webp({ quality, effort: 4 })
        .toBuffer();

      if (candidate.byteLength < best.byteLength) {
        best = candidate;
      }
      if (candidate.byteLength <= maxBytes) {
        return {
          buffer: candidate,
          mimeType: "image/webp",
          optimized: true
        };
      }
    }
  }

  return {
    buffer: best,
    mimeType: "image/webp",
    optimized: best.byteLength < source.byteLength
  };
}

async function imageFileToDataUrl(filePath: string): Promise<{
  dataUrl: string;
  originalByteLength: number;
  outputByteLength: number;
  optimized: boolean;
  outputMimeType: string;
  outputBuffer: Buffer;
}> {
  const mime = mimeTypeForImageExtension(filePath);
  if (!mime) {
    throw new Error(`Unsupported local image type for "${filePath}".`);
  }

  const source = Buffer.from(await fs.readFile(filePath));
  if (source.byteLength <= MAX_LOCAL_IMAGE_BYTES) {
    return {
      dataUrl: `data:${mime};base64,${source.toString("base64")}`,
      originalByteLength: source.byteLength,
      outputByteLength: source.byteLength,
      optimized: false,
      outputMimeType: mime,
      outputBuffer: source
    };
  }

  let optimizedBuffer: Buffer = source;
  let outputMimeType = mime;
  let optimized = false;
  try {
    const compressed = await optimizeImageBufferWithSharp(source, MAX_LOCAL_IMAGE_BYTES);
    optimizedBuffer = compressed.buffer;
    outputMimeType = compressed.mimeType;
    optimized = compressed.optimized;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Local image is ${formatByteSize(source.byteLength)} and auto-compression failed: ${message}`
    );
  }

  if (optimizedBuffer.byteLength > MAX_LOCAL_IMAGE_BYTES) {
    throw new Error(
      `Local image is still too large after compression (${formatByteSize(optimizedBuffer.byteLength)}). ` +
      `Please use a smaller image (target <= ${formatByteSize(MAX_LOCAL_IMAGE_BYTES)}).`
    );
  }

  return {
    dataUrl: `data:${outputMimeType};base64,${optimizedBuffer.toString("base64")}`,
    originalByteLength: source.byteLength,
    outputByteLength: optimizedBuffer.byteLength,
    optimized,
    outputMimeType,
    outputBuffer: optimizedBuffer
  };
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}

function sanitizeTodaySectionPreviewHtml(html: string): string {
  return html.replace(/src="data:[^"]+"/gi, 'src="[local-image-data-uri]"');
}

function toPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h1|h2|h3|h4|h5|h6|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractParagraphsFromHtml(html: string, max = 2): string[] {
  const matches = Array.from(html.matchAll(/<p>([\s\S]*?)<\/p>/gi));
  const out: string[] = [];
  for (const match of matches) {
    const text = toPlainText(match[1] ?? "");
    if (!text) continue;
    if (/inspiration image placeholder/i.test(text)) continue;
    if (/^ai image brief:/i.test(text)) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function extractTaskLabels(moduleItems: Array<{ type: string; title: string }>): string[] {
  return moduleItems
    .filter((item) => item.type === "SubHeader")
    .map((item) => item.title.trim())
    .filter((title) => /^Session\s+\d+\s*:\s*Task\s+[A-Za-z0-9]+/i.test(title))
    .map((title) => title.replace(/\s+/g, " "));
}

type CanvasFileUploadInit = {
  upload_url: string;
  upload_params: Record<string, unknown>;
  file_param?: string;
};

type CanvasUploadedFile = {
  id: number;
  url: string;
  display_name?: string;
  folder_id?: number;
  size?: number;
  content_type?: string;
};

async function uploadFileToCanvasSessionFolder(input: {
  courseId: number;
  sessionFolderPath: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}): Promise<CanvasUploadedFile> {
  const initBody = new URLSearchParams({
    name: input.fileName,
    size: String(input.data.byteLength),
    content_type: input.contentType,
    parent_folder_path: input.sessionFolderPath,
    on_duplicate: "rename"
  });

  const initRes = await fetch(`${env.canvasBaseUrl}/api/v1/courses/${input.courseId}/files`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.canvasApiToken}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: initBody.toString()
  });
  if (!initRes.ok) {
    const text = await initRes.text().catch(() => "");
    throw new Error(
      `Canvas file upload init failed ${initRes.status} ${initRes.statusText}\n${text}`
    );
  }
  const init = (await initRes.json()) as CanvasFileUploadInit;

  const uploadForm = new FormData();
  for (const [key, value] of Object.entries(init.upload_params ?? {})) {
    if (value === undefined || value === null) continue;
    uploadForm.append(key, String(value));
  }
  const paramName = init.file_param && init.file_param.trim().length > 0 ? init.file_param : "file";
  const arrayBuffer = Uint8Array.from(input.data).buffer;
  uploadForm.append(paramName, new Blob([arrayBuffer], { type: input.contentType }), input.fileName);

  const uploadRes = await fetch(init.upload_url, {
    method: "POST",
    body: uploadForm,
    redirect: "follow"
  });
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(
      `Canvas file upload failed ${uploadRes.status} ${uploadRes.statusText}\n${text}`
    );
  }

  const uploaded = (await uploadRes.json()) as CanvasUploadedFile;
  if (!uploaded?.url) {
    throw new Error("Canvas file upload succeeded but returned no file URL.");
  }
  return uploaded;
}

async function uploadImageToCanvasSessionFolder(input: {
  courseId: number;
  sessionFolderPath: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}): Promise<CanvasUploadedFile> {
  return uploadFileToCanvasSessionFolder(input);
}

async function prepareTodaySectionAssets(input: {
  assetsRoot: string;
  sessionName: string;
  sectionTitle: string;
  notesText?: string;
  notesFilePath?: string;
  imageUrl?: string;
  imageId?: number;
  imageFilePath?: string;
  aiImagePrompt?: string;
  client?: CanvasClient;
}): Promise<TodaySectionAssets> {
  const folderPath = path.resolve(
    input.assetsRoot,
    toFilesystemSegment(input.sessionName),
    toFilesystemSegment(input.sectionTitle)
  );
  await fs.mkdir(folderPath, { recursive: true });

  const notesPath = path.resolve(folderPath, "notes.md");
  const imageUrlPath = path.resolve(folderPath, "image-url.txt");
  const aiPromptPath = path.resolve(folderPath, "ai-image-prompt.txt");

  const createdFiles: string[] = [];
  const notesTemplate = `${NOTE_PLACEHOLDER_TOKEN}

Write one or two short paragraphs that explain what students are doing in this session.
`;
  const imageTemplate = `${IMAGE_URL_PLACEHOLDER_TOKEN}
`;
  const aiPromptTemplate = `${AI_PROMPT_PLACEHOLDER_TOKEN}
`;

  if (await ensureFileWithTemplate(notesPath, notesTemplate)) createdFiles.push(notesPath);
  if (await ensureFileWithTemplate(imageUrlPath, imageTemplate)) createdFiles.push(imageUrlPath);
  if (await ensureFileWithTemplate(aiPromptPath, aiPromptTemplate)) createdFiles.push(aiPromptPath);

  let notesText = normalizeNotesText(input.notesText);
  if (!notesText && input.notesFilePath) {
    const loaded = await fs.readFile(path.resolve(input.notesFilePath), "utf8");
    notesText = normalizeNotesText(loaded);
  }
  if (!notesText) {
    notesText = normalizeNotesText(await readTextIfExists(notesPath));
  } else {
    await fs.writeFile(notesPath, `${notesText}\n`, "utf8");
  }

  let imageUrl: string | undefined;
  let imageSource: TodaySectionAssets["imageSource"] = "none";
  let canvasImageId: number | undefined;
  let canvasImageDisplayName: string | undefined;
  let localImagePath: string | undefined;
  let localImageOriginalBytes: number | undefined;
  let localImageOutputBytes: number | undefined;
  let localImageOptimized: boolean | undefined;
  let localImageOutputMimeType: string | undefined;
  let localImageOutputBuffer: Buffer | undefined;
  let localImageOutputFileName: string | undefined;
  if (input.imageId !== undefined) {
    if (!input.client) {
      throw new Error("Canvas client is required to resolve --image-id.");
    }
    const canvasFile = await input.client.getFile(input.imageId);
    if (!canvasFile.url) {
      throw new Error(`Canvas file ${input.imageId} has no embeddable URL.`);
    }
    imageUrl = canvasFile.url;
    canvasImageId = canvasFile.id;
    canvasImageDisplayName = canvasFile.display_name ?? canvasFile.filename;
    imageSource = "canvas-file-id";
  } else {
    localImagePath = await findLocalImageFile(folderPath, input.imageFilePath);
    imageUrl = normalizeSingleLineInput(input.imageUrl);
    if (!imageUrl) {
      imageUrl = normalizeSingleLineInput(await readTextIfExists(imageUrlPath));
    } else {
      await fs.writeFile(imageUrlPath, `${imageUrl}\n`, "utf8");
    }

    if (localImagePath) {
      const converted = await imageFileToDataUrl(localImagePath);
      imageUrl = converted.dataUrl;
      localImageOriginalBytes = converted.originalByteLength;
      localImageOutputBytes = converted.outputByteLength;
      localImageOptimized = converted.optimized;
      localImageOutputMimeType = converted.outputMimeType;
      localImageOutputBuffer = converted.outputBuffer;
      const baseName = path.basename(localImagePath, path.extname(localImagePath));
      const ext = extensionForMimeType(converted.outputMimeType) || path.extname(localImagePath);
      localImageOutputFileName = `${toFilesystemSegment(baseName)}${ext}`;
      imageSource = "local-file";
    } else if (input.imageUrl && normalizeSingleLineInput(input.imageUrl)) {
      imageSource = "cli-url";
    } else if (imageUrl) {
      imageSource = "file-url";
    }
  }

  let aiImagePrompt = normalizeSingleLineInput(input.aiImagePrompt);
  if (!aiImagePrompt) {
    aiImagePrompt = normalizeSingleLineInput(await readTextIfExists(aiPromptPath));
  } else {
    await fs.writeFile(aiPromptPath, `${aiImagePrompt}\n`, "utf8");
  }

  return {
    folderPath,
    notesText,
    imageUrl,
    aiImagePrompt,
    createdFiles,
    imageSource,
    canvasImageId,
    canvasImageDisplayName,
    localImagePath,
    localImageOriginalBytes,
    localImageOutputBytes,
    localImageOptimized,
    localImageOutputMimeType,
    localImageOutputBuffer,
    localImageOutputFileName
  };
}

function normalizeLooseKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function resolveTaskFolderName(
  assetsRoot: string,
  sessionName: string,
  taskLetter: "A" | "B" | "C",
  defaultFolderName: string,
  explicitFolderName?: string
): Promise<string> {
  if (explicitFolderName && explicitFolderName.trim().length > 0) {
    return explicitFolderName.trim();
  }

  const sessionFolderPath = path.resolve(assetsRoot, toFilesystemSegment(sessionName));
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(sessionFolderPath, { withFileTypes: true });
  } catch (err) {
    const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === "ENOENT") {
      return defaultFolderName;
    }
    throw err;
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => normalizeLooseKey(name) !== normalizeLooseKey(TODAY_SECTION_ASSET_TITLE));

  if (directories.length === 0) return defaultFolderName;

  const targetSpace = `task ${taskLetter.toLowerCase()}`;
  const targetCompact = `task${taskLetter.toLowerCase()}`;
  const taskCandidate = directories.find((name) => {
    const key = normalizeLooseKey(name);
    const compact = key.replace(/\s+/g, "");
    return key === targetSpace || key.startsWith(`${targetSpace} `) || compact === targetCompact || compact.startsWith(`${targetCompact}`);
  });
  if (taskCandidate) return taskCandidate;

  if (directories.length === 1) return directories[0];
  return defaultFolderName;
}

async function collectTaskALocalMedia(folderPath: string): Promise<TaskALocalMediaAsset[]> {
  const files: TaskALocalMediaAsset[] = [];
  await walkTaskAAssets(folderPath, folderPath, files);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function walkTaskAAssets(
  rootPath: string,
  currentPath: string,
  out: TaskALocalMediaAsset[]
): Promise<void> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.resolve(currentPath, entry.name);
    if (entry.isDirectory()) {
      await walkTaskAAssets(rootPath, absolutePath, out);
      continue;
    }

    if (!entry.isFile()) continue;
    if (TASK_A_TEMPLATE_FILE_NAMES.has(entry.name.toLowerCase())) continue;

    const kind = classifyTaskMediaKindByPath(entry.name);
    if (kind === "file") continue;

    const contentType = mimeTypeForTaskMedia(entry.name);
    if (!contentType) continue;

    out.push({
      absolutePath,
      relativePath: path.relative(rootPath, absolutePath).replace(/\\/g, "/"),
      fileName: entry.name,
      contentType,
      kind
    });
  }
}

function parseTaskAAuthoredNotes(notesText: string): TaskAParsedNotes {
  let working = notesText.replace(/\r\n/g, "\n");
  const frontmatter = parseTaskAFrontmatter(working);
  working = frontmatter.body;
  const styles = parseTaskAStylesSection(working);
  const mediaUrls = parseTaskAMediaUrlsFromText(working);

  let pageTitle = normalizeTaskInlineInput(frontmatter.pageTitle);
  const pageHeadingMatch = pageTitle ? null : working.match(/^\s*(?:\*\*|#{1,6})\s*page title\s*$/im);
  if (pageHeadingMatch) {
    const headingIndex = pageHeadingMatch.index ?? 0;
    const before = working.slice(0, headingIndex);
    const afterHeading = working.slice(headingIndex + pageHeadingMatch[0].length);
    const afterLines = afterHeading.split("\n");

    let titleLineIndex = -1;
    for (let i = 0; i < afterLines.length; i += 1) {
      const line = afterLines[i].trim();
      if (!line) continue;
      if (/^\s*(?:\*\*|#{1,6})\s*/.test(line)) break;
      pageTitle = line;
      titleLineIndex = i;
      break;
    }

    if (titleLineIndex >= 0) {
      const remaining = afterLines.slice(titleLineIndex + 1).join("\n");
      working = `${before}\n${remaining}`.replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  let iframeTemplate: string | undefined;
  working = working.replace(/\[AGENT\]([\s\S]*?)\[\/AGENT\]/gi, (_, content: string) => {
    if (!iframeTemplate) {
      const snippetMatch = content.match(/<iframe[\s\S]*?<\/iframe>/i);
      if (snippetMatch) {
        iframeTemplate = snippetMatch[0].trim();
      }
    }
    return "";
  });

  // Remove optional inline style declaration lines from rendered body.
  working = working
    .replace(/^\s*(?:\*\*|#{1,6})\s*styles\s*$/gim, "")
    .replace(/^\s*(NOTE|INFO|WARNING|SUCCESS|QUESTION)\s*:\s*style\s*=\s*["'][^"']+["']\s*$/gim, "");

  return {
    pageTitle: normalizeTaskInlineInput(pageTitle),
    authoredBodyText: normalizeTaskBlockText(working),
    iframeTemplate,
    youtubeEmbedWidth: frontmatter.youtubeEmbedWidth,
    styles,
    mediaUrls
  };
}

function parseTaskAFrontmatter(raw: string): {
  body: string;
  pageTitle?: string;
  youtubeEmbedWidth?: number;
} {
  const normalized = raw.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) {
    return { body: normalized };
  }

  const frontmatterText = match[1];
  const body = normalized.slice(match[0].length).replace(/^\n+/, "");
  let pageTitle: string | undefined;
  let youtubeEmbedWidth: number | undefined;
  let inMedia = false;
  let inYoutube = false;

  for (const rawLine of frontmatterText.split("\n")) {
    const indent = rawLine.match(/^\s*/)?.[0].length ?? 0;
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const keyValueMatch = line.match(/^([A-Za-z0-9_]+):(?:\s*(.*))?$/);
    if (!keyValueMatch) continue;

    const key = keyValueMatch[1];
    const value = stripMatchingQuotes((keyValueMatch[2] ?? "").trim());

    if (indent === 0) {
      inMedia = key === "media";
      inYoutube = false;
      if (key === "pageTitle" && value) {
        pageTitle = value;
      }
      continue;
    }

    if (indent === 2 && inMedia) {
      inYoutube = key === "youtube";
      continue;
    }

    if (indent === 4 && inMedia && inYoutube && key === "width") {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        youtubeEmbedWidth = Math.round(parsed);
      }
    }
  }

  return {
    body,
    pageTitle,
    youtubeEmbedWidth
  };
}

function stripMatchingQuotes(input: string): string {
  if (
    (input.startsWith('"') && input.endsWith('"')) ||
    (input.startsWith("'") && input.endsWith("'"))
  ) {
    return input.slice(1, -1).trim();
  }
  return input;
}

function parseTaskAStylesSection(raw: string | undefined): TaskACalloutStyles | undefined {
  if (!raw) return undefined;
  const out: TaskACalloutStyles = {};
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const styleRe = /^\s*(NOTE|INFO|WARNING|SUCCESS|QUESTION)\s*:\s*style\s*=\s*["']([^"']+)["']\s*$/i;
  for (const line of lines) {
    const match = line.match(styleRe);
    if (!match) continue;
    const key = match[1].toLowerCase() as keyof TaskACalloutStyles;
    const styleValue = match[2].trim();
    if (!styleValue) continue;
    out[key] = styleValue;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseTaskAMediaUrlsFromText(raw: string): TaskAMediaAsset[] {
  const out: TaskAMediaAsset[] = [];
  const seen = new Set<string>();
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const labelled = line.match(/^(.*?)\s*-\s*(https?:\/\/\S+)$/i);
    if (labelled) {
      const label = labelled[1].trim() || undefined;
      const url = labelled[2].trim();
      addMediaUrl(out, seen, url, label);
      continue;
    }

    const urls = line.match(/https?:\/\/[^\s)]+/gi);
    if (!urls) continue;
    for (const url of urls) {
      addMediaUrl(out, seen, url.trim(), undefined);
    }
  }

  return out;
}

function addMediaUrl(
  out: TaskAMediaAsset[],
  seen: Set<string>,
  url: string,
  label: string | undefined
): void {
  if (!url) return;
  const key = url.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    url,
    label,
    kind: classifyTaskMediaKindByUrl(url)
  });
}

function buildTaskAMediaLookup(mediaAssets: TaskAMediaAsset[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const asset of mediaAssets) {
    const label = normalizeTaskInlineInput(asset.label);
    if (label) {
      map.set(label.toLowerCase(), asset.url);
      const labelBase = path.basename(label).toLowerCase();
      if (labelBase) map.set(labelBase, asset.url);
      const labelBaseNoExt = removeFileExtension(labelBase);
      if (labelBaseNoExt) map.set(labelBaseNoExt, asset.url);
    }

    const urlPath = getUrlPathname(asset.url);
    if (urlPath) {
      const base = path.basename(urlPath).toLowerCase();
      if (base) map.set(base, asset.url);
      const withoutExt = removeFileExtension(base);
      if (withoutExt) map.set(withoutExt, asset.url);
    }
  }
  return map;
}

function getUrlPathname(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function removeFileExtension(input: string): string {
  return input.replace(/\.[a-z0-9]+$/i, "");
}

function resolveTaskAImageUrl(rawRef: string, mediaLookup: Map<string, string>): string | undefined {
  const reference = rawRef.trim();
  if (!reference) return undefined;
  const candidates = [
    reference.toLowerCase(),
    path.basename(reference).toLowerCase(),
    removeFileExtension(path.basename(reference).toLowerCase())
  ];
  for (const candidate of candidates) {
    const found = mediaLookup.get(candidate);
    if (found) return found;
  }
  return undefined;
}

function toYouTubeEmbedUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.replace(/^\/+/, "").split("/")[0];
      return id ? `https://www.youtube.com/embed/${id}` : undefined;
    }
    if (host.includes("youtube.com")) {
      if (parsed.pathname.startsWith("/watch")) {
        const id = parsed.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : undefined;
      }
      if (parsed.pathname.startsWith("/embed/")) {
        const id = parsed.pathname.split("/").filter(Boolean)[1];
        return id ? `https://www.youtube.com/embed/${id}` : undefined;
      }
      if (parsed.pathname.startsWith("/shorts/")) {
        const id = parsed.pathname.split("/").filter(Boolean)[1];
        return id ? `https://www.youtube.com/embed/${id}` : undefined;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function renderYoutubeIframe(url: string, iframeTemplate?: string): string {
  const embedUrl = toYouTubeEmbedUrl(url) ?? url;
  if (iframeTemplate) {
    if (iframeTemplate.includes("INSERT LINK HERE")) {
      return iframeTemplate.replaceAll("INSERT LINK HERE", embedUrl);
    }

    const withSrcReplaced = iframeTemplate.replace(
      /\bsrc\s*=\s*["'][^"']*["']/i,
      `src="${embedUrl}"`
    );
    if (withSrcReplaced !== iframeTemplate) {
      return withSrcReplaced;
    }
  }
  return `<iframe width="560" height="315" src="${embedUrl}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

function renderResponsiveYoutubeIframe(
  url: string,
  options: { iframeTemplate?: string; width?: number }
): string {
  if (options.iframeTemplate) {
    return renderYoutubeIframe(url, options.iframeTemplate);
  }

  const embedUrl = toYouTubeEmbedUrl(url) ?? url;
  const width = Number.isFinite(options.width) && (options.width ?? 0) > 0 ? Math.round(options.width as number) : 560;
  const height = Math.round(width * 315 / 560);
  return `<iframe width="${width}" height="${height}" src="${embedUrl}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|m4v|mov)(\?.*)?$/i.test(url);
}

function toVimeoEmbedUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().includes("vimeo.com")) return undefined;
    const id = parsed.pathname.split("/").filter(Boolean)[0];
    return id ? `https://player.vimeo.com/video/${id}` : undefined;
  } catch {
    return undefined;
  }
}

function stripCalloutPrefix(content: string, tone: string): string {
  return content.replace(new RegExp(`^\\s*${tone}\\s*:\\s*`, "i"), "").trim();
}

const NON_COLOR_PROCESSOR_TAGS = new Set([
  "IMAGE",
  "YOUTUBE_LINK",
  "NOTE",
  "INFO",
  "WARNING",
  "SUCCESS",
  "QUESTION",
  "AGENT",
  "TABLE",
  "HR",
  "BOLD",
  "ITALIC"
]);

function applyInlineProcessorTags(input: string): string {
  let output = input;
  for (let pass = 0; pass < 5; pass += 1) {
    const prev = output;
    output = output
      .replace(/\[BOLD\]([\s\S]*?)\[\/BOLD\]/gi, "<strong>$1</strong>")
      .replace(/\[ITALIC\]([\s\S]*?)\[\/ITALIC\]/gi, "<em>$1</em>")
      .replace(/\[([A-Z][A-Z0-9_]{1,24})\]([\s\S]*?)\[\/\1\]/g, (full: string, tag: string, body: string) => {
        const upper = tag.toUpperCase();
        if (NON_COLOR_PROCESSOR_TAGS.has(upper)) return full;
        return `<span style="color: ${upper.toLowerCase()};">${body}</span>`;
      });
    if (output === prev) break;
  }
  return output;
}

function buildTaskMarkdownFromNotes(input: {
  notesBody: string;
  mediaLookup: Map<string, string>;
  iframeTemplate?: string;
  youtubeEmbedWidth?: number;
}): string {
  let output = input.notesBody;

  output = output
    .replace(/^\s*\*{3,}\s*(.+?)\s*$/gm, "### $1")
    .replace(/^\s*###(?!#)\s*(.+?)\s*$/gm, "### $1");

  output = output.replace(
    /\[(NOTE|INFO|WARNING|SUCCESS|QUESTION)\]([\s\S]*?)\[\/\1\]/gi,
    (_, tone: string, content: string) => {
      const normalizedTone = tone.toLowerCase();
      const body = stripCalloutPrefix(content, tone) || content.trim();
      return `\n\n<p class="ng-task-callout ng-task-callout--${normalizedTone}">${escapeHtmlText(body)}</p>\n\n`;
    }
  );

  output = output.replace(/\[IMAGE\]([\s\S]*?)\[\/IMAGE\]/gi, (_, imageRef: string) => {
    const resolved = resolveTaskAImageUrl(imageRef, input.mediaLookup);
    const alt = imageRef.trim() || "Task image";
    if (!resolved) {
      return `\n\n<p><em>Missing image asset: ${alt}</em></p>\n\n`;
    }
    return `\n\n<p><img src="${resolved}" alt="${alt}" style="display:block;max-width:100%;height:auto;margin:12px auto;border-radius:8px;" /></p>\n\n`;
  });

  output = output.replace(/\[YOUTUBE_LINK\]([\s\S]*?)\[\/YOUTUBE_LINK\]/gi, (_, rawUrl: string) => {
    const url = rawUrl.trim();
    if (!url) return "";
    return `\n\n<p>${renderResponsiveYoutubeIframe(url, {
      iframeTemplate: input.iframeTemplate,
      width: input.youtubeEmbedWidth
    })}</p>\n\n`;
  });

  output = output.replace(/\[TABLE\]([\s\S]*?)\[\/TABLE\]/gi, (_, table: string) => {
    return `\n\n${renderHtmlTableFromMarkdownLikeBlock(table)}\n\n`;
  });

  output = output.replace(/\[HR\]/gi, "\n\n<hr />\n\n");

  output = output.replace(/\[AGENT\][\s\S]*?\[\/AGENT\]/gi, "");
  output = replaceStandaloneMarkdownMedia(output, input);
  output = replaceMarkdownImageReferences(output, input.mediaLookup);
  output = applyInlineProcessorTags(output);
  output = ensureMarkdownListSpacing(output);
  output = output.replace(/\n{3,}/g, "\n\n").trim();
  return output;
}

function replaceStandaloneMarkdownMedia(
  input: string,
  options: { iframeTemplate?: string; youtubeEmbedWidth?: number }
): string {
  return input
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!/^https?:\/\/\S+$/i.test(trimmed)) return line;

      const youtubeEmbed = toYouTubeEmbedUrl(trimmed);
      if (youtubeEmbed) {
        return renderResponsiveYoutubeIframe(trimmed, {
          iframeTemplate: options.iframeTemplate,
          width: options.youtubeEmbedWidth
        });
      }

      const vimeoEmbed = toVimeoEmbedUrl(trimmed);
      if (vimeoEmbed) {
        return `<iframe width="560" height="315" src="${vimeoEmbed}" title="Video embed" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>`;
      }

      if (isDirectVideoUrl(trimmed)) {
        return `<video controls preload="metadata" src="${trimmed}"></video>`;
      }

      return line;
    })
    .join("\n");
}

function replaceMarkdownImageReferences(input: string, mediaLookup: Map<string, string>): string {
  return input.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, altText: string, rawTarget: string) => {
    const target = rawTarget.trim().replace(/^<|>$/g, "");
    if (!target) return `![${altText}](${target})`;
    if (/^(?:https?:|data:)/i.test(target)) {
      return `![${altText}](${target})`;
    }

    const resolved = resolveTaskAImageUrl(target, mediaLookup);
    if (!resolved) {
      return `\n\n*Missing image asset: ${target}*\n\n`;
    }

    return `![${altText}](${resolved})`;
  });
}

function renderHtmlTableFromMarkdownLikeBlock(raw: string): string {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes("|"));

  if (lines.length < 2) {
    return `<p><em>Invalid [TABLE] block.</em></p>`;
  }

  const rows = lines.map(parseTableRowCells).filter((row) => row.length > 0);
  if (rows.length < 2) {
    return `<p><em>Invalid [TABLE] block.</em></p>`;
  }

  const header = rows[0];
  let bodyRows = rows.slice(1);
  if (isSeparatorRow(rows[1])) {
    bodyRows = rows.slice(2);
  }

  const out: string[] = [];
  out.push('<table class="ng-task-table">');
  out.push("<thead>");
  out.push("<tr>");
  for (const cell of header) {
    out.push(`<th>${cell}</th>`);
  }
  out.push("</tr>");
  out.push("</thead>");
  out.push("<tbody>");
  for (const row of bodyRows) {
    if (isSeparatorRow(row)) continue;
    out.push("<tr>");
    for (const cell of normalizeRowLength(row, header.length)) {
      out.push(`<td>${cell}</td>`);
    }
    out.push("</tr>");
  }
  out.push("</tbody>");
  out.push("</table>");

  return out.join("\n");
}

function parseTableRowCells(line: string): string[] {
  let working = line.trim();
  if (working.startsWith("|")) working = working.slice(1);
  if (working.endsWith("|")) working = working.slice(0, -1);
  return working.split("|").map((cell) => cell.trim());
}

function isSeparatorRow(row: string[]): boolean {
  if (row.length === 0) return false;
  return row.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function normalizeRowLength(row: string[], length: number): string[] {
  if (row.length === length) return row;
  if (row.length > length) return row.slice(0, length);
  return [...row, ...Array.from({ length: length - row.length }, () => "")];
}

function ensureMarkdownListSpacing(input: string): string {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const prev = out.length > 0 ? out[out.length - 1].trim() : "";
    const isBullet = /^[-*]\s+/.test(trimmed);
    const prevIsBullet = /^[-*]\s+/.test(prev);

    if (isBullet && prev && !prevIsBullet && !/^###\s+/.test(prev)) {
      out.push("");
    }
    if (/^###\s+/.test(trimmed) && out.length > 0 && out[out.length - 1].trim()) {
      out.push("");
    }

    out.push(line);
  }
  return out.join("\n");
}

function escapeHtmlText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function mergeTaskACalloutStyles(localStyles: TaskACalloutStyles | undefined): TaskACalloutStyles | undefined {
  const merged: TaskACalloutStyles = {
    ...(localStyles ?? {}),
    ...(env.contentStyles ?? {})
  };
  const hasAny = Object.values(merged).some((value) => typeof value === "string" && value.trim().length > 0);
  return hasAny ? merged : undefined;
}

async function prepareTaskAAssets(input: {
  assetsRoot: string;
  sessionName: string;
  taskFolderName: string;
  notesText?: string;
  notesFilePath?: string;
}): Promise<TaskAAssets> {
  const folderPath = path.resolve(
    input.assetsRoot,
    toFilesystemSegment(input.sessionName),
    toFilesystemSegment(input.taskFolderName)
  );
  await fs.mkdir(folderPath, { recursive: true });

  const notesPath = path.resolve(folderPath, "notes.md");
  const imagesFolderPath = path.resolve(folderPath, "images");
  await fs.mkdir(imagesFolderPath, { recursive: true });

  const createdFiles: string[] = [];
  const notesTemplate = `---
pageTitle: ${NOTE_PLACEHOLDER_TOKEN}
media:
  youtube:
    width: 560
---

Write student-facing content directly in this file using Markdown.

Examples:
![Alt text](images/example.jpg)

:::note
Note text
:::

https://youtu.be/your-video-id
`;
  if (await ensureFileWithTemplate(notesPath, notesTemplate)) createdFiles.push(notesPath);

  let notesText = normalizeNotesText(input.notesText);
  if (!notesText && input.notesFilePath) {
    const loaded = await fs.readFile(path.resolve(input.notesFilePath), "utf8");
    notesText = normalizeNotesText(loaded);
  }
  if (!notesText) {
    notesText = normalizeNotesText(await readTextIfExists(notesPath));
  } else {
    await fs.writeFile(notesPath, `${notesText}\n`, "utf8");
  }

  const parsed = notesText ? parseTaskAAuthoredNotes(notesText) : { mediaUrls: [] };
  const philosophyText = parsed.philosophy ?? TASK_A_DEFAULT_PHILOSOPHY_TEXT;
  const localMedia = await collectTaskALocalMedia(folderPath);

  return {
    folderPath,
    createdFiles,
    pageTitle: parsed.pageTitle,
    notesText,
    authoredBodyText: parsed.authoredBodyText,
    iframeTemplate: parsed.iframeTemplate,
    youtubeEmbedWidth: parsed.youtubeEmbedWidth,
    philosophyText,
    calloutStyles: parsed.styles,
    mediaUrls: parsed.mediaUrls,
    localMedia
  };
}

function findModulePageItemByTitle(
  moduleItems: CanvasModuleItem[],
  pageTitle: string
): CanvasModuleItem | undefined {
  return moduleItems.find(
    (item) =>
      item.type === "Page" &&
      Boolean(item.page_url) &&
      normalizeName(item.title) === normalizeName(pageTitle)
  );
}

function findModuleSubHeaderByTitle(
  moduleItems: CanvasModuleItem[],
  title: string
): CanvasModuleItem | undefined {
  return moduleItems.find(
    (item) => item.type === "SubHeader" && normalizeName(item.title) === normalizeName(title)
  );
}

function findModuleQuizItemByTitle(
  moduleItems: CanvasModuleItem[],
  quizTitle: string
): CanvasModuleItem | undefined {
  return moduleItems.find(
    (item) => item.type === "Quiz" && normalizeName(item.title) === normalizeName(quizTitle)
  );
}

function findModuleQuizItem(
  moduleItems: CanvasModuleItem[],
  quizTitle: string,
  quizId?: number
): CanvasModuleItem | undefined {
  if (quizId !== undefined) {
    const byContentId = moduleItems.find((item) => item.type === "Quiz" && item.content_id === quizId);
    if (byContentId) return byContentId;
  }
  return findModuleQuizItemByTitle(moduleItems, quizTitle);
}

async function findExactModuleByNameIfExists(
  client: CanvasClient,
  courseId: number,
  moduleName: string
): Promise<CanvasModuleSummary | undefined> {
  const modules = await client.listModules(courseId, moduleName);
  const matches = modules.filter((module) => normalizeName(module.name) === normalizeName(moduleName));
  if (matches.length > 1) {
    const names = matches.map((module) => module.name).join(", ");
    throw new Error(`Multiple modules matched "${moduleName}": ${names}`);
  }
  return matches[0];
}

async function upsertCoursePageByTitle(input: {
  client: CanvasClient;
  courseId: number;
  pageTitle: string;
  bodyHtml: string;
  published: boolean;
  existingPageUrl?: string;
  beforeUpdate?: (pageUrl: string) => Promise<void>;
}): Promise<UpsertCoursePageResult> {
  const {
    client,
    courseId,
    pageTitle,
    bodyHtml,
    published,
    existingPageUrl,
    beforeUpdate
  } = input;

  if (existingPageUrl) {
    if (beforeUpdate) {
      await beforeUpdate(existingPageUrl);
    }
    await client.updatePage(courseId, existingPageUrl, {
      title: pageTitle,
      body: bodyHtml,
      published
    });
    return {
      pageUrl: existingPageUrl,
      createdPage: false
    };
  }

  const pages = await client.listPages(courseId, pageTitle);
  const existingPage = pages.find((page) => normalizeName(page.title) === normalizeName(pageTitle));
  if (existingPage) {
    if (beforeUpdate) {
      await beforeUpdate(existingPage.url);
    }
    await client.updatePage(courseId, existingPage.url, {
      title: pageTitle,
      body: bodyHtml,
      published
    });
    return {
      pageUrl: existingPage.url,
      createdPage: false
    };
  }

  const created = await client.createPage(courseId, {
    title: pageTitle,
    body: bodyHtml,
    published
  });
  return {
    pageUrl: created.url,
    createdPage: true
  };
}

async function ensureModulePagePlacement(input: {
  client: CanvasClient;
  courseId: number;
  moduleId: number;
  moduleItems: CanvasModuleItem[];
  pageTitle: string;
  pageUrl: string;
  insertionPosition: number;
}): Promise<EnsureModulePagePlacementResult> {
  const moduleItemForPage = input.moduleItems.find(
    (item) => item.type === "Page" && item.page_url === input.pageUrl
  );
  if (!moduleItemForPage) {
    await input.client.createModulePageItem(input.courseId, input.moduleId, {
      title: input.pageTitle,
      pageUrl: input.pageUrl,
      position: input.insertionPosition
    });
    return {
      createdModuleItem: true,
      movedModuleItem: false
    };
  }

  if (moduleItemForPage.position !== input.insertionPosition) {
    await input.client.updateModuleItemPosition(
      input.courseId,
      input.moduleId,
      moduleItemForPage.id,
      input.insertionPosition
    );
    return {
      createdModuleItem: false,
      movedModuleItem: true
    };
  }

  return {
    createdModuleItem: false,
    movedModuleItem: false
  };
}

async function ensureModuleQuizPlacement(input: {
  client: CanvasClient;
  courseId: number;
  moduleId: number;
  moduleItems: CanvasModuleItem[];
  quizTitle: string;
  quizId: number;
  insertionPosition: number;
}): Promise<EnsureModulePagePlacementResult> {
  const moduleItemForQuiz = findModuleQuizItem(input.moduleItems, input.quizTitle, input.quizId);
  if (!moduleItemForQuiz) {
    await input.client.createModuleQuizItem(input.courseId, input.moduleId, {
      title: input.quizTitle,
      quizId: input.quizId,
      position: input.insertionPosition
    });
    return {
      createdModuleItem: true,
      movedModuleItem: false
    };
  }

  if (moduleItemForQuiz.position !== input.insertionPosition) {
    await input.client.updateModuleItemPosition(
      input.courseId,
      input.moduleId,
      moduleItemForQuiz.id,
      input.insertionPosition
    );
    return {
      createdModuleItem: false,
      movedModuleItem: true
    };
  }

  return {
    createdModuleItem: false,
    movedModuleItem: false
  };
}

async function upsertModulePage(input: {
  client: CanvasClient;
  courseId: number;
  moduleId: number;
  moduleItems: CanvasModuleItem[];
  pageTitle: string;
  bodyHtml: string;
  published: boolean;
  insertionPosition: number;
}): Promise<UpsertCoursePageResult & EnsureModulePagePlacementResult> {
  const existingModulePage = findModulePageItemByTitle(input.moduleItems, input.pageTitle);
  const pageResult = await upsertCoursePageByTitle({
    client: input.client,
    courseId: input.courseId,
    pageTitle: input.pageTitle,
    bodyHtml: input.bodyHtml,
    published: input.published,
    existingPageUrl: existingModulePage?.page_url ? String(existingModulePage.page_url) : undefined
  });
  const placementResult = await ensureModulePagePlacement({
    client: input.client,
    courseId: input.courseId,
    moduleId: input.moduleId,
    moduleItems: input.moduleItems,
    pageTitle: input.pageTitle,
    pageUrl: pageResult.pageUrl,
    insertionPosition: input.insertionPosition
  });
  return {
    ...pageResult,
    ...placementResult
  };
}

async function runSessionHeadersWorkflow(input: {
  courseId: number;
  moduleName: string;
  sessionNumber: number;
  dryRun: boolean;
  client?: CanvasClient;
}): Promise<void> {
  const client = input.client ?? new CanvasClient();
  const config = await loadConfig();
  const headers = buildSessionHeaderTitles(input.sessionNumber, config.sessions);
  const module = await resolveModuleByName(client, input.courseId, input.moduleName);
  const moduleItems = await client.listModuleItems(input.courseId, module.id);
  const existingHeaderKeys = new Set(
    moduleItems
      .filter((item) => item.type === "SubHeader")
      .map((item) => normalizeName(item.title))
  );

  const existingHeaders = headers.filter((title) => existingHeaderKeys.has(normalizeName(title)));
  const missingHeaders = headers.filter((title) => !existingHeaderKeys.has(normalizeName(title)));

  console.log(`Module: ${module.name} (${module.id})`);
  console.log(`Session: ${String(input.sessionNumber).padStart(2, "0")}`);
  console.log("Headers:");
  for (const title of headers) {
    const status = existingHeaderKeys.has(normalizeName(title)) ? " [exists]" : "";
    console.log(`- ${title}${status}`);
  }

  if (input.dryRun) {
    console.log("Dry run: no module items created.");
    return;
  }

  for (const title of missingHeaders) {
    await client.createModuleSubHeader(input.courseId, module.id, title);
  }

  console.log(
    missingHeaders.length > 0
      ? `Session headers created: ${missingHeaders.length}.`
      : "Session headers already present."
  );
  if (existingHeaders.length > 0) {
    console.log(`Existing headers left unchanged: ${existingHeaders.length}.`);
  }
}

async function runTaskSectionWorkflow(input: {
  courseId: number;
  sessionName: string;
  taskLetter: "A" | "B" | "C";
  taskFolder?: string;
  pageTitle?: string;
  notesText?: string;
  notesFilePath?: string;
  publish: boolean;
  assetsRoot: string;
  dryRun: boolean;
  client?: CanvasClient;
}): Promise<void> {
  const client = input.client ?? new CanvasClient();
  const sessionMeta = parseSessionMetadata(input.sessionName);
  const taskConfig = {
    A: {
      defaultFolderName: TASK_A_DEFAULT_FOLDER_NAME,
      filesFolderKey: "task_a" as const,
      buildSection: buildTaskASection,
      sectionLabel: "Task A"
    },
    B: {
      defaultFolderName: TASK_B_DEFAULT_FOLDER_NAME,
      filesFolderKey: "task_b" as const,
      buildSection: buildTaskBSection,
      sectionLabel: "Task B"
    },
    C: {
      defaultFolderName: TASK_C_DEFAULT_FOLDER_NAME,
      filesFolderKey: "task_c" as const,
      buildSection: buildTaskCSection,
      sectionLabel: "Task C"
    }
  }[input.taskLetter];

  const taskFolderName = await resolveTaskFolderName(
    input.assetsRoot,
    input.sessionName,
    input.taskLetter,
    taskConfig.defaultFolderName,
    input.taskFolder
  );

  const assets = await prepareTaskAAssets({
    assetsRoot: input.assetsRoot,
    sessionName: input.sessionName,
    taskFolderName,
    notesText: input.notesText,
    notesFilePath: input.notesFilePath
  });

  const pageTitle =
    input.pageTitle ??
    assets.pageTitle ??
    `${sessionMeta.topic} - ${taskConfig.sectionLabel}`;
  const taskTitle = pageTitle;

  const mediaAssets: TaskAMediaAsset[] = [...assets.mediaUrls];
  const uploadedLocalMedia: Array<{ source: string; uploadedUrl: string; id: number }> = [];
  let uploadedLocalMediaFolderPath: string | undefined;

  if (!input.dryRun && assets.localMedia.length > 0) {
    if (!sessionMeta.sessionNumberPadded) {
      throw new Error(
        `Cannot map session name "${input.sessionName}" to a Session_NN/${taskConfig.filesFolderKey} files folder for media upload.`
      );
    }
    const sessionFolderPath = buildCanvasSectionFilesFolderPath(sessionMeta, taskConfig.filesFolderKey);
    uploadedLocalMediaFolderPath = sessionFolderPath;
    for (const local of assets.localMedia) {
      const fileData = Buffer.from(await fs.readFile(local.absolutePath));
      const uploaded = await uploadFileToCanvasSessionFolder({
        courseId: input.courseId,
        sessionFolderPath,
        fileName: local.fileName,
        contentType: local.contentType,
        data: fileData
      });
      mediaAssets.push({
        url: uploaded.url,
        kind: local.kind,
        label: local.relativePath
      });
      uploadedLocalMedia.push({
        source: local.relativePath,
        uploadedUrl: uploaded.url,
        id: uploaded.id
      });
    }
  } else {
    for (const local of assets.localMedia) {
      mediaAssets.push({
        url: local.relativePath,
        kind: local.kind,
        label: local.relativePath
      });
    }
  }

  const notesBody = normalizeTaskBlockText(assets.authoredBodyText ?? assets.notesText);
  if (!notesBody) {
    throw new Error(
      `${taskConfig.sectionLabel} notes.md is empty. Add student-facing content and processor tags, then retry.`
    );
  }

  const mediaLookup = buildTaskAMediaLookup(mediaAssets);
  const finalTaskBodyMarkdown = buildTaskMarkdownFromNotes({
    notesBody,
    mediaLookup,
    iframeTemplate: assets.iframeTemplate,
    youtubeEmbedWidth: assets.youtubeEmbedWidth
  });
  const finalCalloutStyles = mergeTaskACalloutStyles(assets.calloutStyles);

  const built = await taskConfig.buildSection(client, input.courseId, input.sessionName, {
    pageTitle,
    taskTitle,
    bodyMarkdown: finalTaskBodyMarkdown,
    suppressTaskTitleHeading: true,
    disableAutoMediaSection: true,
    calloutStyles: finalCalloutStyles,
    mediaAssets
  });

  console.log(`Course: ${input.courseId}`);
  console.log(`Session module: ${built.module.name} (${built.module.id})`);
  console.log(`${taskConfig.sectionLabel} header: ${built.taskHeaderTitle}`);
  console.log(`Task folder: ${taskFolderName}`);
  console.log(`Assets folder: ${assets.folderPath}`);
  console.log(`Page title: ${pageTitle}`);
  console.log(`Publish mode: ${input.publish ? "published" : "unpublished (default)"}`);
  if (assets.createdFiles.length > 0) {
    console.log("Created local asset templates:");
    for (const createdPath of assets.createdFiles) {
      console.log(`- ${createdPath}`);
    }
  }
  console.log("Task body source: notes.md markdown/legacy compatible mode");
  console.log(`Callout style presets: ${finalCalloutStyles ? Object.keys(finalCalloutStyles).length : 0}`);
  console.log(`IFrame template source: ${assets.iframeTemplate ? "[AGENT] notes block" : "default template"}`);
  console.log(`Media URLs: ${assets.mediaUrls.length}`);
  console.log(`Local media files: ${assets.localMedia.length}`);
  console.log(`Media references resolved: ${mediaLookup.size}`);
  console.log(`Target module position: ${built.insertionPosition}`);

  if (input.dryRun) {
    if (assets.localMedia.length > 0) {
      console.log("Dry run: local media files are not uploaded.");
    }
    console.log("Dry run: no Canvas updates performed.");
    console.log("Generated HTML preview:");
    console.log(built.sectionHtml.split("\n").slice(0, 60).join("\n"));
    return;
  }

  if (uploadedLocalMedia.length > 0) {
    const sessionFolderPath =
      uploadedLocalMediaFolderPath ?? `Session_[unknown]/${taskConfig.filesFolderKey}`;
    console.log(`Uploaded ${uploadedLocalMedia.length} local media file(s) to Canvas files (${sessionFolderPath}):`);
    for (const uploaded of uploadedLocalMedia) {
      console.log(`- ${uploaded.source} -> ${uploaded.uploadedUrl} (${uploaded.id})`);
    }
  }

  const pageResult = await upsertModulePage({
    client,
    courseId: input.courseId,
    moduleId: built.module.id,
    moduleItems: built.moduleItems,
    pageTitle,
    bodyHtml: built.sectionHtml,
    published: input.publish,
    insertionPosition: built.insertionPosition
  });

  console.log(pageResult.createdPage ? "Created page." : "Updated existing page.");
  if (pageResult.createdModuleItem) console.log("Added page to session module.");
  if (pageResult.movedModuleItem) console.log("Moved module item to target section.");
  if (!pageResult.createdModuleItem && !pageResult.movedModuleItem) {
    console.log("Module item placement already correct.");
  }
  console.log(`Page URL: ${env.canvasBaseUrl}/courses/${input.courseId}/pages/${pageResult.pageUrl}`);
}

async function runTodaySectionWorkflow(input: {
  courseId: number;
  sessionName: string;
  pageTitle?: string;
  notesText?: string;
  notesFilePath?: string;
  imageUrl?: string;
  imageId?: number;
  imageFilePath?: string;
  aiImagePrompt?: string;
  publish: boolean;
  assetsRoot: string;
  dryRun: boolean;
  client?: CanvasClient;
}): Promise<void> {
  if (input.notesText && input.notesFilePath) {
    throw new Error("Use either notes text or notes file, not both.");
  }
  if (input.imageUrl && input.imageId !== undefined) {
    throw new Error("Use either image URL or image id, not both.");
  }
  if (input.imageUrl && input.imageFilePath) {
    throw new Error("Use either image URL or image file, not both.");
  }
  if (input.imageFilePath && input.imageId !== undefined) {
    throw new Error("Use either image file or image id, not both.");
  }

  const client = input.client ?? new CanvasClient();
  const sessionMeta = parseSessionMetadata(input.sessionName);
  const pageTitle = input.pageTitle ?? buildIntroductionPageTitle(input.sessionName);

  const assets = await prepareTodaySectionAssets({
    assetsRoot: input.assetsRoot,
    sessionName: input.sessionName,
    sectionTitle: TODAY_SECTION_ASSET_TITLE,
    notesText: input.notesText,
    notesFilePath: input.notesFilePath,
    imageUrl: input.imageUrl,
    imageId: input.imageId,
    imageFilePath: input.imageFilePath,
    aiImagePrompt: input.aiImagePrompt,
    client
  });

  const seedBuilt = await buildWhatAreWeDoingTodaySection(client, input.courseId, input.sessionName, {
    sectionTitle: pageTitle,
    notesText: undefined,
    imageUrl: assets.imageUrl,
    aiImagePrompt: assets.aiImagePrompt
  });

  const modulePageTitles = seedBuilt.moduleItems
    .filter((item) => item.type === "Page")
    .map((item) => item.title);
  const taskLabels = extractTaskLabels(seedBuilt.moduleItems);
  const fallbackSummaryParagraphs = extractParagraphsFromHtml(seedBuilt.sectionHtml, 2);

  const generatedIntro = await generateTodayIntroFromAgent({
    sessionName: input.sessionName,
    sessionTopic: sessionMeta.topic,
    notesText: assets.notesText,
    taskLabels,
    modulePageTitles,
    fallbackSummaryParagraphs,
    paragraphCount: 2
  });
  const agentNotesText = generatedIntro.paragraphs.join("\n\n");
  const finalAiImagePrompt = assets.aiImagePrompt ?? generatedIntro.imagePrompt;

  let built = await buildWhatAreWeDoingTodaySection(client, input.courseId, input.sessionName, {
    sectionTitle: pageTitle,
    notesText: agentNotesText,
    imageUrl: assets.imageUrl,
    aiImagePrompt: finalAiImagePrompt
  });

  console.log(`Course: ${input.courseId}`);
  console.log(`Session module: ${built.module.name} (${built.module.id})`);
  console.log(`Page title: ${pageTitle}`);
  console.log(`Publish mode: ${input.publish ? "published" : "unpublished (default)"}`);
  console.log(`Section folder key: ${TODAY_SECTION_ASSET_TITLE}`);
  console.log(`Assets folder: ${assets.folderPath}`);
  if (assets.createdFiles.length > 0) {
    console.log("Created local asset templates:");
    for (const createdPath of assets.createdFiles) {
      console.log(`- ${createdPath}`);
    }
  }
  console.log(`Source pages scanned: ${built.sourcePageCount}`);
  console.log(`Intro pages used: ${built.introPageCount}`);
  console.log("Summary source: agent-generated from notes + module context");
  if (assets.imageSource === "local-file") {
    const before = assets.localImageOriginalBytes ? formatByteSize(assets.localImageOriginalBytes) : undefined;
    const after = assets.localImageOutputBytes ? formatByteSize(assets.localImageOutputBytes) : undefined;
    const optimizedTag = assets.localImageOptimized ? " [optimized]" : "";
    console.log(
      `Image mode: local file override (${assets.localImagePath})${optimizedTag}` +
      `${before && after ? ` (${before} -> ${after})` : ""}` +
      `${assets.localImageOutputMimeType ? ` [${assets.localImageOutputMimeType}]` : ""}`
    );
  } else if (assets.imageSource === "canvas-file-id") {
    console.log(
      `Image mode: Canvas file id ${assets.canvasImageId}` +
      `${assets.canvasImageDisplayName ? ` (${assets.canvasImageDisplayName})` : ""}`
    );
  } else if (assets.imageSource === "cli-url") {
    console.log("Image mode: --image-url input");
  } else if (assets.imageSource === "file-url") {
    console.log("Image mode: image-url.txt");
  } else if (built.imageUrl) {
    console.log("Image mode: auto-detected from existing module intro content");
  } else {
    console.log("Image mode: placeholder");
  }
  if (finalAiImagePrompt) {
    console.log(`AI image brief: ${finalAiImagePrompt}`);
  }
  console.log(`Target module position: ${built.insertionPosition}`);

  if (input.dryRun) {
    console.log("Dry run: no Canvas updates performed.");
    console.log("Generated HTML preview:");
    console.log(sanitizeTodaySectionPreviewHtml(built.sectionHtml).split("\n").slice(0, 40).join("\n"));
    return;
  }

  if (assets.imageSource === "local-file" && assets.localImageOutputBuffer && assets.localImageOutputMimeType) {
    if (!sessionMeta.sessionNumberPadded) {
      throw new Error(
        `Cannot map session name "${input.sessionName}" to a Session_NN/what_are_we_doing_today files folder for image upload.`
      );
    }
    const sessionFolderPath = buildCanvasSectionFilesFolderPath(sessionMeta, "what_are_we_doing_today");
    const uploadName =
      assets.localImageOutputFileName ??
      `intro-${sessionMeta.sessionNumberPadded}${extensionForMimeType(assets.localImageOutputMimeType)}`;
    const uploaded = await uploadImageToCanvasSessionFolder({
      courseId: input.courseId,
      sessionFolderPath,
      fileName: uploadName,
      contentType: assets.localImageOutputMimeType,
      data: assets.localImageOutputBuffer
    });
    console.log(
      `Uploaded image to Canvas files (${sessionFolderPath}): ${uploaded.display_name ?? uploadName} (${uploaded.id})`
    );
    built = await buildWhatAreWeDoingTodaySection(client, input.courseId, input.sessionName, {
      sectionTitle: pageTitle,
      notesText: agentNotesText,
      imageUrl: uploaded.url,
      aiImagePrompt: finalAiImagePrompt
    });
  }

  const pageResult = await upsertModulePage({
    client,
    courseId: input.courseId,
    moduleId: built.module.id,
    moduleItems: built.moduleItems,
    pageTitle,
    bodyHtml: built.sectionHtml,
    published: input.publish,
    insertionPosition: built.insertionPosition
  });

  console.log(pageResult.createdPage ? "Created page." : "Updated existing page.");
  if (pageResult.createdModuleItem) console.log("Added page to session module.");
  if (pageResult.movedModuleItem) console.log("Moved module item to target section.");
  if (!pageResult.createdModuleItem && !pageResult.movedModuleItem) {
    console.log("Module item placement already correct.");
  }
  console.log(`Page URL: ${env.canvasBaseUrl}/courses/${input.courseId}/pages/${pageResult.pageUrl}`);
}

async function runModuleSubHeaderWorkflow(input: {
  courseId: number;
  moduleName: string;
  title: string;
  dryRun: boolean;
  client?: CanvasClient;
}): Promise<void> {
  const client = input.client ?? new CanvasClient();
  const module = await resolveModuleByName(client, input.courseId, input.moduleName);
  const moduleItems = await client.listModuleItems(input.courseId, module.id);
  const existing = findModuleSubHeaderByTitle(moduleItems, input.title);

  console.log(`Module: ${module.name} (${module.id})`);
  console.log(`Subheader: ${input.title}`);

  if (input.dryRun) {
    console.log(existing ? "Dry run: subheader already present." : "Dry run: subheader would be created.");
    return;
  }

  if (existing) {
    console.log("Subheader already present.");
    return;
  }

  await client.createModuleSubHeader(input.courseId, module.id, input.title);
  console.log("Subheader created.");
}

function resolveModulePageInsertionPosition(
  moduleItems: CanvasModuleItem[],
  afterHeaderTitle?: string
): number {
  const sortedItems = [...moduleItems].sort((a, b) => a.position - b.position);
  if (!afterHeaderTitle) {
    const lastPosition = sortedItems.at(-1)?.position ?? 0;
    return lastPosition + 1;
  }

  const header = findModuleSubHeaderByTitle(sortedItems, afterHeaderTitle);
  if (!header) {
    throw new Error(`Subheader "${afterHeaderTitle}" was not found in the module.`);
  }
  return header.position + 1;
}

async function renderOrchestratorPageHtml(input: {
  courseId: number;
  blocks: OrchestratorPageContentBlock[];
  baseDir: string;
  dryRun: boolean;
}): Promise<{ html: string; uploadedImages: Array<{ source: string; uploadedUrl: string; id: number }> }> {
  const lines: string[] = [];
  const uploadedImages: Array<{ source: string; uploadedUrl: string; id: number }> = [];

  for (const block of input.blocks) {
    if (block.type === "markdown") {
      lines.push(String(await marked.parse(block.value)));
      continue;
    }
    if (block.type === "markdownFile") {
      const markdownPath = path.resolve(input.baseDir, block.path);
      const markdownText = await fs.readFile(markdownPath, "utf8");
      lines.push(String(await marked.parse(markdownText)));
      continue;
    }
    if (block.type === "html") {
      lines.push(block.value);
      continue;
    }
    if (block.type === "htmlFile") {
      const htmlPath = path.resolve(input.baseDir, block.path);
      lines.push(await fs.readFile(htmlPath, "utf8"));
      continue;
    }

    const imagePath = path.resolve(input.baseDir, block.path);
    const converted = await imageFileToDataUrl(imagePath);
    let imageUrl = converted.dataUrl;
    if (!input.dryRun) {
      const baseName = path.basename(imagePath, path.extname(imagePath));
      const fileName = `${toFilesystemSegment(baseName)}${extensionForMimeType(converted.outputMimeType) || path.extname(imagePath)}`;
      const uploaded = await uploadImageToCanvasSessionFolder({
        courseId: input.courseId,
        sessionFolderPath: block.filesFolder,
        fileName,
        contentType: converted.outputMimeType,
        data: converted.outputBuffer
      });
      imageUrl = uploaded.url;
      uploadedImages.push({
        source: block.path,
        uploadedUrl: uploaded.url,
        id: uploaded.id
      });
    }
    const alt = block.alt?.trim() || path.basename(block.path);
    lines.push(
      `<p><img src="${escapeHtmlText(imageUrl)}" alt="${escapeHtmlText(alt)}" style="display:block;max-width:100%;height:auto;margin:12px auto;border-radius:8px;" /></p>`
    );
  }

  return {
    html: lines.join("\n").trim(),
    uploadedImages
  };
}

async function runModulePageWorkflow(input: {
  courseId: number;
  moduleName: string;
  title: string;
  publish: boolean;
  afterHeaderTitle?: string;
  content: OrchestratorPageContentBlock[];
  baseDir: string;
  dryRun: boolean;
  client?: CanvasClient;
}): Promise<void> {
  const client = input.client ?? new CanvasClient();
  const module = await resolveModuleByName(client, input.courseId, input.moduleName);
  const moduleItems = await client.listModuleItems(input.courseId, module.id);
  const insertionPosition = resolveModulePageInsertionPosition(moduleItems, input.afterHeaderTitle);
  const rendered = await renderOrchestratorPageHtml({
    courseId: input.courseId,
    blocks: input.content,
    baseDir: input.baseDir,
    dryRun: input.dryRun
  });

  console.log(`Module: ${module.name} (${module.id})`);
  console.log(`Page title: ${input.title}`);
  if (input.afterHeaderTitle) {
    console.log(`Insert after subheader: ${input.afterHeaderTitle}`);
  }
  console.log(`Target module position: ${insertionPosition}`);

  if (input.dryRun) {
    console.log("Dry run: no Canvas updates performed.");
    console.log("Generated HTML preview:");
    console.log(rendered.html.split("\n").slice(0, 40).join("\n"));
    return;
  }

  if (rendered.uploadedImages.length > 0) {
    console.log(`Uploaded ${rendered.uploadedImages.length} image file(s):`);
    for (const uploaded of rendered.uploadedImages) {
      console.log(`- ${uploaded.source} -> ${uploaded.uploadedUrl} (${uploaded.id})`);
    }
  }

  const pageResult = await upsertModulePage({
    client,
    courseId: input.courseId,
    moduleId: module.id,
    moduleItems,
    pageTitle: input.title,
    bodyHtml: rendered.html,
    published: input.publish,
    insertionPosition
  });

  console.log(pageResult.createdPage ? "Created page." : "Updated existing page.");
  if (pageResult.createdModuleItem) console.log("Added page to session module.");
  if (pageResult.movedModuleItem) console.log("Moved module item to target section.");
  if (!pageResult.createdModuleItem && !pageResult.movedModuleItem) {
    console.log("Module item placement already correct.");
  }
  console.log(`Page URL: ${env.canvasBaseUrl}/courses/${input.courseId}/pages/${pageResult.pageUrl}`);
}

async function runCloneSurveyBatchWorkflow(input: {
  sourceCourseId: number;
  targetCourseId: number;
  sourceTitle: string;
  titleTemplate: string;
  sessionNumbers: number[];
  pad: number;
  skipExisting: boolean;
  dryRun: boolean;
  client?: CanvasClient;
}): Promise<void> {
  const client = input.client ?? new CanvasClient();
  const source = await resolveExactQuizCloneSource({
    client,
    sourceCourseId: input.sourceCourseId,
    sourceTitle: input.sourceTitle
  });
  const planned = input.sessionNumbers.map((sessionNumber) => ({
    sessionNumber,
    title: renderTitle(input.titleTemplate, sessionNumber, input.pad)
  }));

  const duplicatePlannedTitle = planned.find((item, index) =>
    planned.findIndex((other) => normalizeName(other.title) === normalizeName(item.title)) !== index
  );
  if (duplicatePlannedTitle) {
    throw new Error(`Generated duplicate title "${duplicatePlannedTitle.title}". Adjust the title template.`);
  }

  const existingTargets = new Map<string, Awaited<ReturnType<CanvasClient["listQuizzes"]>>[number]>();
  for (const item of planned) {
    const existing = await findExactQuizByTitleIfExists(client, input.targetCourseId, item.title);
    if (existing) {
      existingTargets.set(normalizeName(item.title), existing);
    }
  }

  if (existingTargets.size > 0 && !input.skipExisting) {
    const names = planned
      .filter((item) => existingTargets.has(normalizeName(item.title)))
      .map((item) => item.title)
      .join(", ");
    throw new Error(`Generated titles already exist: ${names}. Use --skip-existing to continue.`);
  }

  console.log(`Target course: ${input.targetCourseId}`);
  console.log(`Source course: ${input.sourceCourseId}`);
  console.log(`Source quiz: ${source.summary.title} (${source.summary.id})`);
  console.log(`Source type: ${source.quiz.quiz_type ?? "assignment"}`);
  console.log(`Questions to copy: ${source.questions.length}`);
  console.log(`Title template: ${input.titleTemplate}`);
  if (input.sourceCourseId !== input.targetCourseId) {
    console.log("Cross-course clone: assignment group and availability dates will not be copied.");
  }
  console.log("Planned copies:");
  for (const item of planned) {
    const existing = existingTargets.get(normalizeName(item.title));
    console.log(
      `- Session ${String(item.sessionNumber).padStart(input.pad, "0")}: ${item.title}${existing ? ` [exists: ${existing.id}]` : ""}`
    );
  }

  if (input.dryRun) {
    console.log("Dry run: no quizzes created.");
    return;
  }

  const skipped: string[] = [];
  const created: Array<{ id: number; title: string }> = [];
  for (const item of planned) {
    const existing = existingTargets.get(normalizeName(item.title));
    if (existing) {
      skipped.push(item.title);
      continue;
    }

    const newQuiz = await cloneQuizToCourse({
      client,
      sourceCourseId: input.sourceCourseId,
      targetCourseId: input.targetCourseId,
      sourceQuiz: source.quiz,
      sourceQuestions: source.questions,
      title: item.title
    });
    created.push(newQuiz);
    existingTargets.set(normalizeName(item.title), newQuiz);
    console.log(`Created: ${item.title} (${newQuiz.id})`);
  }

  console.log(`Created ${created.length} quiz copy/copies.`);
  if (skipped.length > 0) {
    console.log(`Skipped ${skipped.length} existing title(s): ${skipped.join(", ")}`);
  }
}

async function runModuleCloneSurveyWorkflow(input: {
  courseId: number;
  moduleName: string;
  sourceCourseId: number;
  sourceTitle: string;
  title: string;
  afterHeaderTitle?: string;
  skipExisting: boolean;
  dryRun: boolean;
  client?: CanvasClient;
}): Promise<void> {
  const client = input.client ?? new CanvasClient();
  const source = await resolveExactQuizCloneSource({
    client,
    sourceCourseId: input.sourceCourseId,
    sourceTitle: input.sourceTitle
  });
  const existingQuiz = await findExactQuizByTitleIfExists(client, input.courseId, input.title);
  const module = await resolveModuleByName(client, input.courseId, input.moduleName);
  const moduleItems = await client.listModuleItems(input.courseId, module.id);
  const insertionPosition = resolveModulePageInsertionPosition(moduleItems, input.afterHeaderTitle);
  const existingModuleItem = findModuleQuizItem(moduleItems, input.title, existingQuiz?.id);

  console.log(`Module: ${module.name} (${module.id})`);
  console.log(`Source course: ${input.sourceCourseId}`);
  console.log(`Source survey: ${source.summary.title} (${source.summary.id})`);
  console.log(`Source type: ${source.quiz.quiz_type ?? "assignment"}`);
  console.log(`Questions to copy: ${source.questions.length}`);
  console.log(`Target survey title: ${input.title}`);
  if (input.afterHeaderTitle) {
    console.log(`Insert after subheader: ${input.afterHeaderTitle}`);
  }
  console.log(`Target module position: ${insertionPosition}`);
  if (input.sourceCourseId !== input.courseId) {
    console.log("Cross-course clone: assignment group and availability dates will not be copied.");
  }

  if (input.dryRun) {
    if (existingQuiz) {
      console.log(`Dry run: existing survey will be reused (${existingQuiz.id}).`);
    } else {
      console.log("Dry run: survey would be cloned into the target course.");
    }

    if (!existingModuleItem) {
      console.log("Dry run: survey would be added to the module.");
    } else if (existingModuleItem.position !== insertionPosition) {
      console.log("Dry run: survey module item would be moved to the target section.");
    } else {
      console.log("Dry run: survey module item placement already correct.");
    }
    return;
  }

  if (existingQuiz && !input.skipExisting) {
    throw new Error(`Survey "${input.title}" already exists in course ${input.courseId}. Use skipExisting to reuse it.`);
  }

  const targetQuiz =
    existingQuiz ??
    await cloneQuizToCourse({
      client,
      sourceCourseId: input.sourceCourseId,
      targetCourseId: input.courseId,
      sourceQuiz: source.quiz,
      sourceQuestions: source.questions,
      title: input.title
    });

  if (existingQuiz) {
    console.log(`Using existing survey: ${targetQuiz.title} (${targetQuiz.id})`);
  } else {
    console.log(`Created survey: ${targetQuiz.title} (${targetQuiz.id})`);
  }

  const placementResult = await ensureModuleQuizPlacement({
    client,
    courseId: input.courseId,
    moduleId: module.id,
    moduleItems,
    quizTitle: input.title,
    quizId: targetQuiz.id,
    insertionPosition
  });

  if (placementResult.createdModuleItem) console.log("Added survey to session module.");
  if (placementResult.movedModuleItem) console.log("Moved survey module item to target section.");
  if (!placementResult.createdModuleItem && !placementResult.movedModuleItem) {
    console.log("Survey module item placement already correct.");
  }
  console.log(`Quiz URL: ${env.canvasBaseUrl}/courses/${input.courseId}/quizzes/${targetQuiz.id}`);
}

async function loadSurveyFromFile(filePath: string): Promise<ReturnType<typeof validateNexgenSurvey>> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  return validateNexgenSurvey(raw);
}

function summarizeSurveyQuestionTypes(
  questions: ReturnType<typeof validateNexgenSurvey>["questions"]
): string {
  const counts = new Map<string, number>();
  for (const question of questions) {
    counts.set(question.type, (counts.get(question.type) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([type, count]) => `${type}:${count}`)
    .join(", ");
}

async function runCreateSurveyWorkflow(input: {
  courseId: number;
  surveyFilePath: string;
  title?: string;
  publish: boolean;
  skipExisting: boolean;
  moduleName?: string;
  afterHeaderTitle?: string;
  dryRun: boolean;
  client?: CanvasClient;
}): Promise<void> {
  const client = input.client ?? new CanvasClient();
  const survey = await loadSurveyFromFile(input.surveyFilePath);
  const effectiveTitle = input.title ?? survey.title;
  const mapped = mapToCanvasSurvey(survey, {
    title: effectiveTitle,
    published: input.publish
  });
  const existingQuiz = await findExactQuizByTitleIfExists(client, input.courseId, effectiveTitle);

  let module: CanvasModuleSummary | undefined;
  let moduleItems: CanvasModuleItem[] = [];
  let insertionPosition: number | undefined;
  let existingModuleItem: CanvasModuleItem | undefined;
  if (input.moduleName) {
    module = await resolveModuleByName(client, input.courseId, input.moduleName);
    moduleItems = await client.listModuleItems(input.courseId, module.id);
    insertionPosition = resolveModulePageInsertionPosition(moduleItems, input.afterHeaderTitle);
    existingModuleItem = findModuleQuizItem(moduleItems, effectiveTitle, existingQuiz?.id);
  }

  console.log(`Course: ${input.courseId}`);
  console.log(`Survey file: ${input.surveyFilePath}`);
  console.log(`Survey title: ${effectiveTitle}`);
  console.log(`Survey type: ${mapped.canvasQuiz.quiz_type}`);
  console.log(`Questions: ${survey.questions.length}`);
  console.log(`Question types: ${summarizeSurveyQuestionTypes(survey.questions)}`);
  if (input.moduleName && module && insertionPosition !== undefined) {
    console.log(`Module: ${module.name} (${module.id})`);
    if (input.afterHeaderTitle) {
      console.log(`Insert after subheader: ${input.afterHeaderTitle}`);
    }
    console.log(`Target module position: ${insertionPosition}`);
  }

  if (input.dryRun) {
    console.log(
      existingQuiz
        ? `Dry run: existing survey will be reused (${existingQuiz.id}).`
        : "Dry run: survey would be created."
    );
    if (input.moduleName) {
      if (!existingModuleItem) {
        console.log("Dry run: survey would be added to the module.");
      } else if (existingModuleItem.position !== insertionPosition) {
        console.log("Dry run: survey module item would be moved to the target section.");
      } else {
        console.log("Dry run: survey module item placement already correct.");
      }
    }
    return;
  }

  if (existingQuiz && !input.skipExisting) {
    throw new Error(`Survey "${effectiveTitle}" already exists in course ${input.courseId}. Use --skip-existing to reuse it.`);
  }

  const targetQuiz =
    existingQuiz ??
    await (async () => {
      const created = await client.createQuiz(input.courseId, mapped.canvasQuiz);
      for (const question of mapped.canvasQuestions) {
        await client.addQuizQuestion(input.courseId, created.id, question);
      }
      return created;
    })();

  if (existingQuiz) {
    console.log(`Using existing survey: ${targetQuiz.title} (${targetQuiz.id})`);
  } else {
    console.log(`Created survey: ${targetQuiz.title} (${targetQuiz.id})`);
  }

  if (module && insertionPosition !== undefined) {
    const placementResult = await ensureModuleQuizPlacement({
      client,
      courseId: input.courseId,
      moduleId: module.id,
      moduleItems,
      quizTitle: effectiveTitle,
      quizId: targetQuiz.id,
      insertionPosition
    });

    if (placementResult.createdModuleItem) console.log("Added survey to session module.");
    if (placementResult.movedModuleItem) console.log("Moved survey module item to target section.");
    if (!placementResult.createdModuleItem && !placementResult.movedModuleItem) {
      console.log("Survey module item placement already correct.");
    }
  }

  console.log(`Quiz URL: ${env.canvasBaseUrl}/courses/${input.courseId}/quizzes/${targetQuiz.id}`);
}

function requireObjectRecord(input: unknown, pathLabel: string): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error(`${pathLabel} must be an object.`);
  }
  return input as Record<string, unknown>;
}

function requireNonEmptyString(input: unknown, pathLabel: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${pathLabel} must be a non-empty string.`);
  }
  return input.trim();
}

function optionalString(input: unknown, pathLabel: string): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string") {
    throw new Error(`${pathLabel} must be a string.`);
  }
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalBoolean(input: unknown, pathLabel: string): boolean | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "boolean") {
    throw new Error(`${pathLabel} must be a boolean.`);
  }
  return input;
}

function optionalPositiveInteger(input: unknown, pathLabel: string): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "number" || !Number.isInteger(input) || input <= 0) {
    throw new Error(`${pathLabel} must be a positive integer.`);
  }
  return input;
}

function optionalStringRecord(input: unknown, pathLabel: string): Record<string, string> | undefined {
  if (input === undefined) return undefined;
  const record = requireObjectRecord(input, pathLabel);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string") {
      throw new Error(`${pathLabel}.${key} must be a string.`);
    }
    out[key] = value;
  }
  return out;
}

function buildOrchestratorInterpolationContext(
  session: OrchestratorTemplateSessionSpec
): Record<string, string> {
  const builtIns: Record<string, string> = {
    n: String(session.sessionNumber),
    nn: String(session.sessionNumber).padStart(2, "0"),
    topic: session.topic,
    sessionNumber: String(session.sessionNumber)
  };

  const custom = session.variables ?? {};
  for (const key of Object.keys(custom)) {
    if (Object.prototype.hasOwnProperty.call(builtIns, key)) {
      throw new Error(`sessions.variables cannot override reserved placeholder "${key}".`);
    }
  }

  return {
    ...builtIns,
    ...custom
  };
}

function interpolateTemplateString(
  input: string,
  context: Record<string, string>,
  pathLabel: string
): string {
  return input.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key: string) => {
    if (!Object.prototype.hasOwnProperty.call(context, key)) {
      throw new Error(`Missing placeholder value for "${key}" at ${pathLabel}.`);
    }
    return context[key];
  });
}

function interpolateOrchestratorPageContentBlock(
  block: OrchestratorPageContentBlock,
  context: Record<string, string>,
  pathLabel: string
): OrchestratorPageContentBlock {
  switch (block.type) {
    case "markdown":
      return {
        type: block.type,
        value: interpolateTemplateString(block.value, context, `${pathLabel}.value`)
      };
    case "markdownFile":
      return {
        type: block.type,
        path: interpolateTemplateString(block.path, context, `${pathLabel}.path`)
      };
    case "html":
      return {
        type: block.type,
        value: interpolateTemplateString(block.value, context, `${pathLabel}.value`)
      };
    case "htmlFile":
      return {
        type: block.type,
        path: interpolateTemplateString(block.path, context, `${pathLabel}.path`)
      };
    case "imageFile":
      return {
        type: block.type,
        path: interpolateTemplateString(block.path, context, `${pathLabel}.path`),
        alt: block.alt
          ? interpolateTemplateString(block.alt, context, `${pathLabel}.alt`)
          : undefined,
        filesFolder: interpolateTemplateString(block.filesFolder, context, `${pathLabel}.filesFolder`)
      };
  }
}

function interpolateOrchestratorStep(
  step: OrchestratorStep,
  context: Record<string, string>,
  pathLabel: string
): OrchestratorStep {
  switch (step.type) {
    case "session-headers":
      return {
        type: step.type,
        sessionNumber: step.sessionNumber
      };
    case "subheader":
      return {
        type: step.type,
        title: interpolateTemplateString(step.title, context, `${pathLabel}.title`)
      };
    case "page":
      return {
        type: step.type,
        title: interpolateTemplateString(step.title, context, `${pathLabel}.title`),
        publish: step.publish,
        afterHeaderTitle: step.afterHeaderTitle
          ? interpolateTemplateString(step.afterHeaderTitle, context, `${pathLabel}.afterHeaderTitle`)
          : undefined,
        content: step.content.map((block, index) =>
          interpolateOrchestratorPageContentBlock(block, context, `${pathLabel}.content[${index}]`)
        )
      };
    case "today-section":
      return {
        type: step.type,
        pageTitle: step.pageTitle
          ? interpolateTemplateString(step.pageTitle, context, `${pathLabel}.pageTitle`)
          : undefined,
        notes: step.notes
          ? interpolateTemplateString(step.notes, context, `${pathLabel}.notes`)
          : undefined,
        notesFile: step.notesFile
          ? interpolateTemplateString(step.notesFile, context, `${pathLabel}.notesFile`)
          : undefined,
        imageUrl: step.imageUrl
          ? interpolateTemplateString(step.imageUrl, context, `${pathLabel}.imageUrl`)
          : undefined,
        imageId: step.imageId,
        imageFile: step.imageFile
          ? interpolateTemplateString(step.imageFile, context, `${pathLabel}.imageFile`)
          : undefined,
        aiImagePrompt: step.aiImagePrompt
          ? interpolateTemplateString(step.aiImagePrompt, context, `${pathLabel}.aiImagePrompt`)
          : undefined,
        publish: step.publish
      };
    case "task-a-section":
    case "task-b-section":
    case "task-c-section":
      return {
        type: step.type,
        taskFolder: step.taskFolder
          ? interpolateTemplateString(step.taskFolder, context, `${pathLabel}.taskFolder`)
          : undefined,
        pageTitle: step.pageTitle
          ? interpolateTemplateString(step.pageTitle, context, `${pathLabel}.pageTitle`)
          : undefined,
        notes: step.notes
          ? interpolateTemplateString(step.notes, context, `${pathLabel}.notes`)
          : undefined,
        notesFile: step.notesFile
          ? interpolateTemplateString(step.notesFile, context, `${pathLabel}.notesFile`)
          : undefined,
        publish: step.publish
      };
    case "clone-survey":
      return {
        type: step.type,
        sourceTitle: interpolateTemplateString(step.sourceTitle, context, `${pathLabel}.sourceTitle`),
        title: interpolateTemplateString(step.title, context, `${pathLabel}.title`),
        sourceCourseId: step.sourceCourseId,
        afterHeaderTitle: step.afterHeaderTitle
          ? interpolateTemplateString(step.afterHeaderTitle, context, `${pathLabel}.afterHeaderTitle`)
          : undefined,
        skipExisting: step.skipExisting
      };
    case "create-survey":
      return {
        type: step.type,
        fromFile: interpolateTemplateString(step.fromFile, context, `${pathLabel}.fromFile`),
        title: step.title
          ? interpolateTemplateString(step.title, context, `${pathLabel}.title`)
          : undefined,
        afterHeaderTitle: step.afterHeaderTitle
          ? interpolateTemplateString(step.afterHeaderTitle, context, `${pathLabel}.afterHeaderTitle`)
          : undefined,
        skipExisting: step.skipExisting,
        publish: step.publish
      };
  }
}

function parseOrchestratorPageContentBlock(input: unknown, pathLabel: string): OrchestratorPageContentBlock {
  const record = requireObjectRecord(input, pathLabel);
  const type = requireNonEmptyString(record.type, `${pathLabel}.type`);
  switch (type) {
    case "markdown":
      return {
        type,
        value: requireNonEmptyString(record.value, `${pathLabel}.value`)
      };
    case "markdownFile":
      return {
        type,
        path: requireNonEmptyString(record.path, `${pathLabel}.path`)
      };
    case "html":
      return {
        type,
        value: requireNonEmptyString(record.value, `${pathLabel}.value`)
      };
    case "htmlFile":
      return {
        type,
        path: requireNonEmptyString(record.path, `${pathLabel}.path`)
      };
    case "imageFile":
      return {
        type,
        path: requireNonEmptyString(record.path, `${pathLabel}.path`),
        alt: optionalString(record.alt, `${pathLabel}.alt`),
        filesFolder: requireNonEmptyString(record.filesFolder, `${pathLabel}.filesFolder`)
      };
    default:
      throw new Error(`${pathLabel}.type "${type}" is not supported.`);
  }
}

function parseOrchestratorStep(input: unknown, pathLabel: string): OrchestratorStep {
  const record = requireObjectRecord(input, pathLabel);
  const type = requireNonEmptyString(record.type, `${pathLabel}.type`);
  switch (type) {
    case "session-headers":
      return {
        type,
        sessionNumber: optionalPositiveInteger(record.sessionNumber, `${pathLabel}.sessionNumber`)
      };
    case "subheader":
      return {
        type,
        title: requireNonEmptyString(record.title, `${pathLabel}.title`)
      };
    case "page": {
      const rawContent = record.content;
      if (!Array.isArray(rawContent) || rawContent.length === 0) {
        throw new Error(`${pathLabel}.content must be a non-empty array.`);
      }
      return {
        type,
        title: requireNonEmptyString(record.title, `${pathLabel}.title`),
        publish: optionalBoolean(record.publish, `${pathLabel}.publish`),
        afterHeaderTitle: optionalString(record.afterHeaderTitle, `${pathLabel}.afterHeaderTitle`),
        content: rawContent.map((block, index) =>
          parseOrchestratorPageContentBlock(block, `${pathLabel}.content[${index}]`)
        )
      };
    }
    case "today-section":
      return {
        type,
        pageTitle: optionalString(record.pageTitle, `${pathLabel}.pageTitle`),
        notes: optionalString(record.notes, `${pathLabel}.notes`),
        notesFile: optionalString(record.notesFile, `${pathLabel}.notesFile`),
        imageUrl: optionalString(record.imageUrl, `${pathLabel}.imageUrl`),
        imageId: optionalPositiveInteger(record.imageId, `${pathLabel}.imageId`),
        imageFile: optionalString(record.imageFile, `${pathLabel}.imageFile`),
        aiImagePrompt: optionalString(record.aiImagePrompt, `${pathLabel}.aiImagePrompt`),
        publish: optionalBoolean(record.publish, `${pathLabel}.publish`)
      };
    case "task-a-section":
    case "task-b-section":
    case "task-c-section":
      return {
        type,
        taskFolder: optionalString(record.taskFolder, `${pathLabel}.taskFolder`),
        pageTitle: optionalString(record.pageTitle, `${pathLabel}.pageTitle`),
        notes: optionalString(record.notes, `${pathLabel}.notes`),
        notesFile: optionalString(record.notesFile, `${pathLabel}.notesFile`),
        publish: optionalBoolean(record.publish, `${pathLabel}.publish`)
      };
    case "clone-survey":
      return {
        type,
        sourceTitle: requireNonEmptyString(record.sourceTitle, `${pathLabel}.sourceTitle`),
        title: requireNonEmptyString(record.title, `${pathLabel}.title`),
        sourceCourseId: optionalPositiveInteger(record.sourceCourseId, `${pathLabel}.sourceCourseId`),
        afterHeaderTitle: optionalString(record.afterHeaderTitle, `${pathLabel}.afterHeaderTitle`),
        skipExisting: optionalBoolean(record.skipExisting, `${pathLabel}.skipExisting`)
      };
    case "create-survey":
      return {
        type,
        fromFile: requireNonEmptyString(record.fromFile, `${pathLabel}.fromFile`),
        title: optionalString(record.title, `${pathLabel}.title`),
        afterHeaderTitle: optionalString(record.afterHeaderTitle, `${pathLabel}.afterHeaderTitle`),
        skipExisting: optionalBoolean(record.skipExisting, `${pathLabel}.skipExisting`),
        publish: optionalBoolean(record.publish, `${pathLabel}.publish`)
      };
    default:
      throw new Error(`${pathLabel}.type "${type}" is not supported.`);
  }
}

function parseOrchestratorModuleSpec(input: unknown, pathLabel: string): OrchestratorModuleSpec {
  const moduleRecord = requireObjectRecord(input, pathLabel);
  const rawSteps = moduleRecord.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error(`${pathLabel}.steps must be a non-empty array.`);
  }
  return {
    name: requireNonEmptyString(moduleRecord.name, `${pathLabel}.name`),
    sessionNumber: optionalPositiveInteger(moduleRecord.sessionNumber, `${pathLabel}.sessionNumber`),
    position: optionalPositiveInteger(moduleRecord.position, `${pathLabel}.position`),
    steps: rawSteps.map((stepInput, stepIndex) =>
      parseOrchestratorStep(stepInput, `${pathLabel}.steps[${stepIndex}]`)
    )
  };
}

function parseOrchestratorModuleTemplateSpec(
  input: unknown,
  pathLabel: string
): OrchestratorModuleTemplateSpec {
  const templateRecord = requireObjectRecord(input, pathLabel);
  const rawSteps = templateRecord.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    throw new Error(`${pathLabel}.steps must be a non-empty array.`);
  }
  return {
    name: requireNonEmptyString(templateRecord.name, `${pathLabel}.name`),
    position: optionalPositiveInteger(templateRecord.position, `${pathLabel}.position`),
    steps: rawSteps.map((stepInput, stepIndex) =>
      parseOrchestratorStep(stepInput, `${pathLabel}.steps[${stepIndex}]`)
    )
  };
}

function parseOrchestratorTemplateSessionSpec(
  input: unknown,
  pathLabel: string
): OrchestratorTemplateSessionSpec {
  const sessionRecord = requireObjectRecord(input, pathLabel);
  const sessionNumber = optionalPositiveInteger(sessionRecord.sessionNumber, `${pathLabel}.sessionNumber`);
  if (sessionNumber === undefined) {
    throw new Error(`${pathLabel}.sessionNumber must be a positive integer.`);
  }
  return {
    sessionNumber,
    topic: requireNonEmptyString(sessionRecord.topic, `${pathLabel}.topic`),
    position: optionalPositiveInteger(sessionRecord.position, `${pathLabel}.position`),
    variables: optionalStringRecord(sessionRecord.variables, `${pathLabel}.variables`)
  };
}

function expandOrchestratorModuleTemplate(
  template: OrchestratorModuleTemplateSpec,
  sessions: OrchestratorTemplateSessionSpec[]
): OrchestratorModuleSpec[] {
  return sessions.map((session, index) => {
    const context = buildOrchestratorInterpolationContext(session);
    return {
      name: interpolateTemplateString(template.name, context, `blueprint.moduleTemplate.name`),
      sessionNumber: session.sessionNumber,
      position: session.position ?? template.position,
      steps: template.steps.map((step, stepIndex) =>
        interpolateOrchestratorStep(
          step,
          context,
          `blueprint.moduleTemplate.steps[${stepIndex}] for sessions[${index}]`
        )
      )
    };
  });
}

function assertUniqueOrchestratorModuleNames(modules: OrchestratorModuleSpec[]): void {
  const seen = new Set<string>();
  for (const module of modules) {
    const key = normalizeName(module.name);
    if (seen.has(key)) {
      throw new Error(`Duplicate module name in orchestration blueprint: "${module.name}".`);
    }
    seen.add(key);
  }
}

function parseCourseOrchestratorBlueprint(input: unknown): OrchestratorBlueprint {
  const record = requireObjectRecord(input, "blueprint");
  const schemaVersion = requireNonEmptyString(record.schemaVersion, "blueprint.schemaVersion");
  if (schemaVersion !== "course-orchestrator.v1" && schemaVersion !== "course-orchestrator.v2") {
    throw new Error(`Unsupported blueprint.schemaVersion "${schemaVersion}".`);
  }

  const modules: OrchestratorModuleSpec[] = [];
  if (Array.isArray(record.modules) && record.modules.length > 0) {
    modules.push(
      ...record.modules.map((moduleInput, moduleIndex) =>
        parseOrchestratorModuleSpec(moduleInput, `blueprint.modules[${moduleIndex}]`)
      )
    );
  }

  if (schemaVersion === "course-orchestrator.v1") {
    if (modules.length === 0) {
      throw new Error("blueprint.modules must be a non-empty array.");
    }
    assertUniqueOrchestratorModuleNames(modules);
    return {
      schemaVersion: "course-orchestrator.v1",
      modules
    };
  }

  const hasTemplateInput = record.moduleTemplate !== undefined || record.sessions !== undefined;
  if (hasTemplateInput) {
    const template = parseOrchestratorModuleTemplateSpec(record.moduleTemplate, "blueprint.moduleTemplate");
    if (!Array.isArray(record.sessions) || record.sessions.length === 0) {
      throw new Error("blueprint.sessions must be a non-empty array.");
    }
    const sessions = record.sessions.map((sessionInput, sessionIndex) =>
      parseOrchestratorTemplateSessionSpec(sessionInput, `blueprint.sessions[${sessionIndex}]`)
    );
    modules.push(...expandOrchestratorModuleTemplate(template, sessions));
  }

  if (modules.length === 0) {
    throw new Error(
      'course-orchestrator.v2 requires either a non-empty "modules" array or "moduleTemplate" with "sessions".'
    );
  }

  assertUniqueOrchestratorModuleNames(modules);
  return {
    schemaVersion: "course-orchestrator.v2",
    modules
  };
}

async function runCourseOrchestrateWorkflow(input: {
  courseId: number;
  blueprintFilePath: string;
  assetsRoot: string;
  dryRun: boolean;
}): Promise<void> {
  const blueprintFilePath = path.resolve(input.blueprintFilePath);
  const blueprintDir = path.dirname(blueprintFilePath);
  const rawBlueprint = JSON.parse(await fs.readFile(blueprintFilePath, "utf8"));
  const blueprint = parseCourseOrchestratorBlueprint(rawBlueprint);
  const client = new CanvasClient();

  console.log(`Course: ${input.courseId}`);
  console.log(`Blueprint: ${blueprintFilePath}`);
  console.log(`Schema: ${blueprint.schemaVersion}`);
  console.log(`Modules: ${blueprint.modules.length}`);
  if (input.dryRun) {
    console.log("Mode: dry-run");
  }

  for (const moduleSpec of blueprint.modules) {
    console.log("");
    console.log(`== Module: ${moduleSpec.name}`);

    const existingModule = await findExactModuleByNameIfExists(client, input.courseId, moduleSpec.name);
    let moduleRef: CanvasModuleSummary | undefined = existingModule;

    if (input.dryRun) {
      if (existingModule) {
        console.log(`Module exists: ${existingModule.name} (${existingModule.id})`);
      } else {
        console.log(`Module would be created${moduleSpec.position ? ` at position ${moduleSpec.position}` : ""}.`);
      }
    } else {
      const ensured = await ensureModuleByName(client, input.courseId, moduleSpec.name, {
        position: moduleSpec.position
      });
      moduleRef = ensured.module;
      console.log(
        ensured.created
          ? `Created module: ${ensured.module.name} (${ensured.module.id})`
          : `Using existing module: ${ensured.module.name} (${ensured.module.id})`
      );
    }

    const moduleIsAddressable = Boolean(moduleRef);
    for (const step of moduleSpec.steps) {
      console.log(`-- Step: ${step.type}`);

      if (!moduleIsAddressable && input.dryRun) {
        if (step.type === "session-headers") {
          const sessionNumber = step.sessionNumber ?? moduleSpec.sessionNumber;
          if (!sessionNumber) {
            throw new Error(`Module "${moduleSpec.name}" needs a sessionNumber for step "session-headers".`);
          }
          const config = await loadConfig();
          const headers = buildSessionHeaderTitles(sessionNumber, config.sessions);
          console.log("Dry run: module does not exist yet, planning headers:");
          for (const title of headers) {
            console.log(`- ${title}`);
          }
          continue;
        }

        if (step.type === "subheader") {
          console.log(`Dry run: would create subheader "${step.title}" after module creation.`);
          continue;
        }

        if (step.type === "page") {
          const rendered = await renderOrchestratorPageHtml({
            courseId: input.courseId,
            blocks: step.content,
            baseDir: blueprintDir,
            dryRun: true
          });
          console.log(`Dry run: would create/update page "${step.title}" after module creation.`);
          console.log("Generated HTML preview:");
          console.log(rendered.html.split("\n").slice(0, 30).join("\n"));
          continue;
        }

        if (step.type === "clone-survey") {
          const sourceCourseId = step.sourceCourseId ?? input.courseId;
          const source = await resolveExactQuizCloneSource({
            client,
            sourceCourseId,
            sourceTitle: step.sourceTitle
          });
          const existingQuiz = await findExactQuizByTitleIfExists(client, input.courseId, step.title);
          console.log(
            existingQuiz
              ? `Dry run: existing survey "${step.title}" will be reused (${existingQuiz.id}).`
              : `Dry run: survey "${step.title}" would be cloned from course ${sourceCourseId} after module creation.`
          );
          console.log(`Source survey: ${source.summary.title} (${source.summary.id})`);
          if (step.afterHeaderTitle) {
            console.log(`Dry run: survey would be placed under "${step.afterHeaderTitle}" after module creation.`);
          }
          continue;
        }

        if (step.type === "create-survey") {
          const surveyFilePath = path.resolve(blueprintDir, step.fromFile);
          const survey = await loadSurveyFromFile(surveyFilePath);
          const effectiveTitle = step.title ?? survey.title;
          const existingQuiz = await findExactQuizByTitleIfExists(client, input.courseId, effectiveTitle);
          console.log(
            existingQuiz
              ? `Dry run: existing survey "${effectiveTitle}" will be reused (${existingQuiz.id}).`
              : `Dry run: survey "${effectiveTitle}" would be created after module creation from ${step.fromFile}.`
          );
          if (step.afterHeaderTitle) {
            console.log(`Dry run: survey would be placed under "${step.afterHeaderTitle}" after module creation.`);
          }
          continue;
        }

        console.log("Dry run: full preview requires the module to exist first; step skipped.");
        continue;
      }

      switch (step.type) {
        case "session-headers": {
          const sessionNumber = step.sessionNumber ?? moduleSpec.sessionNumber;
          if (!sessionNumber) {
            throw new Error(`Module "${moduleSpec.name}" needs a sessionNumber for step "session-headers".`);
          }
          await runSessionHeadersWorkflow({
            courseId: input.courseId,
            moduleName: moduleSpec.name,
            sessionNumber,
            dryRun: input.dryRun,
            client
          });
          break;
        }
        case "subheader":
          await runModuleSubHeaderWorkflow({
            courseId: input.courseId,
            moduleName: moduleSpec.name,
            title: step.title,
            dryRun: input.dryRun,
            client
          });
          break;
        case "page":
          await runModulePageWorkflow({
            courseId: input.courseId,
            moduleName: moduleSpec.name,
            title: step.title,
            publish: Boolean(step.publish),
            afterHeaderTitle: step.afterHeaderTitle,
            content: step.content,
            baseDir: blueprintDir,
            dryRun: input.dryRun,
            client
          });
          break;
        case "today-section":
          await runTodaySectionWorkflow({
            courseId: input.courseId,
            sessionName: moduleSpec.name,
            pageTitle: step.pageTitle,
            notesText: step.notes,
            notesFilePath: step.notesFile ? path.resolve(blueprintDir, step.notesFile) : undefined,
            imageUrl: step.imageUrl,
            imageId: step.imageId,
            imageFilePath: step.imageFile,
            aiImagePrompt: step.aiImagePrompt,
            publish: Boolean(step.publish),
            assetsRoot: input.assetsRoot,
            dryRun: input.dryRun,
            client
          });
          break;
        case "task-a-section":
        case "task-b-section":
        case "task-c-section":
          await runTaskSectionWorkflow({
            courseId: input.courseId,
            sessionName: moduleSpec.name,
            taskLetter: step.type === "task-a-section" ? "A" : step.type === "task-b-section" ? "B" : "C",
            taskFolder: step.taskFolder,
            pageTitle: step.pageTitle,
            notesText: step.notes,
            notesFilePath: step.notesFile ? path.resolve(blueprintDir, step.notesFile) : undefined,
            publish: Boolean(step.publish),
            assetsRoot: input.assetsRoot,
            dryRun: input.dryRun,
            client
          });
          break;
        case "clone-survey":
          await runModuleCloneSurveyWorkflow({
            courseId: input.courseId,
            moduleName: moduleSpec.name,
            sourceCourseId: step.sourceCourseId ?? input.courseId,
            sourceTitle: step.sourceTitle,
            title: step.title,
            afterHeaderTitle: step.afterHeaderTitle,
            skipExisting: step.skipExisting ?? true,
            dryRun: input.dryRun,
            client
          });
          break;
        case "create-survey":
          await runCreateSurveyWorkflow({
            courseId: input.courseId,
            surveyFilePath: path.resolve(blueprintDir, step.fromFile),
            title: step.title,
            publish: Boolean(step.publish),
            skipExisting: step.skipExisting ?? true,
            moduleName: moduleSpec.name,
            afterHeaderTitle: step.afterHeaderTitle,
            dryRun: input.dryRun,
            client
          });
          break;
      }
    }
  }
}

program.command("create")
  .description("Create a quiz in Canvas from a JSON file or from an agent prompt.")
  .option("--course-id <id>", "Canvas course id to upload to", String(env.canvasTestCourseId))
  .option("--from-file <path>", "Load Nexgen quiz JSON from file")
  .option("--prompt <text>", "Generate quiz from agent using a prompt")
  .option("--difficulty <level>", "Difficulty for agent-generated quiz: easy, medium, hard, or mixed")
  .option("--dry-run", "Validate and show a summary without uploading", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);

    if (!opts.fromFile && !opts.prompt) {
      throw new Error("Provide either --from-file or --prompt.");
    }
    if (opts.fromFile && opts.prompt) {
      throw new Error("Provide only one of --from-file or --prompt.");
    }
    if (opts.fromFile && opts.difficulty) {
      throw new Error("--difficulty can only be used with --prompt.");
    }

    const difficulty = opts.difficulty
      ? parseQuizDifficulty(String(opts.difficulty), "--difficulty")
      : undefined;

    let raw: unknown;

    if (opts.fromFile) {
      const txt = await fs.readFile(String(opts.fromFile), "utf8");
      raw = JSON.parse(txt);
    } else {
      raw = await generateQuizFromAgent(String(opts.prompt), { difficulty });
    }

    const quiz = validateNexgenQuiz(raw);
    const mapped = mapToCanvasQuiz(quiz);

    console.log(`Quiz: ${quiz.title}`);
    console.log(`Questions: ${quiz.questions.length} (expected 5)`);
    console.log(`Target course: ${courseId}`);
    if (difficulty) {
      console.log(`Requested difficulty: ${difficulty}`);
    }
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

program.command("course-files-scaffold")
  .description("Create a folder scaffold in Canvas Files for a course.")
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--from-file <path>", "Optional JSON file describing the folder tree")
  .option("--dry-run", "Show which Canvas folders would be created", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    let folders: CanvasFolderNode[];
    if (opts.fromFile) {
      const text = await fs.readFile(String(opts.fromFile), "utf8");
      folders = parseCanvasFolderStructureInput(JSON.parse(text));
    } else {
      folders = buildDefaultCanvasCourseFilesStructure();
    }

    const client = new CanvasClient();
    const result = await ensureCanvasFolderTree({
      client,
      courseId,
      folders,
      dryRun: Boolean(opts.dryRun)
    });

    console.log(`Course: ${courseId}`);
    console.log(`Source: ${opts.fromFile ? `JSON file ${String(opts.fromFile)}` : "built-in default scaffold"}`);
    console.log(`Folders already present: ${result.existingPaths.length}`);
    for (const folderPath of result.existingPaths) {
      console.log(`= ${folderPath}`);
    }
    if (opts.dryRun) {
      console.log(`Folders to create: ${result.createdPaths.length}`);
      for (const folderPath of result.createdPaths) {
        console.log(`+ ${folderPath}`);
      }
      console.log("Dry run: no Canvas folders created.");
      return;
    }

    console.log(`Folders created: ${result.createdPaths.length}`);
    for (const folderPath of result.createdPaths) {
      console.log(`+ ${folderPath}`);
    }
  });

program.command("create-survey")
  .description("Create an ungraded or graded survey in Canvas from a survey JSON file.")
  .requiredOption("--from-file <path>", "Path to the Nexgen survey JSON file")
  .option("--title <title>", "Override survey title")
  .option("--module-name <name>", "Optional module name to place the survey into")
  .option("--after-header-title <title>", "Optional subheader title to place the survey after")
  .option("--publish", "Publish survey after create/update (default is unpublished)", false)
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--skip-existing", "Reuse an existing survey with the same target title", false)
  .option("--dry-run", "Show planned survey creation and placement without Canvas writes", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }
    if (opts.afterHeaderTitle && !opts.moduleName) {
      throw new Error("--after-header-title requires --module-name.");
    }

    await runCreateSurveyWorkflow({
      courseId,
      surveyFilePath: path.resolve(String(opts.fromFile)),
      title: opts.title ? String(opts.title) : undefined,
      publish: Boolean(opts.publish),
      skipExisting: Boolean(opts.skipExisting),
      moduleName: opts.moduleName ? String(opts.moduleName) : undefined,
      afterHeaderTitle: opts.afterHeaderTitle ? String(opts.afterHeaderTitle) : undefined,
      dryRun: Boolean(opts.dryRun)
    });
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
    await runSessionHeadersWorkflow({
      courseId,
      moduleName: String(opts.moduleName),
      sessionNumber,
      dryRun: Boolean(opts.dryRun)
    });
  });

program.command("clone-survey")
  .description("Clone a source quiz/survey into session-numbered copies with new titles.")
  .requiredOption("--source-title <title>", "Exact source quiz title to copy from")
  .option("--title-template <template>", "Title template using {nn} and/or {n}; defaults from source title")
  .option("--range <start-end>", "Inclusive session number range (for example, 2-7)")
  .option("--sessions <numbers>", "Comma-separated session numbers (for example, 2,3,5)")
  .option("--pad <number>", "Zero-padding width for {nn}", "2")
  .option("--source-course-id <id>", "Canvas course id to clone the source quiz/survey from")
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
    const sourceCourseId = opts.sourceCourseId
      ? parsePositiveInteger(String(opts.sourceCourseId), "--source-course-id")
      : courseId;
    const rawTemplate = opts.titleTemplate ? String(opts.titleTemplate) : deriveTitleTemplate(sourceTitle);
    const titleTemplate = ensureTemplateToken(rawTemplate);

    await runCloneSurveyBatchWorkflow({
      sourceCourseId,
      targetCourseId: courseId,
      sourceTitle,
      titleTemplate,
      sessionNumbers,
      pad,
      skipExisting: Boolean(opts.skipExisting),
      dryRun: Boolean(opts.dryRun)
    });
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

program.command("task-a-section")
  .description("Generate or update the session page for Task A using local session-assets content.")
  .requiredOption("--session-name <name>", "Exact Canvas module name for the session")
  .option("--task-folder <name>", "Task A folder name under session-assets/<session-name>")
  .option("--page-title <title>", "Canvas page title override (default: notes.md Page Title)")
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--notes <text>", "Optional Task A notes markdown override (saved to notes.md)")
  .option("--notes-file <path>", "Optional Task A notes markdown file override (saved to notes.md)")
  .option("--publish", "Publish page after create/update (default is unpublished)", false)
  .option(
    "--assets-root <path>",
    "Local root for task assets",
    path.resolve(process.cwd(), "apps", "cli", "session-assets")
  )
  .option("--dry-run", "Generate and preview without uploading", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    if (opts.notes && opts.notesFile) {
      throw new Error("Use either --notes or --notes-file, not both.");
    }

    await runTaskSectionWorkflow({
      courseId,
      sessionName: String(opts.sessionName),
      taskLetter: "A",
      taskFolder: opts.taskFolder ? String(opts.taskFolder) : undefined,
      pageTitle: opts.pageTitle ? String(opts.pageTitle) : undefined,
      notesText: opts.notes ? String(opts.notes) : undefined,
      notesFilePath: opts.notesFile ? String(opts.notesFile) : undefined,
      publish: Boolean(opts.publish),
      assetsRoot: path.resolve(String(opts.assetsRoot)),
      dryRun: Boolean(opts.dryRun)
    });
  });

program.command("task-b-section")
  .description("Generate or update the session page for Task B using local session-assets content.")
  .requiredOption("--session-name <name>", "Exact Canvas module name for the session")
  .option("--task-folder <name>", "Task B folder name under session-assets/<session-name>")
  .option("--page-title <title>", "Canvas page title override (default: notes.md Page Title)")
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--notes <text>", "Optional Task B notes markdown override (saved to notes.md)")
  .option("--notes-file <path>", "Optional Task B notes markdown file override (saved to notes.md)")
  .option("--publish", "Publish page after create/update (default is unpublished)", false)
  .option(
    "--assets-root <path>",
    "Local root for task assets",
    path.resolve(process.cwd(), "apps", "cli", "session-assets")
  )
  .option("--dry-run", "Generate and preview without uploading", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    if (opts.notes && opts.notesFile) {
      throw new Error("Use either --notes or --notes-file, not both.");
    }

    await runTaskSectionWorkflow({
      courseId,
      sessionName: String(opts.sessionName),
      taskLetter: "B",
      taskFolder: opts.taskFolder ? String(opts.taskFolder) : undefined,
      pageTitle: opts.pageTitle ? String(opts.pageTitle) : undefined,
      notesText: opts.notes ? String(opts.notes) : undefined,
      notesFilePath: opts.notesFile ? String(opts.notesFile) : undefined,
      publish: Boolean(opts.publish),
      assetsRoot: path.resolve(String(opts.assetsRoot)),
      dryRun: Boolean(opts.dryRun)
    });
  });

program.command("task-c-section")
  .description("Generate or update the session page for Task C using local session-assets content.")
  .requiredOption("--session-name <name>", "Exact Canvas module name for the session")
  .option("--task-folder <name>", "Task C folder name under session-assets/<session-name>")
  .option("--page-title <title>", "Canvas page title override (default: notes.md Page Title)")
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--notes <text>", "Optional Task C notes markdown override (saved to notes.md)")
  .option("--notes-file <path>", "Optional Task C notes markdown file override (saved to notes.md)")
  .option("--publish", "Publish page after create/update (default is unpublished)", false)
  .option(
    "--assets-root <path>",
    "Local root for task assets",
    path.resolve(process.cwd(), "apps", "cli", "session-assets")
  )
  .option("--dry-run", "Generate and preview without uploading", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    if (opts.notes && opts.notesFile) {
      throw new Error("Use either --notes or --notes-file, not both.");
    }

    await runTaskSectionWorkflow({
      courseId,
      sessionName: String(opts.sessionName),
      taskLetter: "C",
      taskFolder: opts.taskFolder ? String(opts.taskFolder) : undefined,
      pageTitle: opts.pageTitle ? String(opts.pageTitle) : undefined,
      notesText: opts.notes ? String(opts.notes) : undefined,
      notesFilePath: opts.notesFile ? String(opts.notesFile) : undefined,
      publish: Boolean(opts.publish),
      assetsRoot: path.resolve(String(opts.assetsRoot)),
      dryRun: Boolean(opts.dryRun)
    });
  });

program.command("today-section")
  .description("Generate or update the session page for the 'What we are doing Today' section.")
  .requiredOption("--session-name <name>", "Exact Canvas module name for the session")
  .option("--page-title <title>", "Canvas page title override (default: Introduction: <session topic>)")
  .option("--course-id <id>", "Canvas course id to use", String(env.canvasTestCourseId))
  .option("--notes <text>", "Optional raw notes text (rewritten by agent)")
  .option("--notes-file <path>", "Optional path to raw notes text/markdown (rewritten by agent)")
  .option("--image-url <url>", "Optional image URL to embed in the section")
  .option("--image-id <id>", "Optional existing Canvas file id to embed in the section")
  .option(
    "--image-file <path>",
    "Optional local image path relative to the session's 'What we are doing Today' folder"
  )
  .option("--ai-image-prompt <text>", "Optional AI image prompt/brief to include and save locally")
  .option("--publish", "Publish page after create/update (default is unpublished)", false)
  .option(
    "--assets-root <path>",
    "Local root for section notes/images",
    path.resolve(process.cwd(), "apps", "cli", "session-assets")
  )
  .option("--dry-run", "Generate and preview without uploading", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    if (opts.notes && opts.notesFile) {
      throw new Error("Use either --notes or --notes-file, not both.");
    }
    if (opts.imageUrl && opts.imageId) {
      throw new Error("Use either --image-url or --image-id, not both.");
    }
    if (opts.imageUrl && opts.imageFile) {
      throw new Error("Use either --image-url or --image-file, not both.");
    }
    if (opts.imageFile && opts.imageId) {
      throw new Error("Use either --image-file or --image-id, not both.");
    }

    await runTodaySectionWorkflow({
      courseId,
      sessionName: String(opts.sessionName),
      pageTitle: opts.pageTitle ? String(opts.pageTitle) : undefined,
      notesText: opts.notes ? String(opts.notes) : undefined,
      notesFilePath: opts.notesFile ? String(opts.notesFile) : undefined,
      imageUrl: opts.imageUrl ? String(opts.imageUrl) : undefined,
      imageId: opts.imageId ? parsePositiveInteger(String(opts.imageId), "--image-id") : undefined,
      imageFilePath: opts.imageFile ? String(opts.imageFile) : undefined,
      aiImagePrompt: opts.aiImagePrompt ? String(opts.aiImagePrompt) : undefined,
      publish: Boolean(opts.publish),
      assetsRoot: path.resolve(String(opts.assetsRoot)),
      dryRun: Boolean(opts.dryRun)
    });
  });

program.command("course-orchestrate")
  .description("Create or update multiple course modules and pages from a JSON blueprint.")
  .requiredOption("--course-id <id>", "Canvas course id to target")
  .requiredOption(
    "--from-file <path>",
    "Path to the course orchestration JSON blueprint, typically under apps/cli/course-assets/<course>/orchestrator.json"
  )
  .option(
    "--assets-root <path>",
    "Local root for section assets used by session workflows",
    path.resolve(process.cwd(), "apps", "cli", "session-assets")
  )
  .option("--dry-run", "Plan orchestration without making Canvas writes", false)
  .action(async (opts) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId) || courseId <= 0) {
      throw new Error("Invalid --course-id. Provide a positive numeric Canvas course id.");
    }

    await runCourseOrchestrateWorkflow({
      courseId,
      blueprintFilePath: String(opts.fromFile),
      assetsRoot: path.resolve(String(opts.assetsRoot)),
      dryRun: Boolean(opts.dryRun)
    });
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
