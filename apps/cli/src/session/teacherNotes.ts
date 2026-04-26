import {
  CanvasClient,
  CanvasModuleItem,
  CanvasModuleSummary
} from "../canvas/canvasClient.js";
import {
  generateTeacherNotesFromAgent,
  TeacherNotesAgentInput,
  TeacherNotesAgentOutput
} from "../agent/teacherNotes/teacherNotesAgentClient.js";
import { resolveModuleByName } from "./sessionHeaders.js";
import { TEACHER_NOTES_TEMPLATE } from "./teacherNotesTemplate.js";

type SessionPageContext = {
  title: string;
  pageUrl: string;
  position: number;
  bodyHtml: string;
  bodyText: string;
};

type SessionTask = {
  title: string;
  pages: SessionPageContext[];
};

type CoursePageContext = SessionPageContext & {
  moduleId: number;
  moduleName: string;
};

type CommonIssue = {
  issue: string;
  solution: string;
};

type CourseInsight = {
  highlightAreas: string[];
  issueHints: CommonIssue[];
};

export type TeacherNotesBuildResult = {
  module: CanvasModuleSummary;
  moduleItems: CanvasModuleItem[];
  modulePages: SessionPageContext[];
  notesHtml: string;
  insertionPosition: number;
  generationMode: "agent" | "heuristic";
  generationWarning?: string;
};

const TASK_HEADER_RE = /^session\s+\d+\s*:\s*task\s+[a-z0-9]/i;
const SPACE_RE = /\s+/g;
const CONTEXT_TOKEN_RE = /\b(?:[a-z][a-z0-9-]{2,}|3d)\b/gi;

const CONTEXT_STOP_WORDS = new Set([
  "about", "activity", "activities", "after", "again", "basic", "before", "between",
  "build", "building", "busy", "change", "changes", "class", "classroom", "complete",
  "confident", "course", "designs", "doing", "each", "effective", "extension", "extensions",
  "finish", "first", "focus", "from", "guide", "help", "ideas", "improve", "improves",
  "improving", "independent", "independence", "intro", "introduction", "just", "lesson",
  "main", "make", "model", "models", "module", "modules", "more", "most", "move", "moving",
  "next", "notes", "objective", "optional", "other", "page", "pages", "part", "parts",
  "practical", "project", "projects", "really", "review", "session", "skills", "small",
  "start", "step", "steps", "student", "students", "support", "task", "tasks", "teacher",
  "teachers", "their", "them", "there", "these", "they", "this", "through", "today",
  "using", "very", "want", "week", "what", "when", "will", "with", "work", "working",
  "year", "your", "zippy"
]);

type TeacherNotesSourceEvidence = {
  sessionKeywords: Set<string>;
  taskKeywordsByTitle: Map<string, Set<string>>;
};

type TeacherNotesBuildOptions = {
  reviewNotes?: string;
};

type ParsedTeacherNotesReview = {
  objectiveHints: string[];
  forceHardwareNA: boolean;
  highlightAreaHints: string[];
  reviewCommonIssues: string[];
  taskNotesByTitle: Map<string, string>;
};

const SOFTWARE_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\barduino ide\b/i, label: "Arduino IDE" },
  { pattern: /\bserial monitor\b/i, label: "Serial Monitor" },
  { pattern: /\bblender\b/i, label: "Blender" },
  { pattern: /\btinkercad\b/i, label: "Tinkercad" },
  { pattern: /\bweb browser\b/i, label: "Web browser (Chrome preferred)" }
];

const HARDWARE_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\blcd\b/i, label: "LCD screen module" },
  { pattern: /\b3x4\b|\bmatrix keypad\b|\bkeypad\b/i, label: "3x4 matrix keypad" },
  { pattern: /\besp32\b|\bnodemcu\b/i, label: "NodeMCU ESP32 board" },
  { pattern: /\bbreadboard\b/i, label: "Breadboard" },
  { pattern: /\bjumper wire/i, label: "Jumper wires" },
  { pattern: /\busb\b/i, label: "USB cable" },
  { pattern: /\bsolder(?:ing)?\b|\bsoldering iron\b/i, label: "Soldering iron" },
  { pattern: /\bflux\b/i, label: "Flux / solder paste" },
  { pattern: /\bmultimeter\b|\bcontinuity\b/i, label: "Multimeter (continuity mode)" },
  { pattern: /\bdesolder(?:ing)?\b|\bsolder wick\b/i, label: "Desoldering braid / solder wick" }
];

const COURSE_HIGHLIGHT_SIGNALS: Array<{ pattern: RegExp; point: string }> = [
  {
    pattern: /\b(debug|troubleshoot|serial monitor|test)\b/i,
    point:
      "Push students to use a visible debug loop: inspect, test, adjust, and retest before asking for fixes."
  },
  {
    pattern: /\b(wiring|pin|connection|diagram)\b/i,
    point:
      "Treat wiring verification as mandatory evidence, not a verbal check. Students should trace each connection against the diagram."
  },
  {
    pattern: /\b(upload|compile|port|board)\b/i,
    point:
      "Anticipate upload and board-selection friction. Have a rapid board/port checklist ready before students escalate."
  },
  {
    pattern: /\b(solder|soldering|iron|flux|continuity|bridge|cold joint)\b/i,
    point:
      "For soldering, prioritize technique checkpoints: iron temperature, joint quality, bridge checks, and continuity testing."
  },
  {
    pattern: /\b(save|checkpoint|version)\b/i,
    point:
      "Require checkpoint saves at each working milestone so students can recover from failed experiments quickly."
  }
];

// These are treated as system-level authoring rules for all future teacher-notes runs.
const TEACHER_NOTES_SYSTEM_RULES = {
  sessionObjectiveLead: "By the end of the session, students should be able to:",
  sessionTeacherFocus:
    "Encourage students to explain their thinking, test ideas independently, and iterate before asking for direct fixes.",
  taskTeacherFocus:
    "Prompt students to predict outcomes, test one change at a time, and justify their debugging decisions.",
  troubleshootingClose:
    "Keep students in a troubleshooting cycle: inspect, test, adjust, then re-test."
} as const;

export async function buildTeacherNotesForSession(
  client: CanvasClient,
  courseId: number,
  sessionName: string,
  pageTitle: string,
  options: TeacherNotesBuildOptions = {}
): Promise<TeacherNotesBuildResult> {
  const module = await resolveModuleByName(client, courseId, sessionName);
  const moduleItems = await client.listModuleItems(courseId, module.id);
  const sortedItems = [...moduleItems].sort((a, b) => a.position - b.position);

  const pageCache = new Map<string, { bodyHtml: string; bodyText: string }>();
  const modulePages = await collectModulePages(
    client,
    courseId,
    sortedItems,
    pageTitle,
    pageCache
  );
  const coursePages = await collectCoursePages(client, courseId, pageTitle, pageCache);
  const courseInsight = buildCourseInsights(sessionName, modulePages, coursePages);
  const tasks = resolveTasks(sortedItems, modulePages);
  const sourceEvidence = buildTeacherNotesSourceEvidence(sessionName, pageTitle, modulePages, tasks);
  const parsedReview = parseTeacherNotesReviewNotes(options.reviewNotes);

  let notesHtml: string;
  let generationMode: "agent" | "heuristic" = "heuristic";
  let generationWarning: string | undefined;

  try {
    const agentInput = buildTeacherNotesAgentInput(
      pageTitle,
      sessionName,
      sortedItems,
      modulePages,
      options
    );
    const baseAgentOutput = sanitizeTeacherNotesAgentOutput(
      await generateTeacherNotesFromAgent({
        ...agentInput,
        reviewNotes: undefined,
        currentDraft: undefined
      }),
      sourceEvidence
    );
    const reviewedAgentOutput = options.reviewNotes
      ? sanitizeTeacherNotesAgentOutput(
          await generateTeacherNotesFromAgent({
            ...agentInput,
            currentDraft: baseAgentOutput
          }),
          sourceEvidence
        )
      : baseAgentOutput;
    const agentOutput = options.reviewNotes
      ? applyReviewGuidanceFallbacks(reviewedAgentOutput, parsedReview)
      : reviewedAgentOutput;
    notesHtml = renderTeacherNotesHtmlFromAgent(pageTitle, agentOutput);
    generationMode = "agent";
  } catch (err) {
    generationWarning = err instanceof Error ? err.message : String(err);
    notesHtml = renderTeacherNotesHtml(
      pageTitle,
      sessionName,
      sortedItems,
      modulePages,
      courseInsight
    );
  }

  const insertionPosition = findTeacherNotesInsertionPosition(sortedItems);

  return {
    module,
    moduleItems: sortedItems,
    modulePages,
    notesHtml,
    insertionPosition,
    generationMode,
    generationWarning
  };
}

function buildTeacherNotesAgentInput(
  pageTitle: string,
  sessionName: string,
  moduleItems: CanvasModuleItem[],
  modulePages: SessionPageContext[],
  options: TeacherNotesBuildOptions
): TeacherNotesAgentInput {
  const introPages = resolveIntroPages(moduleItems, modulePages);
  const tasks = resolveTasks(moduleItems, modulePages);
  const fullText = modulePages.map((page) => page.bodyText).join("\n");
  const parsedReview = parseTeacherNotesReviewNotes(options.reviewNotes);
  const contextKeywords = extractContextKeywords([
    sessionName,
    pageTitle,
    ...modulePages.map((page) => page.title),
    ...modulePages.map((page) => page.bodyText)
  ], 24);

  return {
    sessionName,
    pageTitle,
    sessionOverview:
      buildPageExcerpt(introPages.map((page) => page.bodyText).join(" "), 3, 420) ??
      buildPageExcerpt(fullText, 3, 420),
    modulePageTitles: modulePages.map((page) => page.title),
    contextKeywords,
    reviewNotes: options.reviewNotes,
    reviewCommonIssues: parsedReview.reviewCommonIssues,
    objectiveHints: dedupe([
      ...buildObjectivePoints(introPages, tasks, sessionName),
      ...parsedReview.objectiveHints
    ]).slice(0, 4),
    softwareHints: detectComponents(fullText, SOFTWARE_KEYWORDS, []),
    hardwareHints: parsedReview.forceHardwareNA
      ? []
      : detectComponents(fullText, HARDWARE_KEYWORDS, []),
    highlightAreaHints: parsedReview.highlightAreaHints,
    commonIssueHints: buildReviewCommonIssueHints(parsedReview.reviewCommonIssues),
    taskContexts: tasks.map((task) => {
      const reviewTaskNotes = parsedReview.taskNotesByTitle.get(normalizeTaskReference(task.title));
      return {
        title: task.title,
        pageTitles: task.pages.map((page) => page.title),
        outcomeHint: buildTaskSummary(task),
        pageSummaries: task.pages
          .map((page) => buildPageExcerpt(page.bodyText))
          .filter((summary): summary is string => Boolean(summary)),
        reinforceHints: dedupe([
          ...buildTaskPoints(task),
          ...buildTaskReviewHints(reviewTaskNotes)
        ]).slice(0, 5),
        reviewNotes: reviewTaskNotes
      };
    })
  };
}

async function collectModulePages(
  client: CanvasClient,
  courseId: number,
  moduleItems: CanvasModuleItem[],
  pageTitle: string,
  pageCache: Map<string, { bodyHtml: string; bodyText: string }>
): Promise<SessionPageContext[]> {
  const teacherNotesRange = findTeacherNotesRange(moduleItems);
  const pageTitleKey = normalizeLoose(pageTitle);
  const pageItems = moduleItems.filter(
    (item) =>
      item.type === "Page" &&
      !!item.page_url &&
      normalizeLoose(item.title) !== pageTitleKey &&
      !normalizeLoose(item.title).includes("teacher notes") &&
      !isPositionInRange(item.position, teacherNotesRange)
  );

  const pages = await Promise.all(
    pageItems.map(async (item) => {
      const pageUrl = String(item.page_url);
      const data = await getPageData(client, courseId, pageUrl, pageCache);
      return {
        title: item.title,
        pageUrl,
        position: item.position,
        bodyHtml: data.bodyHtml,
        bodyText: data.bodyText
      };
    })
  );

  return pages.sort((a, b) => a.position - b.position);
}

async function collectCoursePages(
  client: CanvasClient,
  courseId: number,
  pageTitle: string,
  pageCache: Map<string, { bodyHtml: string; bodyText: string }>
): Promise<CoursePageContext[]> {
  const modules = await client.listModules(courseId);
  const sessionModules = modules.filter((module) => /^session\s+\d+/i.test(module.name.trim()));
  const modulesToScan = sessionModules.length > 0 ? sessionModules : modules;

  const pagesByModule = await Promise.all(
    modulesToScan.map(async (module) => {
      const moduleItems = (await client.listModuleItems(courseId, module.id)).sort(
        (a, b) => a.position - b.position
      );
      const teacherNotesRange = findTeacherNotesRange(moduleItems);
      const pageTitleKey = normalizeLoose(pageTitle);
      const pageItems = moduleItems.filter(
        (item) =>
          item.type === "Page" &&
          !!item.page_url &&
          normalizeLoose(item.title) !== pageTitleKey &&
          !normalizeLoose(item.title).includes("teacher notes") &&
          !isPositionInRange(item.position, teacherNotesRange)
      );

      return Promise.all(
        pageItems.map(async (item) => {
          const pageUrl = String(item.page_url);
          const data = await getPageData(client, courseId, pageUrl, pageCache);
          return {
            title: item.title,
            pageUrl,
            position: item.position,
            bodyHtml: data.bodyHtml,
            bodyText: data.bodyText,
            moduleId: module.id,
            moduleName: module.name
          };
        })
      );
    })
  );

  return pagesByModule.flat();
}

async function getPageData(
  client: CanvasClient,
  courseId: number,
  pageUrl: string,
  pageCache: Map<string, { bodyHtml: string; bodyText: string }>
): Promise<{ bodyHtml: string; bodyText: string }> {
  const cached = pageCache.get(pageUrl);
  if (cached) return cached;

  const page = await client.getPage(courseId, pageUrl);
  const data = {
    bodyHtml: page.body ?? "",
    bodyText: toPlainText(page.body ?? "")
  };
  pageCache.set(pageUrl, data);
  return data;
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

function renderTeacherNotesHtml(
  pageTitle: string,
  sessionName: string,
  moduleItems: CanvasModuleItem[],
  modulePages: SessionPageContext[],
  courseInsight: CourseInsight
): string {
  const introPages = resolveIntroPages(moduleItems, modulePages);
  const tasks = resolveTasks(moduleItems, modulePages);
  const fullText = modulePages.map((p) => p.bodyText).join("\n");

  const objectivePoints = buildObjectivePoints(introPages, tasks, sessionName);
  const software = detectComponents(fullText, SOFTWARE_KEYWORDS, ["Arduino IDE", "Serial Monitor"]);
  const hardware = detectComponents(fullText, HARDWARE_KEYWORDS, [
    "LCD screen module",
    "3x4 matrix keypad",
    "NodeMCU ESP32 board"
  ]);
  const highlightAreas = courseInsight.highlightAreas;
  const commonIssues = buildCommonIssues(tasks, fullText, courseInsight.issueHints, sessionName);

  const lines: string[] = [];
  lines.push(`<h2>${escapeHtml(pageTitle)}</h2>`);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.mainSessionObjectiveHeading)}</h3>`);
  lines.push(`<p>${escapeHtml(TEACHER_NOTES_SYSTEM_RULES.sessionObjectiveLead)}</p>`);
  lines.push("<ul>");
  for (const point of objectivePoints) {
    lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
  }
  lines.push("</ul>");
  lines.push(`<p><strong>Teacher focus:</strong> ${escapeHtml(TEACHER_NOTES_SYSTEM_RULES.sessionTeacherFocus)}</p>`);
  lines.push("<hr />");
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.componentsAndSoftwareHeading)}</h3>`);
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.softwareLabel)}</strong></p>`);
  lines.push("<ul>");
  for (const item of software) {
    lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
  }
  lines.push("</ul>");
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.hardwareLabel)}</strong></p>`);
  lines.push("<ul>");
  for (const item of hardware) {
    lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
  }
  lines.push("</ul>");

  lines.push("<hr />");
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherHighlightAreasHeading)}</h3>`);
  lines.push("<ul>");
  for (const highlight of highlightAreas) {
    lines.push(`<li><p>${escapeHtml(highlight)}</p></li>`);
  }
  lines.push("</ul>");

  lines.push("<hr />");
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.taskGuidanceHeading)}</h3>`);
  if (tasks.length === 0) {
    lines.push("<p>No task headers were detected for this module. Add task subheaders so this section can be expanded automatically.</p>");
  }
  for (const task of tasks) {
    lines.push(`<h4>${escapeHtml(task.title)}</h4>`);
    lines.push(`<p>${escapeHtml(buildTaskSummary(task))}</p>`);

    const taskPoints = buildTaskPoints(task);
    if (taskPoints.length > 0) {
      lines.push(`<p>${escapeHtml(TEACHER_NOTES_TEMPLATE.reinforceLabel)}</p>`);
      lines.push("<ul>");
      for (const point of taskPoints) {
        lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
      }
      lines.push("</ul>");
    }
    const differentiation = buildTaskDifferentiation(task);
    lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.differentiationLabel)}</strong></p>`);
    lines.push("<ul>");
    lines.push(
      `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.beginnersLabel)}</strong> ${escapeHtml(differentiation.beginner)}</p></li>`
    );
    lines.push(
      `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.extensionLabel)}</strong> ${escapeHtml(differentiation.extension)}</p></li>`
    );
    lines.push("</ul>");
    lines.push(`<p><strong>Teacher focus:</strong> ${escapeHtml(TEACHER_NOTES_SYSTEM_RULES.taskTeacherFocus)}</p>`);
  }

  lines.push("<hr />");
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.mostCommonIssuesHeading)}</h3>`);
  lines.push("<ul>");
  for (const issue of commonIssues) {
    lines.push("<li>");
    lines.push(`<p>${escapeHtml(issue.issue)}</p>`);
    lines.push("<ul>");
    lines.push(`<li><p><strong>Solution:</strong> ${escapeHtml(issue.solution)}</p></li>`);
    lines.push("</ul>");
    lines.push("</li>");
  }
  lines.push("</ul>");
  lines.push(`<p>${escapeHtml(TEACHER_NOTES_SYSTEM_RULES.troubleshootingClose)}</p>`);

  return lines.join("\n");
}

function renderTeacherNotesHtmlFromAgent(
  pageTitle: string,
  content: TeacherNotesAgentOutput
): string {
  const lines: string[] = [];
  lines.push(`<h2>${escapeHtml(pageTitle)}</h2>`);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.mainSessionObjectiveHeading)}</h3>`);
  lines.push(`<p>${escapeHtml(TEACHER_NOTES_SYSTEM_RULES.sessionObjectiveLead)}</p>`);
  lines.push("<ul>");
  for (const point of normalizeStudentObjectives(content.sessionObjective)) {
    lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
  }
  lines.push("</ul>");
  if (content.teacherFocus) {
    lines.push(
      `<p><strong>Teacher focus:</strong> ${escapeHtml(content.teacherFocus)}</p>`
    );
  }

  lines.push("<hr />");
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.componentsAndSoftwareHeading)}</h3>`);
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.softwareLabel)}</strong></p>`);
  lines.push("<ul>");
  for (const item of content.software) {
    lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
  }
  lines.push("</ul>");
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.hardwareLabel)}</strong></p>`);
  lines.push("<ul>");
  for (const item of (content.hardware.length > 0 ? content.hardware : ["N/A"])) {
    lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
  }
  lines.push("</ul>");

  lines.push("<hr />");
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherHighlightAreasHeading)}</h3>`);
  lines.push("<ul>");
  for (const highlight of content.highlightAreas) {
    lines.push(`<li><p>${escapeHtml(highlight)}</p></li>`);
  }
  lines.push("</ul>");

  lines.push("<hr />");
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.taskGuidanceHeading)}</h3>`);
  if (content.tasks.length === 0) {
    lines.push("<p>No task headers were detected for this module. Add task subheaders so this section can be expanded automatically.</p>");
  }
  for (const task of content.tasks) {
    lines.push(`<h4>${escapeHtml(task.title)}</h4>`);
    if (task.outcome) {
      lines.push(`<p>${escapeHtml(task.outcome)}</p>`);
    }
    if (task.reinforce.length > 0) {
      lines.push(`<p>${escapeHtml(TEACHER_NOTES_TEMPLATE.reinforceLabel)}</p>`);
      lines.push("<ul>");
      for (const point of task.reinforce) {
        lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
      }
      lines.push("</ul>");
    }
    if (task.goldenNuggets.length > 0) {
      lines.push(`<p>${escapeHtml(TEACHER_NOTES_TEMPLATE.goldenNuggetsLabel)}</p>`);
      lines.push("<ul>");
      for (const nugget of task.goldenNuggets) {
        lines.push(`<li><p>${escapeHtml(nugget)}</p></li>`);
      }
      lines.push("</ul>");
    }
    if (task.beginner || task.extension) {
      lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.differentiationLabel)}</strong></p>`);
      lines.push("<ul>");
      if (task.beginner) {
        lines.push(
          `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.beginnersLabel)}</strong> ${escapeHtml(task.beginner)}</p></li>`
        );
      }
      if (task.extension) {
        lines.push(
          `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.extensionLabel)}</strong> ${escapeHtml(task.extension)}</p></li>`
        );
      }
      lines.push("</ul>");
    }
    lines.push("<hr />");
  }

  lines.push("<hr />");
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.mostCommonIssuesHeading)}</h3>`);
  lines.push("<ul>");
  for (const issue of content.commonIssues) {
    lines.push("<li>");
    lines.push(`<p>${escapeHtml(issue.issue)}</p>`);
    lines.push("<ul>");
    lines.push(
      `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherMoveLabel)}</strong> ${escapeHtml(issue.teacherMove)}</p></li>`
    );
    lines.push("</ul>");
    lines.push("</li>");
  }
  lines.push("</ul>");
  if (content.troubleshootingClose) {
    lines.push(`<p>${escapeHtml(content.troubleshootingClose)}</p>`);
  }

  return lines.join("\n");
}

function sanitizeTeacherNotesAgentOutput(
  content: TeacherNotesAgentOutput,
  evidence: TeacherNotesSourceEvidence
): TeacherNotesAgentOutput {
  const isLowValueAdminLine = (value: string): boolean =>
    /\b(link|class link|log ?in|login|open the correct|correct class|access the correct|find the .*class)\b/i.test(
      value
    );
  const keepSessionLine = (value: string): boolean =>
    hasContextKeywordOverlap(value, evidence.sessionKeywords) &&
    !isLowValueAdminLine(value) &&
    !isEditorialReviewMetaLine(value);
  const sanitizedTasks = content.tasks.map((task) => {
    const taskKeywords =
      evidence.taskKeywordsByTitle.get(normalizeLoose(task.title)) ?? evidence.sessionKeywords;

    return {
      ...task,
      outcome:
        task.outcome &&
        hasContextKeywordOverlap(task.outcome, taskKeywords) &&
        !isEditorialReviewMetaLine(task.outcome)
          ? task.outcome
          : undefined,
      reinforce: task.reinforce.filter(
        (value) =>
          hasContextKeywordOverlap(value, taskKeywords) &&
          !isLowValueAdminLine(value) &&
          !isEditorialReviewMetaLine(value)
      ),
      goldenNuggets: task.goldenNuggets.filter(
        (value) =>
          hasContextKeywordOverlap(value, taskKeywords) &&
          !isLowValueAdminLine(value) &&
          !isEditorialReviewMetaLine(value)
      ),
      beginner:
        task.beginner &&
        hasContextKeywordOverlap(task.beginner, taskKeywords) &&
        !isEditorialReviewMetaLine(task.beginner)
          ? task.beginner
          : undefined,
      extension:
        task.extension &&
        hasContextKeywordOverlap(task.extension, taskKeywords) &&
        !isEditorialReviewMetaLine(task.extension)
          ? task.extension
          : undefined
    };
  }).filter((task) =>
    !!task.outcome ||
    task.reinforce.length > 0 ||
    task.goldenNuggets.length > 0 ||
    !!task.beginner ||
    !!task.extension
  );

  const highlightAreas = content.highlightAreas.filter(keepSessionLine);
  const commonIssues = content.commonIssues.filter(
    (item) =>
      hasContextKeywordOverlap(item.issue, evidence.sessionKeywords) &&
      hasContextKeywordOverlap(item.teacherMove, evidence.sessionKeywords) &&
      !isEditorialReviewMetaLine(item.issue) &&
      !isEditorialReviewMetaLine(item.teacherMove)
  );
  const teacherFocus =
    content.teacherFocus &&
    hasContextKeywordOverlap(content.teacherFocus, evidence.sessionKeywords) &&
    !isEditorialReviewMetaLine(content.teacherFocus)
      ? content.teacherFocus
      : highlightAreas[0];
  const troubleshootingClose =
    content.troubleshootingClose &&
    hasContextKeywordOverlap(content.troubleshootingClose, evidence.sessionKeywords) &&
    !isEditorialReviewMetaLine(content.troubleshootingClose)
      ? content.troubleshootingClose
      : undefined;

  return {
    ...content,
    sessionObjective: normalizeStudentObjectives(content.sessionObjective).filter(keepSessionLine),
    teacherFocus,
    software: content.software.filter(keepSessionLine),
    hardware: content.hardware.filter(keepSessionLine),
    highlightAreas,
    tasks: sanitizedTasks,
    commonIssues,
    troubleshootingClose
  };
}

function normalizeStudentObjectives(values: string[]): string[] {
  return values.map((value) => normalizeStudentObjective(value)).filter(Boolean);
}

function normalizeStudentObjective(value: string): string {
  const cleaned = value.replace(SPACE_RE, " ").trim();
  if (!cleaned) return "";

  const lowered = cleaned.toLowerCase();
  const withPeriod = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;

  if (/^students?\s+(will|can|should)\b/i.test(cleaned)) {
    return withPeriod;
  }
  const guideMatch = cleaned.match(/^guide students?\s+(through|in|to)\s+(.+)$/i);
  if (guideMatch) {
    return `Students will ${toStudentOutcomePhrase(guideMatch[2])}`;
  }
  const supportMatch = cleaned.match(/^support students?\s+in\s+(.+)$/i);
  if (supportMatch) {
    return `Students will ${toStudentOutcomePhrase(supportMatch[1])}`;
  }
  if (/^ensure students?\s+/i.test(cleaned)) {
    return `Students will ${cleaned.replace(/^ensure students?\s+/i, "")}`.replace(/\.\.$/, ".");
  }
  const creativityMatch = cleaned.match(/^encourage creativity(?:\s+in\s+(.+))?$/i);
  if (creativityMatch) {
    const context = creativityMatch[1]
      ? ` in ${creativityMatch[1].replace(/[.!?]+$/, "")}`
      : "";
    return `Students will show creativity${context}.`;
  }
  if (/^encourage independent\b/i.test(cleaned)) {
    return `Students will work independently ${cleaned.replace(/^encourage independent/i, "")}`.replace(/\.\.$/, ".");
  }
  if (/^monitor\b/i.test(lowered)) {
    return "";
  }

  return withPeriod;
}

function toStudentOutcomePhrase(value: string): string {
  const cleaned = value.replace(/[.!?]+$/, "").trim();
  const lower = cleaned.toLowerCase();
  const gerundMap: Array<[RegExp, string]> = [
    [/^customizing\b/i, "customize"],
    [/^modelling\b/i, "model"],
    [/^modeling\b/i, "model"],
    [/^refining\b/i, "refine"],
    [/^testing\b/i, "test"],
    [/^debugging\b/i, "debug"],
    [/^measuring\b/i, "measure"],
    [/^building\b/i, "build"],
    [/^printing\b/i, "print"],
    [/^designing\b/i, "design"],
    [/^soldering\b/i, "solder"]
  ];

  for (const [pattern, replacement] of gerundMap) {
    if (pattern.test(cleaned)) {
      return `${cleaned.replace(pattern, replacement)}.`;
    }
  }

  if (/^[a-z]+ing\b/i.test(cleaned)) {
    return `${cleaned}.`;
  }
  if (/^(their|the|a|an)\b/i.test(lower)) {
    return `${cleaned}.`;
  }
  return `${cleaned}.`;
}

function buildTeacherNotesSourceEvidence(
  sessionName: string,
  pageTitle: string,
  modulePages: SessionPageContext[],
  tasks: SessionTask[]
): TeacherNotesSourceEvidence {
  const sessionKeywords = new Set(
    extractContextKeywords(
      [
        sessionName,
        pageTitle,
        ...modulePages.map((page) => page.title),
        ...modulePages.map((page) => page.bodyText)
      ],
      28
    )
  );
  const taskKeywordsByTitle = new Map<string, Set<string>>();
  for (const task of tasks) {
    taskKeywordsByTitle.set(
      normalizeLoose(task.title),
      new Set(
        extractContextKeywords(
          [
            task.title,
            ...task.pages.map((page) => page.title),
            ...task.pages.map((page) => page.bodyText)
          ],
          18
        )
      )
    );
  }
  return { sessionKeywords, taskKeywordsByTitle };
}

function isEditorialReviewMetaLine(value: string): boolean {
  const normalized = value
    .replace(/[“”"'`]/g, "")
    .replace(SPACE_RE, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return true;
  return (
    normalized.startsWith("<!--") ||
    normalized === "main session objective" ||
    normalized === "teacher focus" ||
    normalized === "components & software required" ||
    normalized === "software" ||
    normalized === "hardware" ||
    normalized === "teacher highlight areas" ||
    normalized === "task-by-task guidance" ||
    normalized === "task by task guidance" ||
    normalized === "most common issues" ||
    normalized === "anything else" ||
    normalized.includes("wording is not correct") ||
    normalized.includes("below it says") ||
    normalized.includes("doesn't make sense") ||
    normalized.includes("does not make sense") ||
    normalized.includes("need to be changed") ||
    normalized.includes("needs to be changed") ||
    normalized.includes("the first point is fine")
  );
}

function buildReviewCommonIssueHints(
  issues: string[]
): Array<{ issue: string; teacherMove: string }> {
  return issues.map((issue) => buildReviewCommonIssueHint(issue));
}

function buildReviewCommonIssueHint(issue: string): { issue: string; teacherMove: string } {
  const lowered = issue.toLowerCase();
  if (/\bwrong\b.*\bmeasure|\bmeasure/.test(lowered)) {
    return {
      issue: "Students size features by eye, so the model no longer fits the Zippy chassis cleanly.",
      teacherMove: "Stop the design and have students measure against the chassis or sketch before they continue modelling in Tinkercad."
    };
  }
  if (/\bconstraint|unprintable|print/.test(lowered)) {
    return {
      issue: "Students create model features that are hard to print or too fragile to work on Zippy.",
      teacherMove: "Ask students to justify wall thickness, overhangs, and support needs before they keep refining the Tinkercad model."
    };
  }
  if (/\bclearance|component|robot/.test(lowered)) {
    return {
      issue: "Students place model features where they clash with nearby robot components or usable chassis space.",
      teacherMove: "Make students point out the clearances around the chassis before approving the Tinkercad design direction."
    };
  }
  return {
    issue: `Students run into this design problem: ${issue.replace(SPACE_RE, " ").trim()}.`,
    teacherMove: "Turn this into a quick teacher checkpoint before students keep modelling in Tinkercad."
  };
}

function buildTaskReviewHints(reviewNotes: string | undefined): string[] {
  if (!reviewNotes) return [];
  const lowered = reviewNotes.toLowerCase();
  const hints: string[] = [];

  if (/\bhard|challeng/.test(lowered)) {
    hints.push("Frame this as challenge work so students know it is not a core requirement for everyone.");
  }
  if (/\bsimpler|simplified|same characteristics|essential characteristics/.test(lowered)) {
    hints.push("If students stall, steer them toward a simpler version that keeps the key characteristics of the idea.");
  }

  return hints;
}

function buildReviewHighlightFallbacks(hints: string[]): string[] {
  const fallbacks: string[] = [];
  for (const hint of hints) {
    const lowered = hint.toLowerCase();
    if (/\bname|initial|file/.test(lowered)) {
      fallbacks.push(
        "Make file naming explicit early so students can find the right Tinkercad version quickly during feedback and troubleshooting."
      );
    }
    if (/\bsketch|discuss|collabor|validate/.test(lowered)) {
      fallbacks.push(
        "Use a quick sketch-and-explain checkpoint before modelling so weak ideas are corrected before students sink time into them."
      );
    }
  }
  return dedupe(fallbacks).slice(0, 3);
}

function buildTaskReviewFallbackNuggets(reviewNotes: string | undefined): string[] {
  if (!reviewNotes) return [];
  const lowered = reviewNotes.toLowerCase();
  const nuggets: string[] = [];

  if (/\bhard|challeng/.test(lowered)) {
    nuggets.push(
      "Set expectations clearly: this is challenge work, not the core success criterion for every student."
    );
  }
  if (/\bsimpler|simplified|same characteristics|essential characteristics/.test(lowered)) {
    nuggets.push(
      "If students understand the idea but cannot model the full form, allow a simpler version that keeps the key characteristics."
    );
  }

  return dedupe(nuggets).slice(0, 2);
}

function classifyReviewTheme(value: string): string {
  const lowered = value.toLowerCase();
  if (/\bname|initial|file/.test(lowered)) return "naming";
  if (/\bsketch|discuss|collabor|validate/.test(lowered)) return "sketch";
  if (/\bmeasure|size|dimension/.test(lowered)) return "measurement";
  if (/\bconstraint|unprintable|print|fragile|wall thickness|overhang/.test(lowered)) {
    return "printability";
  }
  if (/\bclearance|component|robot|chassis space|fit\b/.test(lowered)) return "clearance";
  return lowered.replace(SPACE_RE, " ").trim();
}

function applyReviewGuidanceFallbacks(
  content: TeacherNotesAgentOutput,
  parsedReview: ParsedTeacherNotesReview
): TeacherNotesAgentOutput {
  const existingHighlightThemes = new Set(content.highlightAreas.map((item) => classifyReviewTheme(item)));
  const fallbackHighlights = buildReviewHighlightFallbacks(parsedReview.highlightAreaHints).filter(
    (item) => !existingHighlightThemes.has(classifyReviewTheme(item))
  );
  const highlightAreas = dedupe([
    ...content.highlightAreas,
    ...fallbackHighlights
  ]).slice(0, 5);

  const existingIssueThemes = new Set(content.commonIssues.map((item) => classifyReviewTheme(item.issue)));
  const fallbackIssues = buildReviewCommonIssueHints(parsedReview.reviewCommonIssues).filter(
    (item) => !existingIssueThemes.has(classifyReviewTheme(item.issue))
  );
  const commonIssues = dedupeIssues([
    ...content.commonIssues.map((item) => ({ issue: item.issue, solution: item.teacherMove })),
    ...fallbackIssues.map((item) => ({
      issue: item.issue,
      solution: item.teacherMove
    }))
  ]).map((item) => ({ issue: item.issue, teacherMove: item.solution })).slice(0, 6);

  const tasks = content.tasks.map((task) => {
    const reviewNote = parsedReview.taskNotesByTitle.get(normalizeTaskReference(task.title));
    const fallbackNuggets = buildTaskReviewFallbackNuggets(reviewNote);
    if (fallbackNuggets.length === 0) return task;
    return {
      ...task,
      goldenNuggets: dedupe([...task.goldenNuggets, ...fallbackNuggets]).slice(0, 3)
    };
  });

  return {
    ...content,
    highlightAreas,
    commonIssues,
    tasks
  };
}

function parseTeacherNotesReviewNotes(reviewNotes: string | undefined): ParsedTeacherNotesReview {
  const result: ParsedTeacherNotesReview = {
    objectiveHints: [],
    forceHardwareNA: false,
    highlightAreaHints: [],
    reviewCommonIssues: [],
    taskNotesByTitle: new Map<string, string>()
  };
  if (!reviewNotes) return result;

  const lines = reviewNotes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let activeSection: "objective" | "highlights" | "issues" | "task" | undefined;
  let activeTaskKey: string | undefined;

  for (const line of lines) {
    if (/horizontal rule/i.test(line)) {
      continue;
    }
    if (/\bhardware\b/i.test(line) && /\bn\/?a\b/i.test(line)) {
      result.forceHardwareNA = true;
    }
    if (/^main session objective$/i.test(line)) {
      activeSection = "objective";
      activeTaskKey = undefined;
      continue;
    }
    if (
      /^teacher focus$/i.test(line) ||
      /^components\s*&\s*software required$/i.test(line) ||
      /^software$/i.test(line) ||
      /^hardware$/i.test(line) ||
      /^anything else$/i.test(line)
    ) {
      activeSection = undefined;
      activeTaskKey = undefined;
      continue;
    }
    if (/teacher highlight areas/i.test(line)) {
      activeSection = "highlights";
      activeTaskKey = undefined;
      continue;
    }
    if (/most common issues/i.test(line)) {
      activeSection = "issues";
      activeTaskKey = undefined;
      continue;
    }

    const taskMatch = line.match(/^(Session\s+\d+.*Task\s+[A-Za-z0-9]+)/i);
    if (taskMatch) {
      activeSection = "task";
      activeTaskKey = normalizeTaskReference(taskMatch[1]);
      continue;
    }

    if (isEditorialReviewMetaLine(line)) {
      continue;
    }

    if (
      /^by the end of the session/i.test(line) ||
      /issue with/i.test(line) ||
      /task by task/i.test(line)
    ) {
      if (/^by the end of the session/i.test(line) && activeSection === "objective") {
        continue;
      }
      activeSection = undefined;
      activeTaskKey = undefined;
      continue;
    }

    if (activeSection === "objective") {
      if (/^students?\s+(will|can|should)\b/i.test(line)) {
        result.objectiveHints.push(line);
      }
      continue;
    }
    if (activeSection === "highlights") {
      result.highlightAreaHints.push(line);
      continue;
    }
    if (activeSection === "issues") {
      result.reviewCommonIssues.push(line);
      continue;
    }
    if (activeSection === "task" && activeTaskKey) {
      const previous = result.taskNotesByTitle.get(activeTaskKey);
      result.taskNotesByTitle.set(activeTaskKey, previous ? `${previous}\n${line}` : line);
    }
  }

  result.objectiveHints = dedupe(result.objectiveHints).slice(0, 3);
  result.highlightAreaHints = dedupe(result.highlightAreaHints).slice(0, 5);
  result.reviewCommonIssues = dedupe(result.reviewCommonIssues).slice(0, 6);
  return result;
}

function buildObjectivePoints(
  introPages: SessionPageContext[],
  tasks: SessionTask[],
  sessionName: string
): string[] {
  const points: string[] = [];
  const taskSequence = buildTaskSequenceObjective(tasks);
  if (taskSequence) {
    points.push(taskSequence);
  }

  const introSentence = firstSentence(introPages.map((p) => p.bodyText).join(" "));
  if (introSentence) {
    points.push(toOutcomeBullet(introSentence));
  }

  if (points.length < 3) {
    points.push(`Apply the core skills from ${sessionName} with increasing independence.`);
  }
  if (points.length < 3) {
    points.push("Troubleshoot one issue at a time before requesting direct help.");
  }

  return dedupe(points).slice(0, 3);
}

function buildTaskSummary(task: SessionTask): string {
  const sources = task.pages.map((page) => page.title).join(", ");
  return `Outcome for this task: complete the activities in ${sources}.`;
}

function buildTaskPoints(task: SessionTask): string[] {
  const points: string[] = [];
  for (const page of task.pages) {
    const sentence = firstSentence(page.bodyText);
    if (sentence) {
      points.push(toOutcomeBullet(sentence));
      continue;
    }
    points.push(`Complete "${page.title}" and verify it works before moving on.`);
  }
  return dedupe(points).slice(0, 3);
}

function buildCommonIssues(
  tasks: SessionTask[],
  fullText: string,
  issueHints: CommonIssue[],
  sessionName: string
): CommonIssue[] {
  const issues: CommonIssue[] = [];
  const lower = fullText.toLowerCase();
  const isSoldering = isSolderingContext(sessionName, fullText);

  if (/\bwiring\b/.test(lower)) {
    issues.push({
      issue: "Incorrect pin wiring between the board, LCD, and keypad.",
      solution: "Have students trace each wire against the diagram one connection at a time, then re-test after each correction."
    });
  }
  if (/\bupload\b|\bcompile\b/.test(lower)) {
    issues.push({
      issue: "Sketch upload errors caused by board/port configuration mistakes.",
      solution: "Check board model, selected port, cable quality, and close any app using the serial connection before retrying."
    });
  }
  if (/\bkeypad\b/.test(lower)) {
    issues.push({
      issue: "Incorrect row/column mapping in keypad code.",
      solution: "Compare keypad wiring to the row/column array in code and test each key in Serial Monitor to confirm mapping."
    });
  }
  if (/\blcd\b/.test(lower)) {
    issues.push({
      issue: "LCD output not displaying as expected.",
      solution: "Verify power and data pins, adjust LCD contrast, and run a minimal known-good test sketch first."
    });
  }

  if (isSoldering) {
    issues.push(...buildSolderingIssues());
  }

  issues.push(...issueHints);

  if (issues.length < 3 && tasks.length > 0) {
    issues.push({
      issue: "Students make multiple changes at once and lose track of the cause of errors.",
      solution: "Enforce one-change-at-a-time debugging and require a quick test after each change."
    });
  }
  if (issues.length < 4) {
    issues.push({
      issue: "Students forget to save a known-good version before experimenting.",
      solution: "Set mandatory checkpoint saves after each working milestone before extensions."
    });
  }

  const maxIssues = isSoldering ? 8 : 6;
  return dedupeIssues(issues).slice(0, maxIssues);
}

function buildAgentCommonIssues(
  tasks: SessionTask[],
  fullText: string,
  sessionName: string
): CommonIssue[] {
  const issues = buildCommonIssues(tasks, fullText, [], sessionName);
  const lower = fullText.toLowerCase();

  if (/\b(tinkercad|3d|model|modelling|design|print)\b/.test(lower)) {
    issues.push({
      issue: "Students create designs that look interesting but will not attach securely to Zippy.",
      solution: "Pause before printing and make students point to the exact contact surfaces, clearances, and fixing points on the model."
    });
    issues.push({
      issue: "Students scale parts by eye and end up with pieces that are too large, too thin, or unstable.",
      solution: "Have students measure against the reference model and check wall thickness, overhangs, and footprint before approving the print."
    });
    issues.push({
      issue: "Students keep decorating without a clear design purpose and lose time on weak ideas.",
      solution: "Ask what the change improves for Zippy: fit, function, or appearance. If they cannot answer, simplify the design."
    });
  }

  return dedupeIssues(issues).slice(0, 6);
}

function buildCourseInsights(
  sessionName: string,
  modulePages: SessionPageContext[],
  coursePages: CoursePageContext[]
): CourseInsight {
  const moduleText = modulePages.map((page) => page.bodyText).join("\n");
  const courseText = coursePages.map((page) => page.bodyText).join("\n");
  const combinedText = `${moduleText}\n${courseText}`;
  const isSoldering = isSolderingContext(sessionName, combinedText);

  const highlightAreas = COURSE_HIGHLIGHT_SIGNALS
    .filter((signal) => {
      const moduleMatch = signal.pattern.test(moduleText);
      const recurringCourseMatch = countModulesWithPattern(coursePages, signal.pattern) >= 2;
      return moduleMatch || recurringCourseMatch;
    })
    .map((signal) => signal.point);

  if (isSoldering) {
    highlightAreas.push(
      "Soldering quality control should be explicit: inspect every joint, check for bridges, and confirm continuity before power-on."
    );
  }
  if (highlightAreas.length < 3) {
    highlightAreas.push(
      "Use formative checkpoints after each task so misconceptions are corrected early instead of carrying into later tasks."
    );
  }
  if (highlightAreas.length < 3) {
    highlightAreas.push(
      "Ask students to explain why a fix worked, not just what they changed, to strengthen transferable troubleshooting habits."
    );
  }

  const issueHints: CommonIssue[] = [];
  if (countModulesWithPattern(coursePages, /\b(upload|compile|port|board)\b/i) >= 3) {
    issueHints.push({
      issue: "Board/port mismatch appears repeatedly across sessions.",
      solution: "Run a 30-second board-port-cable check at the start of practical work before opening debugging support."
    });
  }
  if (countModulesWithPattern(coursePages, /\b(wiring|pin|connection)\b/i) >= 3) {
    issueHints.push({
      issue: "Wiring mistakes recur across multiple sessions.",
      solution: "Require students to annotate each verified connection and get a peer check before upload."
    });
  }
  if (countModulesWithPattern(coursePages, /\b(save|checkpoint|version)\b/i) >= 2) {
    issueHints.push({
      issue: "Students lose working versions after experimentation.",
      solution: "Mandate named checkpoints after each passing milestone before extension changes."
    });
  }

  return {
    highlightAreas: dedupe(highlightAreas).slice(0, 5),
    issueHints: dedupeIssues(issueHints)
  };
}

function countModulesWithPattern(coursePages: CoursePageContext[], pattern: RegExp): number {
  const matchedModules = new Set<number>();
  for (const page of coursePages) {
    if (pattern.test(page.bodyText)) {
      matchedModules.add(page.moduleId);
    }
  }
  return matchedModules.size;
}

function isSolderingContext(sessionName: string, text: string): boolean {
  const context = `${sessionName} ${text}`.toLowerCase();
  return /\bsolder(?:ing)?\b|\bsoldering iron\b|\bflux\b|\bcold joint\b|\bdesolder(?:ing)?\b/.test(context);
}

function buildSolderingIssues(): CommonIssue[] {
  return [
    {
      issue: "Cold solder joints lead to intermittent or dead connections.",
      solution: "Reheat each dull or cracked joint until solder flows smoothly into a shiny cone."
    },
    {
      issue: "Solder bridges create short circuits between adjacent pads.",
      solution: "Inspect with magnification and remove bridges with solder wick before power is applied."
    },
    {
      issue: "Components are soldered in the wrong orientation (polarity errors).",
      solution: "Pause before soldering and verify orientation marks for LEDs, diodes, and electrolytic capacitors."
    },
    {
      issue: "Pads lift from the PCB due to overheating or repeated rework.",
      solution: "Limit heat time per pad, use flux, and give joints time to cool between attempts."
    },
    {
      issue: "Insulation melts and adjacent wires contact each other.",
      solution: "Trim and tin wires correctly, keep exposed conductor short, and route wires with strain relief."
    },
    {
      issue: "Students skip continuity checks and only discover faults at power-on.",
      solution: "Require continuity and short-to-ground checks with a multimeter before connecting power."
    },
    {
      issue: "Unsafe iron handling or fume exposure slows practical progress.",
      solution: "Reinforce iron stand usage, cable management, and ventilation checks before soldering starts."
    }
  ];
}

function resolveIntroPages(
  moduleItems: CanvasModuleItem[],
  modulePages: SessionPageContext[]
): SessionPageContext[] {
  const firstTask = moduleItems.find(
    (item) => item.type === "SubHeader" && TASK_HEADER_RE.test(item.title)
  );
  if (!firstTask) return modulePages.slice(0, 2);
  return modulePages.filter((page) => page.position < firstTask.position);
}

function resolveTasks(
  moduleItems: CanvasModuleItem[],
  modulePages: SessionPageContext[]
): SessionTask[] {
  const headers = moduleItems
    .filter((item) => item.type === "SubHeader" && TASK_HEADER_RE.test(item.title))
    .sort((a, b) => a.position - b.position);

  const tasks: SessionTask[] = [];
  for (let i = 0; i < headers.length; i += 1) {
    const current = headers[i];
    const next = headers[i + 1];
    const pages = modulePages.filter(
      (page) =>
        page.position > current.position &&
        (!next || page.position < next.position)
    );
    if (pages.length > 0) {
      tasks.push({ title: current.title, pages });
    }
  }
  return tasks;
}

function findTeacherNotesInsertionPosition(items: CanvasModuleItem[]): number {
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const teacherHeader = sorted.find(
    (item) =>
      item.type === "SubHeader" &&
      (normalizeLoose(item.title) === "teachers notes" || normalizeLoose(item.title) === "teacher notes")
  );
  if (teacherHeader) return teacherHeader.position + 1;
  return sorted.length === 0 ? 1 : sorted[0].position;
}

function detectComponents(
  text: string,
  patterns: Array<{ pattern: RegExp; label: string }>,
  fallback: string[]
): string[] {
  const found = patterns
    .filter((entry) => entry.pattern.test(text))
    .map((entry) => entry.label);

  if (found.length === 0) return fallback;
  return dedupe(found);
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

function normalizeLoose(input: string): string {
  return input.replace(SPACE_RE, " ").trim().toLowerCase();
}

function normalizeTaskReference(input: string): string {
  return input
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(SPACE_RE, " ")
    .trim()
    .toLowerCase();
}

function extractContextKeywords(parts: string[], max: number): string[] {
  const counts = new Map<string, number>();
  for (const part of parts) {
    const matches = part.toLowerCase().match(CONTEXT_TOKEN_RE) ?? [];
    for (const raw of matches) {
      const token = raw.toLowerCase();
      if (token.length < 4 && token !== "3d") continue;
      if (CONTEXT_STOP_WORDS.has(token)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([token]) => token);
}

function hasContextKeywordOverlap(value: string, keywords: Set<string>): boolean {
  const tokens = value.toLowerCase().match(CONTEXT_TOKEN_RE) ?? [];
  return tokens.some((token) => keywords.has(token.toLowerCase()));
}

function buildTaskSequenceObjective(tasks: SessionTask[]): string | undefined {
  if (tasks.length === 0) return undefined;

  const parsed = tasks
    .map((task) => parseTaskHeader(task.title))
    .filter((value): value is { sessionLabel: string; taskLabel: string } => !!value);

  if (parsed.length === tasks.length) {
    const sessionLabel = parsed[0].sessionLabel;
    const sameSession = parsed.every((item) => item.sessionLabel.toLowerCase() === sessionLabel.toLowerCase());
    if (sameSession) {
      const letters = parsed.map((item) => item.taskLabel).join("/");
      return `Complete ${sessionLabel}: Task ${letters}.`;
    }
  }

  return `Complete the session task sequence: ${tasks.map((task) => task.title).join(", ")}.`;
}

function buildTaskDifferentiation(task: SessionTask): { beginner: string; extension: string } {
  const context = `${task.title} ${task.pages.map((p) => p.title).join(" ")} ${task.pages.map((p) => p.bodyText).join(" ")}`.toLowerCase();
  const titleContext = `${task.title} ${task.pages.map((p) => p.title).join(" ")}`.toLowerCase();

  const hasCustomCharacter = matchesAny(context, [/\bcustom\b/i, /\bcharacter\b/i]);
  const hasKeypad = matchesAny(context, [/\bkeypad\b/i, /\b3x4\b/i, /\bmatrix\b/i]);
  const has3dDesign = matchesAny(context, [/\btinkercad\b/i, /\b3d\b/i, /\bmodel(?:ling)?\b/i, /\bdesign\b/i, /\bprint\b/i, /\bchassis\b/i]);
  const isTheory = matchesAny(titleContext, [/\bhow\s+.+\s+work/i, /\btheory\b/i, /\bconcept\b/i]);
  const hasWiringOrLcd = matchesAny(context, [/\bwiring\b/i, /\blcd\b/i]);

  if (hasCustomCharacter) {
    return {
      beginner:
        "Edit one provided custom character pattern (for example, change a smiley face) and display it correctly on the LCD.",
      extension:
        "Design two original custom characters and alternate them as a short animation or status indicator."
    };
  }

  if (hasKeypad) {
    return {
      beginner:
        "Read one key press in Serial Monitor and verify each key prints the correct value.",
      extension:
        "Build a 4-digit PIN check with a clear/reset key and a simple lockout after three incorrect attempts."
    };
  }

  if (has3dDesign) {
    return {
      beginner:
        "Make one clear design improvement to Zippy, then explain how it fits the available space before printing.",
      extension:
        "Add a second feature that improves either attachment, stability, or visual impact without making the model hard to print."
    };
  }

  if (isTheory) {
    return {
      beginner:
        "Label the key LCD or circuit pins used in class and explain one function for each pin.",
      extension:
        "Predict how changing one parameter (for example contrast or delay) will affect output, then test and record the result."
    };
  }

  if (hasWiringOrLcd) {
    return {
      beginner:
        "Follow the class wiring diagram exactly, then upload a fixed message such as HELLO to confirm the setup works.",
      extension:
        "Modify the sketch to rotate between two messages or show a simple counter updated every second."
    };
  }

  return {
    beginner:
      "Make one small tweak to the working example (text, delay, or one variable) and verify the result.",
    extension:
      "Add one extra feature of your choice and explain what changed in your code or wiring."
  };
}

function dedupeIssues(values: CommonIssue[]): CommonIssue[] {
  const seen = new Set<string>();
  const out: CommonIssue[] = [];
  for (const value of values) {
    const issue = value.issue.replace(SPACE_RE, " ").trim();
    const solution = value.solution.replace(SPACE_RE, " ").trim();
    if (!issue || !solution) continue;
    const key = issue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ issue, solution });
  }
  return out;
}

function firstSentence(text: string): string | undefined {
  const normalized = text.replace(SPACE_RE, " ").trim();
  if (!normalized) return undefined;
  const parts = normalized.split(/(?<=[.!?])\s+/);
  for (const raw of parts) {
    const sentence = cleanupSentence(raw);
    if (sentence.length >= 20) {
      return sentence.endsWith(".") || sentence.endsWith("!") || sentence.endsWith("?")
        ? sentence
        : `${sentence}.`;
    }
  }
  const fallback = cleanupSentence(normalized);
  return fallback.length ? `${fallback}.` : undefined;
}

function buildPageExcerpt(
  text: string,
  maxSentences = 2,
  maxChars = 320
): string | undefined {
  const normalized = text.replace(SPACE_RE, " ").trim();
  if (!normalized) return undefined;

  const sentences = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => cleanupSentence(sentence))
    .filter((sentence) => sentence.length >= 20);

  if (sentences.length === 0) {
    return truncateText(cleanupSentence(normalized), maxChars);
  }

  return truncateText(sentences.slice(0, maxSentences).join(" "), maxChars);
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
    const key = String(entity).toLowerCase();
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanupSentence(input: string): string {
  return input
    .replace(/^hi all[,!\s]*/i, "")
    .replace(/^(the task|task|keypad circuit)\s*[:\-]?\s*/i, "")
    .replace(SPACE_RE, " ")
    .trim();
}

function truncateText(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function toOutcomeBullet(input: string): string {
  const cleaned = cleanupSentence(input)
    .replace(/^students should be able to\s*/i, "")
    .replace(/^students should\s*/i, "")
    .replace(/^students (will|can)\s*/i, "")
    .replace(/^in this (task|session),?\s*(you|students)\s*(will|should)\s*/i, "")
    .replace(/^you (will|should)\s*/i, "")
    .replace(/^in this (task|session),?\s*/i, "")
    .replace(/^this (task|session)\s+(is|covers)\s*/i, "")
    .replace(/^now,?\s*/i, "")
    .replace(/\byour\b/gi, "their")
    .replace(/\ba lcd\b/i, "an LCD")
    .replace(SPACE_RE, " ")
    .trim();

  if (!cleaned) return "Complete the activity and explain how it works.";
  const normalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  const finalSentence = normalized.endsWith(".") || normalized.endsWith("!") || normalized.endsWith("?")
    ? normalized.slice(0, -1)
    : normalized;
  return `${finalSentence}.`;
}

function parseTaskHeader(input: string): { sessionLabel: string; taskLabel: string } | undefined {
  const match = input.trim().match(/^(Session\s+\d+\s*):\s*Task\s+([A-Za-z0-9]+)/i);
  if (!match) return undefined;
  return {
    sessionLabel: match[1].replace(SPACE_RE, " ").trim(),
    taskLabel: match[2].toUpperCase()
  };
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}
