import {
  CanvasClient,
  CanvasModuleItem,
  CanvasModuleSummary
} from "../canvas/canvasClient.js";
import { resolveModuleByName } from "./sessionHeaders.js";

type SessionPageContext = {
  title: string;
  pageUrl: string;
  position: number;
  bodyHtml: string;
  bodyText: string;
};

export type TodaySectionBuildOptions = {
  sectionTitle: string;
  notesText?: string;
  imageUrl?: string;
  aiImagePrompt?: string;
};

export type TodaySectionBuildResult = {
  module: CanvasModuleSummary;
  moduleItems: CanvasModuleItem[];
  sourcePageCount: number;
  introPageCount: number;
  sectionHtml: string;
  insertionPosition: number;
  imageUrl?: string;
  aiImagePrompt?: string;
  usedNotes: boolean;
};

const TASK_HEADER_RE = /^session\s+\d+\s*:\s*task\s+[a-z0-9]/i;
const SPACE_RE = /\s+/g;
const MARKDOWN_HEADING_RE = /^#{1,6}\s*/;
const NOTE_PLACEHOLDER_TOKEN = "[ADD NOTES]";
const AI_PROMPT_PLACEHOLDER_TOKEN = "[ADD AI IMAGE PROMPT]";
const IMAGE_URL_PLACEHOLDER_TOKEN = "https://example.com/your-image.jpg";

export async function buildWhatAreWeDoingTodaySection(
  client: CanvasClient,
  courseId: number,
  sessionName: string,
  options: TodaySectionBuildOptions
): Promise<TodaySectionBuildResult> {
  const module = await resolveModuleByName(client, courseId, sessionName);
  const moduleItems = await client.listModuleItems(courseId, module.id);
  const sortedItems = [...moduleItems].sort((a, b) => a.position - b.position);
  const teacherNotesRange = findTeacherNotesRange(sortedItems);

  const sectionTitleKey = normalizeLoose(options.sectionTitle);
  const pageItems = sortedItems.filter(
    (item) =>
      item.type === "Page" &&
      !!item.page_url &&
      normalizeLoose(item.title) !== sectionTitleKey &&
      !normalizeLoose(item.title).includes("teacher notes") &&
      !isPositionInRange(item.position, teacherNotesRange)
  );

  const pages = (
    await Promise.all(
      pageItems.map(async (item) => {
        const page = await client.getPage(courseId, String(item.page_url));
        return {
          title: item.title,
          pageUrl: String(item.page_url),
          position: item.position,
          bodyHtml: page.body ?? "",
          bodyText: toPlainText(page.body ?? "")
        };
      })
    )
  ).sort((a, b) => a.position - b.position);

  const introPages = resolveIntroPages(sortedItems, pages);
  const taskHeaders = resolveTaskHeaders(sortedItems);
  const notesParagraphs = parseNotesParagraphs(options.notesText);
  const summaryParagraphs =
    notesParagraphs.length > 0
      ? notesParagraphs
      : buildSummaryParagraphs(introPages, taskHeaders, module.name);

  const resolvedImageUrl =
    normalizeOptionalText(options.imageUrl) ??
    extractFirstImageUrl(introPages.map((page) => page.bodyHtml));
  const resolvedAiPrompt = normalizeOptionalText(options.aiImagePrompt);

  const sectionHtml = renderTodaySectionHtml({
    summaryParagraphs,
    imageUrl: resolvedImageUrl
  });

  return {
    module,
    moduleItems: sortedItems,
    sourcePageCount: pages.length,
    introPageCount: introPages.length,
    sectionHtml,
    insertionPosition: findTodaySectionInsertionPosition(sortedItems),
    imageUrl: resolvedImageUrl,
    aiImagePrompt: resolvedAiPrompt,
    usedNotes: notesParagraphs.length > 0
  };
}

function findTeacherNotesRange(
  items: CanvasModuleItem[]
): { start: number; endExclusive: number } | undefined {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const header = sorted.find(
    (item) =>
      item.type === "SubHeader" &&
      (normalizeLoose(item.title) === "teachers notes" || normalizeLoose(item.title) === "teacher notes")
  );
  if (!header) return undefined;

  const nextSubHeader = sorted.find(
    (item) => item.type === "SubHeader" && item.position > header.position
  );
  return {
    start: header.position,
    endExclusive: nextSubHeader ? nextSubHeader.position : Number.POSITIVE_INFINITY
  };
}

function isPositionInRange(
  position: number,
  range: { start: number; endExclusive: number } | undefined
): boolean {
  if (!range) return false;
  return position > range.start && position < range.endExclusive;
}

function parseNotesParagraphs(input: string | undefined): string[] {
  const text = normalizeOptionalText(input);
  if (!text) return [];

  const stripped = text
    .replace(/\r\n/g, "\n")
    .replace(new RegExp(escapeRegExp(NOTE_PLACEHOLDER_TOKEN), "gi"), "")
    .trim();
  if (!stripped) return [];

  return stripped
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph
        .replace(MARKDOWN_HEADING_RE, "")
        .replace(SPACE_RE, " ")
        .trim()
    )
    .filter((paragraph) => paragraph.length >= 25)
    .slice(0, 2);
}

function buildSummaryParagraphs(
  introPages: SessionPageContext[],
  taskHeaders: string[],
  sessionName: string
): string[] {
  const introSentences = dedupe(
    introPages
      .map((page) => firstSentence(page.bodyText))
      .filter((value): value is string => Boolean(value))
      .map(cleanupSentence)
      .filter((value) => value.length >= 25)
  );

  const paragraphOne =
    introSentences.length > 0
      ? introSentences.slice(0, 2).join(" ")
      : `In this session, students will build practical skills from ${sessionName} through guided activities and hands-on testing.`;

  const taskLabels = taskHeaders
    .map((title) => parseTaskLabel(title))
    .filter((value): value is string => Boolean(value));
  const taskSummary =
    taskLabels.length > 0
      ? `Today we will move through ${joinLabels(taskLabels)} in sequence, checking progress after each stage and explaining how each decision improves the final result.`
      : "Today we will complete structured activities, test outcomes, and refine work based on what we observe.";

  return [ensureSentence(paragraphOne), ensureSentence(taskSummary)];
}

function renderTodaySectionHtml(input: {
  summaryParagraphs: string[];
  imageUrl?: string;
}): string {
  const lines: string[] = [];

  for (const paragraph of input.summaryParagraphs.slice(0, 2)) {
    lines.push(`<p>${escapeHtml(paragraph)}</p>`);
  }

  if (input.imageUrl) {
    lines.push("<p>");
    lines.push(
      `<img src="${escapeHtml(input.imageUrl)}" alt="Session inspiration image" style="display:block;max-width:100%;height:auto;margin:12px auto;border-radius:8px;" />`
    );
    lines.push("</p>");
  } else {
    lines.push(
      "<p><em>Inspiration image placeholder: add an image URL in image-url.txt (or pass --image-url) and re-run this command.</em></p>"
    );
  }

  return lines.join("\n");
}

function resolveIntroPages(
  moduleItems: CanvasModuleItem[],
  pages: SessionPageContext[]
): SessionPageContext[] {
  const firstTask = moduleItems.find((item) => item.type === "SubHeader" && TASK_HEADER_RE.test(item.title));
  if (!firstTask) {
    return pages.slice(0, 2);
  }
  return pages.filter((page) => page.position < firstTask.position).slice(0, 2);
}

function resolveTaskHeaders(moduleItems: CanvasModuleItem[]): string[] {
  return moduleItems
    .filter((item) => item.type === "SubHeader" && TASK_HEADER_RE.test(item.title))
    .sort((a, b) => a.position - b.position)
    .map((item) => item.title.trim());
}

function findTodaySectionInsertionPosition(items: CanvasModuleItem[]): number {
  const sorted = [...items].sort((a, b) => a.position - b.position);

  const todayHeader = sorted.find(
    (item) => item.type === "SubHeader" && isTodayHeader(item.title)
  );
  if (todayHeader) return todayHeader.position + 1;

  const quizHeader = sorted.find(
    (item) => item.type === "SubHeader" && normalizeLoose(item.title) === "quiz"
  );
  if (quizHeader) return quizHeader.position;

  const firstTask = sorted.find((item) => item.type === "SubHeader" && TASK_HEADER_RE.test(item.title));
  if (firstTask) return firstTask.position;

  return sorted.length === 0 ? 1 : sorted[0].position;
}

function isTodayHeader(title: string): boolean {
  const normalized = normalizeLoose(title);
  return normalized === "what we are doing today" || normalized === "what are we doing today";
}

function parseTaskLabel(title: string): string | undefined {
  const match = title.match(/^Session\s+\d+\s*:\s*Task\s+([A-Za-z0-9]+)/i);
  if (!match) return undefined;
  return `Task ${match[1].toUpperCase()}`;
}

function joinLabels(labels: string[]): string {
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function extractFirstImageUrl(bodies: string[]): string | undefined {
  for (const body of bodies) {
    const match = body.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate && !candidate.includes(IMAGE_URL_PLACEHOLDER_TOKEN)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function toPlainText(html: string): string {
  const noTags = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|h1|h2|h3|h4|h5|h6|div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(noTags).replace(SPACE_RE, " ").trim();
}

function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    rsquo: "'",
    lsquo: "'",
    ldquo: "\"",
    rdquo: "\"",
    times: "x"
  };

  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      const code = Number.parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (key.startsWith("#")) {
      const code = Number.parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] ?? match;
  });
}

function firstSentence(text: string): string | undefined {
  const normalized = text.replace(SPACE_RE, " ").trim();
  if (!normalized) return undefined;

  const parts = normalized.split(/(?<=[.!?])\s+/);
  for (const part of parts) {
    const cleaned = cleanupSentence(part);
    if (cleaned.length >= 20) return ensureSentence(cleaned);
  }

  return normalized.length >= 20 ? ensureSentence(cleanupSentence(normalized)) : undefined;
}

function cleanupSentence(input: string): string {
  return input
    .replace(/^hi all[,!\s]*/i, "")
    .replace(/^in this session,?\s*/i, "")
    .replace(SPACE_RE, " ")
    .trim();
}

function ensureSentence(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const normalized = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function normalizeLoose(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(SPACE_RE, " ")
    .trim();
}

function normalizeOptionalText(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.replace(SPACE_RE, " ").trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (lower.includes(NOTE_PLACEHOLDER_TOKEN.toLowerCase())) return undefined;
  if (lower.includes(AI_PROMPT_PLACEHOLDER_TOKEN.toLowerCase())) return undefined;
  if (lower.includes(IMAGE_URL_PLACEHOLDER_TOKEN.toLowerCase())) return undefined;
  return trimmed;
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.replace(SPACE_RE, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
