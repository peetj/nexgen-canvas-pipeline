import { marked } from "marked";
import {
  CanvasClient,
  CanvasModuleItem,
  CanvasModuleSummary
} from "../canvas/canvasClient.js";
import { resolveModuleByName } from "./sessionHeaders.js";

export type TaskAMediaKind = "image" | "video" | "file";
export type TaskACalloutTone = "note" | "info" | "warning" | "success" | "question";
export type TaskACalloutStyles = Partial<Record<TaskACalloutTone, string>>;

export type TaskAMediaAsset = {
  url: string;
  kind: TaskAMediaKind;
  label?: string;
};

export type TaskASectionBuildOptions = {
  pageTitle: string;
  taskTitle?: string;
  philosophyText?: string;
  bodyMarkdown?: string;
  suppressTaskTitleHeading?: boolean;
  disableAutoMediaSection?: boolean;
  notesMarkdown?: string;
  customCss?: string;
  calloutStyles?: TaskACalloutStyles;
  mediaAssets?: TaskAMediaAsset[];
  overviewText?: string;
  learningGoals?: string[];
  safetyNotes?: string[];
};

export type TaskASectionBuildResult = {
  module: CanvasModuleSummary;
  moduleItems: CanvasModuleItem[];
  sectionHtml: string;
  insertionPosition: number;
  taskHeaderTitle: string;
  usedMarkdown: boolean;
  mediaCount: number;
};

const TASK_A_HEADER_RE = /^session\s+\d+\s*:\s*task\s*a\b/i;
const TASK_B_HEADER_RE = /^session\s+\d+\s*:\s*task\s*b\b/i;
const TASK_C_HEADER_RE = /^session\s+\d+\s*:\s*task\s*c\b/i;
const CALLOUT_LINE_RE = /^\s*(NOTE|INFO|WARNING|SUCCESS|QUESTION)\s*:\s*(.+)\s*$/i;

const DEFAULT_PHILOSOPHY_TEXT =
  "Task A is the foundation task: students build core understanding with clear, achievable steps before attempting extension complexity.";

const BASE_CALLOUT_INLINE_STYLE = [
  "border-left:4px solid #016CE3",
  "background:#F5F6FF",
  "border-radius:0",
  "line-height:1.55",
  "overflow:hidden",
  "padding:15px",
  "margin:12px 0"
].join("; ");

const CALLOUT_TONE_INLINE_STYLE: Record<TaskACalloutTone, string> = {
  info: "",
  note: "border-left-color:#f4c60e; background:#fffbea",
  warning: "border-left-color:#FE2B3E; background:#fff7f5",
  success: "border-left-color:#5FD26F; background:#f6fdf9",
  question: "border-left-color:#d35400; background:#FFE5B4"
};

const CALLOUT_TITLE_INLINE_STYLE = [
  "margin:0 0 8px",
  "font-size:1rem",
  "color:#0f1721"
].join("; ");

const BASE_TASK_A_CSS = `
.ng-task-page {
  max-width: 980px;
  margin: 0 auto;
  line-height: 1.55;
  color: #1d2733;
}
.ng-task-page h2,
.ng-task-page h3 {
  color: #0f1721;
}
.ng-task-philosophy {
  margin: 14px 0 22px;
}
.ng-task-callout {
  border-left: solid 4px #016CE3;
  background: #F5F6FF;
  border-radius: 0;
  line-height: 18px;
  overflow: hidden;
  padding: 15px 15px;
  margin: 12px 0;
}
.ng-task-callout h4 {
  margin: 0 0 8px;
  font-size: 1rem;
}
.ng-task-callout--warning {
  border-left-color: #FE2B3E;
  background: #fff7f5;
}
.ng-task-callout--success {
  border-left-color: #5FD26F;
  background: #f6fdf9;
}
.ng-task-callout--note {
  border-left-color: #f4c60e;
  background: #fffbea;
}
.ng-task-callout--question {
  border-left-color: #d35400;
  background: #FFE5B4;
}
.ng-task-media {
  margin-top: 22px;
}
.ng-task-media-grid {
  display: grid;
  gap: 14px;
}
.ng-task-media-item {
  margin: 0;
}
.ng-task-media-item img,
.ng-task-media-item video,
.ng-task-media-item iframe {
  width: 100%;
  max-width: 100%;
  border: 0;
  border-radius: 8px;
  display: block;
}
.ng-task-media-item figcaption {
  margin-top: 6px;
  font-size: 0.9rem;
  color: #4c596c;
}
.ng-task-table {
  width: 100%;
  border-collapse: collapse;
  margin: 12px 0 16px;
}
.ng-task-table th,
.ng-task-table td {
  border: 1px solid #d5dbe5;
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
.ng-task-table thead th {
  background: #f5f7fb;
}
`.trim();

export async function buildTaskASection(
  client: CanvasClient,
  courseId: number,
  sessionName: string,
  options: TaskASectionBuildOptions
): Promise<TaskASectionBuildResult> {
  return buildTaskSectionByHeader(client, courseId, sessionName, options, {
    taskLabel: "Task A",
    taskHeaderRe: TASK_A_HEADER_RE
  });
}

export async function buildTaskBSection(
  client: CanvasClient,
  courseId: number,
  sessionName: string,
  options: TaskASectionBuildOptions
): Promise<TaskASectionBuildResult> {
  return buildTaskSectionByHeader(client, courseId, sessionName, options, {
    taskLabel: "Task B",
    taskHeaderRe: TASK_B_HEADER_RE
  });
}

export async function buildTaskCSection(
  client: CanvasClient,
  courseId: number,
  sessionName: string,
  options: TaskASectionBuildOptions
): Promise<TaskASectionBuildResult> {
  return buildTaskSectionByHeader(client, courseId, sessionName, options, {
    taskLabel: "Task C",
    taskHeaderRe: TASK_C_HEADER_RE
  });
}

async function buildTaskSectionByHeader(
  client: CanvasClient,
  courseId: number,
  sessionName: string,
  options: TaskASectionBuildOptions,
  input: { taskLabel: string; taskHeaderRe: RegExp }
): Promise<TaskASectionBuildResult> {
  const module = await resolveModuleByName(client, courseId, sessionName);
  const moduleItems = await client.listModuleItems(courseId, module.id);
  const sortedItems = [...moduleItems].sort((a, b) => a.position - b.position);

  const taskHeader = sortedItems.find(
    (item) => item.type === "SubHeader" && input.taskHeaderRe.test(item.title)
  );
  if (!taskHeader) {
    throw new Error(
      `${input.taskLabel} subheader not found in module "${module.name}". ` +
      `Expected a header like "Session NN: ${input.taskLabel}".`
    );
  }

  const sectionHtml = renderTaskASectionHtml(options);

  return {
    module,
    moduleItems: sortedItems,
    sectionHtml,
    insertionPosition: taskHeader.position + 1,
    taskHeaderTitle: taskHeader.title,
    usedMarkdown: Boolean(options.notesMarkdown?.trim()),
    mediaCount: Array.isArray(options.mediaAssets) ? options.mediaAssets.length : 0
  };
}

function renderTaskASectionHtml(input: TaskASectionBuildOptions): string {
  const taskTitle = normalizeRequiredText(input.taskTitle, "Task A");
  const philosophyText =
    normalizeOptionalText(input.philosophyText) ?? DEFAULT_PHILOSOPHY_TEXT;
  const explicitBodyMarkdown = normalizeOptionalText(input.bodyMarkdown);
  const calloutStyles = normalizeCalloutStyles(input.calloutStyles);
  const philosophyHtml = renderMarkdownWithCallouts(philosophyText, calloutStyles);
  const notesHtml = renderMarkdownWithCallouts(
    explicitBodyMarkdown ?? input.notesMarkdown ?? "",
    calloutStyles
  );
  const overviewText = normalizeOptionalText(input.overviewText);
  const learningGoals = normalizeTextList(input.learningGoals, 6);
  const safetyNotes = normalizeTextList(input.safetyNotes, 5);
  const mediaAssets = normalizeMediaAssets(input.mediaAssets ?? []);
  const customCss = normalizeOptionalText(input.customCss);

  const lines: string[] = [];
  lines.push("<style>");
  lines.push(BASE_TASK_A_CSS);
  const calloutCss = buildCalloutStyleCss(calloutStyles);
  if (calloutCss) {
    lines.push("");
    lines.push("/* Parsed callout styles from notes.md */");
    lines.push(calloutCss);
  }
  if (customCss) {
    lines.push("");
    lines.push("/* Session custom styles (Task A asset folder) */");
    lines.push(customCss);
  }
  lines.push("</style>");
  lines.push(`<div class="ng-task-page ng-task-page--a" data-page="${escapeHtml(input.pageTitle)}">`);
  if (!input.suppressTaskTitleHeading) {
    lines.push(`<h2>${escapeHtml(taskTitle)}</h2>`);
  }

  if (!explicitBodyMarkdown) {
    lines.push(
      `<section class="ng-task-philosophy ng-task-callout ng-task-callout--info" style="${escapeHtml(buildCalloutInlineStyle("info", calloutStyles))}">`
    );
    lines.push("<h3>Task A Philosophy</h3>");
    lines.push(philosophyHtml);
    lines.push("</section>");
  }

  if (!explicitBodyMarkdown && overviewText) {
    lines.push("<section>");
    lines.push("<h3>Overview</h3>");
    lines.push(`<p>${escapeHtml(overviewText)}</p>`);
    lines.push("</section>");
  }

  if (!explicitBodyMarkdown && learningGoals.length > 0) {
    lines.push("<section>");
    lines.push("<h3>Learning Goals</h3>");
    lines.push("<ul>");
    for (const goal of learningGoals) {
      lines.push(`<li><p>${escapeHtml(goal)}</p></li>`);
    }
    lines.push("</ul>");
    lines.push("</section>");
  }

  lines.push("<section>");
  if (!explicitBodyMarkdown) {
    lines.push("<h3>Task Instructions</h3>");
  }
  if (notesHtml) {
    lines.push(notesHtml);
  } else {
    lines.push(
      "<p><em>Add task instructions to notes.md in the Task A asset folder, then run this command again.</em></p>"
    );
  }
  lines.push("</section>");

  if (!explicitBodyMarkdown && safetyNotes.length > 0) {
    lines.push(
      `<section class="ng-task-callout ng-task-callout--warning" style="${escapeHtml(buildCalloutInlineStyle("warning", calloutStyles))}">`
    );
    lines.push("<h3>Safety Checks</h3>");
    lines.push("<ul>");
    for (const note of safetyNotes) {
      lines.push(`<li><p>${escapeHtml(note)}</p></li>`);
    }
    lines.push("</ul>");
    lines.push("</section>");
  }

  if (!input.disableAutoMediaSection && mediaAssets.length > 0) {
    lines.push("<section class=\"ng-task-media\">");
    lines.push("<h3>Media</h3>");
    lines.push("<div class=\"ng-task-media-grid\">");
    for (const media of mediaAssets) {
      lines.push(renderMediaHtml(media));
    }
    lines.push("</div>");
    lines.push("</section>");
  }

  lines.push("</div>");
  return lines.join("\n");
}

function renderMarkdownWithCallouts(input: string, calloutStyles: TaskACalloutStyles): string {
  const source = normalizeOptionalText(input);
  if (!source) return "";

  const callouts: Array<{ kind: string; title?: string; body: string }> = [];
  const tokenized = tokenizeCalloutMarkdown(source, callouts);

  let html = renderMarkdown(tokenized);
  for (let i = 0; i < callouts.length; i += 1) {
    const token = `@@NG_CALLOUT_${i}@@`;
    const callout = callouts[i];
    const rendered = renderCalloutHtml(callout.kind, callout.title, callout.body, calloutStyles);
    html = html.replace(new RegExp(`<p>\\s*${escapeRegExp(token)}\\s*<\\/p>`, "g"), rendered);
    html = html.replace(token, rendered);
  }
  return html;
}

function tokenizeCalloutMarkdown(
  source: string,
  callouts: Array<{ kind: string; title?: string; body: string }>
): string {
  const lines = source.split(/\r?\n/);
  const out: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const directiveMatch = line.trim().match(/^:::(info|warning|success|note|question)(?:\s+(.+))?$/i);
    if (directiveMatch) {
      const kind = directiveMatch[1].toLowerCase();
      const title = normalizeOptionalText(directiveMatch[2]);
      const bodyLines: string[] = [];
      let closed = false;

      for (i += 1; i < lines.length; i += 1) {
        if (lines[i].trim() === ":::") {
          closed = true;
          break;
        }
        bodyLines.push(lines[i]);
      }

      if (!closed) {
        out.push(line);
        out.push(...bodyLines);
        break;
      }

      const index = callouts.length;
      callouts.push({
        kind,
        title,
        body: bodyLines.join("\n").trim()
      });
      out.push("");
      out.push(`@@NG_CALLOUT_${index}@@`);
      out.push("");
      continue;
    }

    const inlineMatch = line.match(CALLOUT_LINE_RE);
    if (inlineMatch) {
      const index = callouts.length;
      callouts.push({
        kind: inlineMatch[1].toLowerCase(),
        title: inlineMatch[1].toUpperCase(),
        body: inlineMatch[2]
      });
      out.push(`@@NG_CALLOUT_${index}@@`);
      continue;
    }

    out.push(line);
  }

  return out.join("\n");
}

function renderCalloutHtml(
  kind: string,
  title: string | undefined,
  body: string,
  calloutStyles: TaskACalloutStyles
): string {
  const normalizedKind = toCalloutKind(kind);
  const bodyHtml = renderMarkdown(body);

  return [
    `<section class="ng-task-callout ng-task-callout--${normalizedKind}" style="${escapeHtml(buildCalloutInlineStyle(normalizedKind, calloutStyles))}">`,
    title ? `<h4 style="${escapeHtml(CALLOUT_TITLE_INLINE_STYLE)}">${escapeHtml(title)}</h4>` : "",
    bodyHtml,
    "</section>"
  ]
    .filter(Boolean)
    .join("\n");
}

function toCalloutKind(input: string): TaskACalloutTone {
  const normalized = input.toLowerCase();
  if (
    normalized === "warning" ||
    normalized === "success" ||
    normalized === "note" ||
    normalized === "question"
  ) {
    return normalized;
  }
  return "info";
}

function normalizeCalloutStyles(input: TaskACalloutStyles | undefined): TaskACalloutStyles {
  if (!input) return {};
  const out: TaskACalloutStyles = {};
  const keys: TaskACalloutTone[] = ["note", "info", "warning", "success", "question"];
  for (const key of keys) {
    const raw = input[key];
    if (typeof raw !== "string") continue;
    const cleaned = raw.trim().replace(/^["']|["']$/g, "");
    if (!cleaned) continue;
    out[key] = cleaned;
  }
  return out;
}

function buildCalloutStyleCss(input: TaskACalloutStyles): string {
  const entries: Array<{ key: TaskACalloutTone; selector: string }> = [
    { key: "note", selector: ".ng-task-callout--note" },
    { key: "info", selector: ".ng-task-callout--info" },
    { key: "warning", selector: ".ng-task-callout--warning" },
    { key: "success", selector: ".ng-task-callout--success" },
    { key: "question", selector: ".ng-task-callout--question" }
  ];

  const lines: string[] = [];
  for (const entry of entries) {
    const style = input[entry.key];
    if (!style) continue;
    lines.push(`${entry.selector} { ${style} }`);
  }
  return lines.join("\n");
}

function buildCalloutInlineStyle(kind: TaskACalloutTone, input: TaskACalloutStyles): string {
  const parts = [BASE_CALLOUT_INLINE_STYLE];
  const toneStyle = CALLOUT_TONE_INLINE_STYLE[kind];
  if (toneStyle) parts.push(toneStyle);
  const customStyle = input[kind];
  if (customStyle) parts.push(customStyle);
  return parts.join("; ");
}

function renderMarkdown(input: string): string {
  return String(marked.parse(input, { gfm: true, breaks: false }));
}

function normalizeRequiredText(input: string | undefined, fallback: string): string {
  const normalized = normalizeOptionalText(input);
  return normalized ?? fallback;
}

function normalizeOptionalText(input: string | undefined): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTextList(input: string[] | undefined, max: number): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeMediaAssets(input: TaskAMediaAsset[]): TaskAMediaAsset[] {
  const out: TaskAMediaAsset[] = [];
  const seen = new Set<string>();
  for (const asset of input) {
    if (!asset || typeof asset.url !== "string") continue;
    const url = asset.url.trim();
    if (!url) continue;
    const key = `${asset.kind}:${url}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      url,
      kind: asset.kind,
      label: normalizeOptionalText(asset.label)
    });
  }
  return out;
}

function renderMediaHtml(asset: TaskAMediaAsset): string {
  if (asset.kind === "image") {
    return [
      "<figure class=\"ng-task-media-item\">",
      `<img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.label ?? "Task media image")}" loading="lazy" />`,
      asset.label ? `<figcaption>${escapeHtml(asset.label)}</figcaption>` : "",
      "</figure>"
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (asset.kind === "video") {
    const embedUrl = toYouTubeEmbedUrl(asset.url) ?? toVimeoEmbedUrl(asset.url);
    if (embedUrl) {
      return [
        "<figure class=\"ng-task-media-item\">",
        `<iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(asset.label ?? "Task media video")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`,
        asset.label ? `<figcaption>${escapeHtml(asset.label)}</figcaption>` : "",
        "</figure>"
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (isDirectVideoUrl(asset.url)) {
      return [
        "<figure class=\"ng-task-media-item\">",
        `<video controls preload="metadata" src="${escapeHtml(asset.url)}"></video>`,
        asset.label ? `<figcaption>${escapeHtml(asset.label)}</figcaption>` : "",
        "</figure>"
      ]
        .filter(Boolean)
        .join("\n");
    }
  }

  return [
    "<figure class=\"ng-task-media-item\">",
    `<p><a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(asset.label ?? asset.url)}</a></p>`,
    "</figure>"
  ].join("\n");
}

function isDirectVideoUrl(url: string): boolean {
  return /\.(mp4|webm|ogg|m4v|mov)(\?.*)?$/i.test(url);
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
