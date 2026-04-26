import {
  CanvasClient,
  CanvasModuleItem,
  CanvasModuleSummary
} from "../canvas/canvasClient.js";
import {
  generateTeacherNotesFromAgent,
  TeacherNotesAgentInput,
  TeacherNotesAgentTaskInput,
  TeacherNotesAgentOutput
} from "../agent/teacherNotes/teacherNotesAgentClient.js";
import { resolveModuleByName } from "./sessionHeaders.js";
import {
  detectTeacherNotesDomains,
  hasTeacherNotesObjectivePrefix,
  sanitizeTeacherNotesSourceText,
  TEACHER_NOTES_CONTRACT,
  type TeacherNotesDomainKey,
  validateTeacherNotesContent
} from "./teacherNotesContract.js";
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

type SessionQuizEvidence = {
  title?: string;
  questionStems: string[];
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

const SOFTWARE_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\barduino ide\b/i, label: "Arduino IDE" },
  { pattern: /\bserial monitor\b/i, label: "Serial Monitor" },
  { pattern: /\bblender\b/i, label: "Blender" },
  { pattern: /\btinkercad\b/i, label: "Tinkercad" },
  { pattern: /\bmobile app\b|\bweb application\b|\bweb app\b/i, label: "Mobile web app" },
  { pattern: /\bweb browser\b/i, label: "Web browser (Chrome preferred)" }
];

const HARDWARE_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bzippy\b/i, label: "Nexgen Zippy robot" },
  { pattern: /\blcd\b/i, label: "LCD screen module" },
  { pattern: /\b3x4\b|\bmatrix keypad\b|\bkeypad\b/i, label: "3x4 matrix keypad" },
  { pattern: /\besp32\b|\bnodemcu\b/i, label: "NodeMCU ESP32 board" },
  { pattern: /\besp32-?cam\b|\bcamera\b|\bvideo streaming\b/i, label: "ESP32-CAM / camera module" },
  { pattern: /\bservo\b/i, label: "Servo motor" },
  { pattern: /\bmotor driver\b/i, label: "Motor driver module" },
  { pattern: /\btt motors?\b|\bmotors?\b/i, label: "Drive motors" },
  { pattern: /\bbatter(?:y|ies)\b|\bbattery pack\b/i, label: "Battery pack / batteries" },
  { pattern: /\bbreadboard\b/i, label: "Breadboard" },
  { pattern: /\bjumper wire/i, label: "Jumper wires" },
  { pattern: /\busb\b/i, label: "USB cable" },
  { pattern: /\bswitch\b/i, label: "Switch" },
  { pattern: /\bdc connector\b|\bpower connector\b/i, label: "DC power connector" },
  { pattern: /\bmobile phone\b|\bphone\b/i, label: "Mobile phone" },
  { pattern: /\bsolder(?:ing)?\b|\bsoldering iron\b/i, label: "Soldering iron" },
  { pattern: /\bflux\b/i, label: "Flux / solder paste" },
  { pattern: /\bmultimeter\b|\bcontinuity\b/i, label: "Multimeter (continuity mode)" },
  { pattern: /\bdesolder(?:ing)?\b|\bsolder wick\b/i, label: "Desoldering braid / solder wick" }
];

const HEURISTIC_TEACHER_FOCUS_FALLBACK =
  "Watch for whether students can explain why their next change should work before they continue building.";

export async function buildTeacherNotesForSession(
  client: CanvasClient,
  courseId: number,
  sessionName: string,
  pageTitle: string
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
  const quizEvidence = await collectModuleQuizEvidence(client, courseId, sortedItems);
  const tasks = resolveTasks(sortedItems, modulePages);
  const introPages = resolveIntroPages(sortedItems, modulePages);
  const evidenceText = buildTeacherNotesEvidenceText(modulePages, quizEvidence);
  const detectedDomains = resolveTeacherNotesDomains(
    sessionName,
    pageTitle,
    introPages,
    tasks,
    quizEvidence
  );
  const taskContexts = buildTeacherNotesTaskContexts(
    tasks,
    sessionName,
    quizEvidence,
    detectedDomains
  );
  const courseInsight = buildCourseInsights(sessionName, evidenceText, detectedDomains);
  const sourceEvidence = buildTeacherNotesSourceEvidence(
    sessionName,
    pageTitle,
    modulePages,
    taskContexts,
    quizEvidence
  );

  let notesHtml: string;
  let generationMode: "agent" | "heuristic" = "heuristic";
  let generationWarning: string | undefined;

  try {
    const agentInput = buildTeacherNotesAgentInput(
      pageTitle,
      sessionName,
      sortedItems,
      modulePages,
      courseInsight,
      detectedDomains,
      quizEvidence,
      taskContexts
    );
    const agentOutput = sanitizeTeacherNotesAgentOutput(
      await generateTeacherNotesFromAgent(agentInput),
      sourceEvidence,
      detectedDomains
    );
    const completedAgentOutput = applyContractFallbacks(
      agentOutput,
      courseInsight,
      introPages,
      taskContexts,
      sessionName,
      evidenceText,
      detectedDomains,
      quizEvidence
    );
    const validation = validateTeacherNotesContent(completedAgentOutput, { detectedDomains });
    if (validation.errors.length > 0) {
      throw new Error(`Teacher Notes contract validation failed: ${validation.errors.join(" | ")}`);
    }
    notesHtml = renderTeacherNotesHtmlFromAgent(pageTitle, completedAgentOutput);
    generationMode = "agent";
  } catch (err) {
    generationWarning = err instanceof Error ? err.message : String(err);
    notesHtml = renderTeacherNotesHtml(
      pageTitle,
      sessionName,
      sortedItems,
      modulePages,
      courseInsight,
      detectedDomains
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
  courseInsight: CourseInsight,
  detectedDomains: TeacherNotesDomainKey[],
  quizEvidence: SessionQuizEvidence,
  taskContexts: TeacherNotesAgentTaskInput[]
): TeacherNotesAgentInput {
  const introPages = resolveIntroPages(moduleItems, modulePages);
  const tasks = resolveTasks(moduleItems, modulePages);
  const fullText = buildTeacherNotesEvidenceText(modulePages, quizEvidence);
  const contextKeywords = extractContextKeywords(
    buildTeacherNotesEvidenceParts(sessionName, pageTitle, modulePages, quizEvidence),
    24
  );

  return {
    sessionName,
    pageTitle,
    sessionOverview:
      buildPageExcerpt(introPages.map((page) => page.bodyText).join(" "), 3, 420) ??
      buildPageExcerpt(fullText, 3, 420),
    modulePageTitles: modulePages.map((page) => page.title),
    contextKeywords,
    detectedDomains,
    objectiveHints: normalizeStudentObjectives(
      buildObjectivePoints(introPages, tasks, sessionName, detectedDomains, fullText)
    ),
    softwareHints: detectComponents(fullText, SOFTWARE_KEYWORDS, []),
    hardwareHints: detectComponents(fullText, HARDWARE_KEYWORDS, []),
    highlightAreaHints: courseInsight.highlightAreas,
    commonIssueHints: buildAgentCommonIssues(tasks, fullText, sessionName, detectedDomains).map((issue) => ({
      issue: issue.issue,
      teacherMove: issue.solution
    })),
    taskContexts
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

async function collectModuleQuizEvidence(
  client: CanvasClient,
  courseId: number,
  moduleItems: CanvasModuleItem[]
): Promise<SessionQuizEvidence> {
  const primaryQuiz = moduleItems.find(
    (item) =>
      item.type === "Quiz" &&
      !!item.content_id &&
      !/weekly[-\s]*check-?in/i.test(item.title)
  );
  if (!primaryQuiz?.content_id) {
    return { questionStems: [] };
  }

  try {
    const questions = await client.listQuizQuestions(courseId, Number(primaryQuiz.content_id));
    return {
      title: primaryQuiz.title,
      questionStems: dedupe(
        questions
          .map((question) =>
            sanitizeTeacherNotesSourceText(
              toPlainText(String(question.question_text ?? question.question_name ?? ""))
            )
          )
          .filter(Boolean)
      )
    };
  } catch {
    return {
      title: primaryQuiz.title,
      questionStems: []
    };
  }
}

function buildTeacherNotesEvidenceParts(
  sessionName: string,
  pageTitle: string,
  modulePages: SessionPageContext[],
  quizEvidence: SessionQuizEvidence
): string[] {
  return [
    sessionName,
    pageTitle,
    ...modulePages.map((page) => page.title),
    ...modulePages.map((page) => page.bodyText),
    quizEvidence.title ?? "",
    ...quizEvidence.questionStems
  ].filter(Boolean);
}

function buildTeacherNotesEvidenceText(
  modulePages: SessionPageContext[],
  quizEvidence: SessionQuizEvidence
): string {
  return [
    ...modulePages.map((page) => page.bodyText),
    quizEvidence.title ?? "",
    ...quizEvidence.questionStems
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveTeacherNotesDomains(
  sessionName: string,
  pageTitle: string,
  introPages: SessionPageContext[],
  tasks: SessionTask[],
  quizEvidence: SessionQuizEvidence
): TeacherNotesDomainKey[] {
  const active = new Set<TeacherNotesDomainKey>();

  const titleDomains = detectTeacherNotesDomainsFromTitles([
    sessionName,
    pageTitle,
    quizEvidence.title ?? "",
    ...introPages.map((page) => page.title),
    ...tasks.flatMap((task) => [task.title, ...task.pages.map((page) => page.title)])
  ]);
  for (const domain of titleDomains) {
    active.add(domain);
  }

  const introAndQuizDomains = detectTeacherNotesDomains([
    sessionName,
    pageTitle,
    quizEvidence.title ?? "",
    ...introPages.map((page) => page.title),
    ...introPages.map((page) => page.bodyText),
    ...quizEvidence.questionStems
  ]);
  for (const domain of introAndQuizDomains) {
    active.add(domain);
  }

  for (const task of tasks) {
    const taskTitleDomains = new Set(
      detectTeacherNotesDomainsFromTitles([task.title, ...task.pages.map((page) => page.title)])
    );
    const taskBodyDomains = new Set(
      detectTeacherNotesDomains([
        task.title,
        ...task.pages.map((page) => page.title),
        ...task.pages.map((page) => page.bodyText)
      ])
    );

    if (taskTitleDomains.size === 0) {
      for (const domain of taskBodyDomains) {
        active.add(domain);
      }
      continue;
    }

    if (
      taskTitleDomains.has("software_setup") &&
      taskBodyDomains.has("coding_debugging")
    ) {
      active.add("coding_debugging");
    }
    if (
      taskTitleDomains.has("coding_debugging") &&
      taskBodyDomains.has("wiring_electronics")
    ) {
      active.add("wiring_electronics");
    }
    if (
      taskTitleDomains.has("wiring_electronics") &&
      taskBodyDomains.has("coding_debugging")
    ) {
      active.add("coding_debugging");
    }
  }

  return [...active];
}

function detectTeacherNotesDomainsFromTitles(parts: string[]): TeacherNotesDomainKey[] {
  const titles = parts
    .map((part) => sanitizeTeacherNotesSourceText(part))
    .filter(Boolean);

  return (Object.entries(TEACHER_NOTES_CONTRACT.domains) as Array<
    [TeacherNotesDomainKey, (typeof TEACHER_NOTES_CONTRACT.domains)[TeacherNotesDomainKey]]
  >)
    .filter(([, domain]) =>
      titles.some((title) => domain.detectionPatterns.some((pattern) => pattern.test(title)))
    )
    .map(([domainKey]) => domainKey);
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
    bodyText: sanitizeTeacherNotesSourceText(toPlainText(page.body ?? ""))
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
  courseInsight: CourseInsight,
  detectedDomains: TeacherNotesDomainKey[]
): string {
  const introPages = resolveIntroPages(moduleItems, modulePages);
  const tasks = resolveTasks(moduleItems, modulePages);
  const fullText = modulePages.map((p) => p.bodyText).join("\n");

  const objectivePoints = buildObjectivePoints(
    introPages,
    tasks,
    sessionName,
    detectedDomains,
    fullText
  );
  const software = detectComponents(fullText, SOFTWARE_KEYWORDS, ["Arduino IDE", "Serial Monitor"]);
  const hardware = detectComponents(fullText, HARDWARE_KEYWORDS, [
    "LCD screen module",
    "3x4 matrix keypad",
    "NodeMCU ESP32 board"
  ]);
  const highlightAreas = courseInsight.highlightAreas;
  const commonIssues = buildCommonIssues(
    tasks,
    fullText,
    courseInsight.issueHints,
    sessionName,
    detectedDomains
  );

  const lines: string[] = [];
  lines.push(`<h2>${escapeHtml(pageTitle)}</h2>`);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.mainSessionObjectiveHeading)}</h3>`);
  lines.push("<ul>");
  for (const point of normalizeStudentObjectives(objectivePoints)) {
    lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
  }
  lines.push("</ul>");
  lines.push(
    `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherFocusLabel)}</strong> ${escapeHtml(
      buildTeacherFocusFallback(courseInsight.highlightAreas)
    )}</p>`
  );
  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.componentsAndSoftwareHeading)}</h3>`);
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.softwareLabel)}</strong></p>`);
  lines.push("<ul>");
  for (const item of software) {
    lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
  }
  lines.push("</ul>");
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.hardwareLabel)}</strong></p>`);
  lines.push("<ul>");
  for (const item of (hardware.length > 0 ? hardware : ["N/A"])) {
    lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
  }
  lines.push("</ul>");

  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherHighlightAreasHeading)}</h3>`);
  lines.push("<ul>");
  for (const highlight of highlightAreas) {
    lines.push(`<li><p>${escapeHtml(highlight)}</p></li>`);
  }
  lines.push("</ul>");

  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.taskGuidanceHeading)}</h3>`);
  if (tasks.length === 0) {
    lines.push("<p>No usable task guidance was found in the current session pages. Update the Task A/B/C page content to expand this section automatically.</p>");
  }
  tasks.forEach((task, index) => {
    lines.push(`<h4>${escapeHtml(task.title)}</h4>`);
    lines.push(
      `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.outcomeLabel)}</strong> ${escapeHtml(
        buildTaskSummary(task)
      )}</p>`
    );

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
    if (differentiation) {
      lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.differentiationLabel)}</strong></p>`);
      lines.push("<ul>");
      if (differentiation.beginner) {
        lines.push(
          `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.beginnersLabel)}</strong> ${escapeHtml(differentiation.beginner)}</p></li>`
        );
      }
      if (differentiation.extension) {
        lines.push(
          `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.extensionLabel)}</strong> ${escapeHtml(differentiation.extension)}</p></li>`
        );
      }
      lines.push("</ul>");
    }
    if (index < tasks.length - 1) {
      pushSectionDivider(lines);
    }
  });

  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.mostCommonIssuesHeading)}</h3>`);
  lines.push("<ul>");
  for (const issue of commonIssues) {
    lines.push("<li>");
    lines.push(
      `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.issueLabel)}</strong> ${escapeHtml(
        issue.issue
      )}</p>`
    );
    lines.push("<ul>");
    lines.push(
      `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherMoveLabel)}</strong> ${escapeHtml(
        issue.solution
      )}</p></li>`
    );
    lines.push("</ul>");
    lines.push("</li>");
  }
  lines.push("</ul>");

  return lines.join("\n");
}

function renderTeacherNotesHtmlFromAgent(
  pageTitle: string,
  content: TeacherNotesAgentOutput
): string {
  const lines: string[] = [];
  lines.push(`<h2>${escapeHtml(pageTitle)}</h2>`);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.mainSessionObjectiveHeading)}</h3>`);
  lines.push("<ul>");
  for (const point of normalizeStudentObjectives(content.sessionObjective)) {
    lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
  }
  lines.push("</ul>");
  if (content.teacherFocus) {
    lines.push(
      `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherFocusLabel)}</strong> ${escapeHtml(content.teacherFocus)}</p>`
    );
  }

  pushSectionDivider(lines);
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

  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherHighlightAreasHeading)}</h3>`);
  lines.push("<ul>");
  for (const highlight of content.highlightAreas) {
    lines.push(`<li><p>${escapeHtml(highlight)}</p></li>`);
  }
  lines.push("</ul>");

  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.taskGuidanceHeading)}</h3>`);
  if (content.tasks.length === 0) {
    lines.push("<p>No usable task guidance was found in the current session pages. Update the Task A/B/C page content to expand this section automatically.</p>");
  }
  content.tasks.forEach((task, index) => {
    lines.push(`<h4>${escapeHtml(task.title)}</h4>`);
    if (task.outcome) {
      lines.push(
        `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.outcomeLabel)}</strong> ${escapeHtml(
          task.outcome
        )}</p>`
      );
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
    if (index < content.tasks.length - 1) {
      pushSectionDivider(lines);
    }
  });

  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.mostCommonIssuesHeading)}</h3>`);
  lines.push("<ul>");
  for (const issue of content.commonIssues) {
    lines.push("<li>");
    lines.push(
      `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.issueLabel)}</strong> ${escapeHtml(
        issue.issue
      )}</p>`
    );
    lines.push("<ul>");
    lines.push(
      `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherMoveLabel)}</strong> ${escapeHtml(issue.teacherMove)}</p></li>`
    );
    lines.push("</ul>");
    lines.push("</li>");
  }
  lines.push("</ul>");

  return lines.join("\n");
}

function pushSectionDivider(lines: string[]): void {
  if (TEACHER_NOTES_CONTRACT.structure.useHrBetweenSections) {
    lines.push("<hr />");
  }
}

function buildTeacherFocusFallback(highlightAreas: string[]): string {
  return highlightAreas[0] ?? HEURISTIC_TEACHER_FOCUS_FALLBACK;
}

function applyContractFallbacks(
  content: TeacherNotesAgentOutput,
  courseInsight: CourseInsight,
  introPages: SessionPageContext[],
  taskContexts: TeacherNotesAgentTaskInput[],
  sessionName: string,
  evidenceText: string,
  detectedDomains: TeacherNotesDomainKey[],
  quizEvidence: SessionQuizEvidence
): TeacherNotesAgentOutput {
  const fallbackTasks = buildFallbackTaskOutputs(taskContexts);
  const fallbackObjectives = normalizeStudentObjectives(
    buildObjectivePoints(introPages, [], sessionName, detectedDomains, evidenceText)
  );
  const fallbackIssues = buildAgentCommonIssues([], evidenceText, sessionName, detectedDomains).map((issue) => ({
    issue: issue.issue,
    teacherMove: issue.solution
  }));

  return {
    ...content,
    sessionObjective: dedupe([
      ...content.sessionObjective,
      ...fallbackObjectives
    ]).slice(0, TEACHER_NOTES_CONTRACT.mainSessionObjective.maxEntries),
    teacherFocus: content.teacherFocus ?? buildTeacherFocusFallback(courseInsight.highlightAreas),
    highlightAreas: dedupe([
      ...content.highlightAreas,
      ...courseInsight.highlightAreas
    ]).slice(0, TEACHER_NOTES_CONTRACT.teacherHighlightAreas.maxEntries),
    tasks: mergeFallbackTasks(content.tasks, fallbackTasks),
    commonIssues: dedupeTeacherMoves([
      ...content.commonIssues,
      ...fallbackIssues
    ]).slice(0, TEACHER_NOTES_CONTRACT.mostCommonIssues.maxEntries)
  };
}

function sanitizeTeacherNotesAgentOutput(
  content: TeacherNotesAgentOutput,
  evidence: TeacherNotesSourceEvidence,
  detectedDomains: TeacherNotesDomainKey[]
): TeacherNotesAgentOutput {
  const isLowValueAdminLine = (value: string): boolean =>
    /\b(link|class link|joinclass|log ?in|login|open the correct|correct class|access the correct|find the .*class)\b|https?:\/\//i.test(
      value
    );
  const keepDomainSafeLine = (value: string): boolean =>
    !hasInactiveDomainLeakage(value, detectedDomains);
  const keepSessionLine = (value: string): boolean =>
    hasContextKeywordOverlap(value, evidence.sessionKeywords) &&
    !isLowValueAdminLine(value) &&
    !isEditorialReviewMetaLine(value) &&
    keepDomainSafeLine(value);
  const sanitizedTasks = content.tasks.map((task) => {
    const taskKeywords =
      evidence.taskKeywordsByTitle.get(normalizeLoose(task.title)) ?? evidence.sessionKeywords;

    return {
      ...task,
      outcome:
        task.outcome &&
        hasContextKeywordOverlap(task.outcome, taskKeywords) &&
        !isEditorialReviewMetaLine(task.outcome) &&
        keepDomainSafeLine(task.outcome)
          ? task.outcome
          : undefined,
      reinforce: task.reinforce.filter(
        (value) =>
          hasContextKeywordOverlap(value, taskKeywords) &&
          !isLowValueAdminLine(value) &&
          !isEditorialReviewMetaLine(value) &&
          keepDomainSafeLine(value)
      ),
      goldenNuggets: task.goldenNuggets.filter(
        (value) =>
          hasContextKeywordOverlap(value, taskKeywords) &&
          !isLowValueAdminLine(value) &&
          !isEditorialReviewMetaLine(value) &&
          keepDomainSafeLine(value)
      ),
      beginner:
        task.beginner &&
        hasContextKeywordOverlap(task.beginner, taskKeywords) &&
        !isEditorialReviewMetaLine(task.beginner) &&
        keepDomainSafeLine(task.beginner)
          ? task.beginner
          : undefined,
      extension:
        task.extension &&
        hasContextKeywordOverlap(task.extension, taskKeywords) &&
        !isEditorialReviewMetaLine(task.extension) &&
        keepDomainSafeLine(task.extension)
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
      !isEditorialReviewMetaLine(item.teacherMove) &&
      keepDomainSafeLine(item.issue) &&
      keepDomainSafeLine(item.teacherMove)
  );
  const teacherFocus =
    content.teacherFocus &&
    hasContextKeywordOverlap(content.teacherFocus, evidence.sessionKeywords) &&
    !isEditorialReviewMetaLine(content.teacherFocus) &&
    keepDomainSafeLine(content.teacherFocus)
      ? content.teacherFocus
      : buildTeacherFocusFallback(highlightAreas);

  return {
    ...content,
    sessionObjective: normalizeStudentObjectives(content.sessionObjective)
      .filter(
        (value) => !isLowValueAdminLine(value) && !isEditorialReviewMetaLine(value)
      )
      .filter((value) => !isPromotionalObjectiveSentence(value))
      .filter(keepDomainSafeLine)
      .filter(hasTeacherNotesObjectivePrefix),
    teacherFocus,
    software: content.software.filter(keepSessionLine),
    hardware: content.hardware.filter(keepSessionLine),
    highlightAreas,
    tasks: sanitizedTasks,
    commonIssues: commonIssues.slice(
      0,
      TEACHER_NOTES_CONTRACT.mostCommonIssues.maxEntries
    )
  };
}

function hasInactiveDomainLeakage(
  value: string,
  detectedDomains: TeacherNotesDomainKey[]
): boolean {
  if (detectedDomains.length === 0) return false;

  const active = new Set(detectedDomains);
  return (Object.entries(TEACHER_NOTES_CONTRACT.domains) as Array<
    [TeacherNotesDomainKey, (typeof TEACHER_NOTES_CONTRACT.domains)[TeacherNotesDomainKey]]
  >).some(
    ([domainKey, domain]) =>
      !active.has(domainKey) &&
      domain.leakageSignals.some((pattern) => pattern.test(value))
  );
}

function normalizeStudentObjectives(values: string[]): string[] {
  return values.map((value) => normalizeStudentObjective(value)).filter(Boolean);
}

function normalizeStudentObjective(value: string): string {
  const cleaned = value.replace(SPACE_RE, " ").trim();
  if (!cleaned) return "";

  const lowered = cleaned.toLowerCase();
  const withPeriod = /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;

  if (/^students?\s+(will|can)\b/i.test(cleaned)) {
    return withPeriod;
  }
  if (/^students?\s+should\b/i.test(cleaned)) {
    return withPeriod.replace(/^students?\s+should\b/i, "Students will");
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

  const phrase = withPeriod.replace(/[.!?]+$/, "").trim();
  if (!phrase) return "";
  return `Students will ${phrase.charAt(0).toLowerCase()}${phrase.slice(1)}.`;
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
  taskContexts: TeacherNotesAgentTaskInput[],
  quizEvidence: SessionQuizEvidence
): TeacherNotesSourceEvidence {
  const sessionKeywords = new Set(
    extractContextKeywords(
      buildTeacherNotesEvidenceParts(sessionName, pageTitle, modulePages, quizEvidence),
      28
    )
  );
  const taskKeywordsByTitle = new Map<string, Set<string>>();
  for (const task of taskContexts) {
    taskKeywordsByTitle.set(
      normalizeLoose(task.title),
      new Set(
        extractContextKeywords(
          [
            task.title,
            ...(task.pageTitles ?? []),
            task.outcomeHint ?? "",
            ...(task.pageSummaries ?? []),
            ...(task.reinforceHints ?? []),
            task.beginnerHint ?? "",
            task.extensionHint ?? ""
          ],
          18
        )
      )
    );
  }
  return { sessionKeywords, taskKeywordsByTitle };
}

function hasUsableTaskContent(task: SessionTask): boolean {
  return task.pages.some((page) => page.bodyText.trim().length > 0);
}

function buildTeacherNotesTaskContexts(
  tasks: SessionTask[],
  sessionName: string,
  quizEvidence: SessionQuizEvidence,
  detectedDomains: TeacherNotesDomainKey[]
): TeacherNotesAgentTaskInput[] {
  const usableTasks = tasks.filter(hasUsableTaskContent);
  if (usableTasks.length > 0) {
    return usableTasks.map((task) => buildTeacherNotesTaskContext(task));
  }
  return buildSyntheticTaskContexts(
    tasks.map((task) => task.title),
    sessionName,
    quizEvidence,
    detectedDomains
  );
}

function buildTeacherNotesTaskContext(task: SessionTask): TeacherNotesAgentTaskInput {
  const differentiation = buildTaskDifferentiation(task);
  return {
    title: task.title,
    pageTitles: task.pages.map((page) => page.title),
    outcomeHint: buildTaskSummary(task),
    pageSummaries: task.pages
      .map((page) => buildPageExcerpt(page.bodyText))
      .filter((summary): summary is string => Boolean(summary)),
    reinforceHints: buildTaskPoints(task),
    beginnerHint: differentiation?.beginner,
    extensionHint: differentiation?.extension
  };
}

function buildSyntheticTaskContexts(
  taskTitles: string[],
  sessionName: string,
  quizEvidence: SessionQuizEvidence,
  detectedDomains: TeacherNotesDomainKey[]
): TeacherNotesAgentTaskInput[] {
  const questionText = [quizEvidence.title ?? "", ...quizEvidence.questionStems].join(" ").toLowerCase();
  const has = (pattern: RegExp): boolean => pattern.test(questionText);
  const titles =
    taskTitles.length > 0 ? taskTitles : buildDefaultTaskTitles(sessionName, 3);

  let templates: Array<Omit<TeacherNotesAgentTaskInput, "title">>;

  if (detectedDomains.includes("cad_3d")) {
    templates = [
      {
        pageTitles: quizEvidence.title ? [quizEvidence.title] : [],
        outcomeHint: "Use Tinkercad tools accurately before starting the main customisation.",
        reinforceHints: dedupe([
          "Check that students can navigate the Tinkercad workspace without hunting for basic tools.",
          has(/\bbasic shape\b|\bshape\b/)
            ? "Push students to start from a small number of deliberate basic shapes before adding detail."
            : "",
          has(/\bgroup\b/)
            ? "Make students line shapes up precisely before grouping and explain what grouping changes in the model."
            : "",
          "Treat keyboard shortcuts, snap grid, and precise placement as accuracy tools, not optional extras."
        ]).slice(0, 4)
      },
      {
        pageTitles: quizEvidence.title ? [quizEvidence.title] : [],
        outcomeHint: "Create a Zippy customisation with a clear design purpose and workable fit.",
        reinforceHints: dedupe([
          has(/\bextrude\b/)
            ? "Ask students to explain what their extrusion or cut is doing to the model before approving it."
            : "",
          "Check fit, clearance, and connection points before students commit to decorative detail.",
          "Stop decorative drift by asking what the change improves: fit, function, or appearance.",
          has(/\bgroup\b/)
            ? "Watch for grouped shapes that hide imprecise placement or make later edits harder."
            : ""
        ]).slice(0, 4),
        beginnerHint:
          "Keep the change to one clean, well-positioned custom feature that still fits the existing body cleanly.",
        extensionHint:
          "Add a second feature only if it improves function or visual impact without making the design harder to print."
      },
      {
        pageTitles: quizEvidence.title ? [quizEvidence.title] : [],
        outcomeHint: "Check print readiness and save a clean version of the design for later build work.",
        reinforceHints: dedupe([
          has(/\bfile format\b|\bstl\b|\b3d print/i)
            ? "Check that students know which export or file format is appropriate before they claim the design is finished."
            : "",
          "Require one final fit and printability check before students move on.",
          "Make students save a clearly named version once the model is ready for review or printing."
        ]).slice(0, 4)
      }
    ];
  } else if (detectedDomains.includes("demo_orientation")) {
    templates = [
      {
        pageTitles: quizEvidence.title ? [quizEvidence.title] : [],
        outcomeHint: "Identify the standout features and subsystems that make the Zippy demo work.",
        reinforceHints: dedupe([
          has(/\bbattery\b/)
            ? "Ask students to identify the battery or power source and explain what it enables on Zippy."
            : "",
          has(/\bvideo streaming\b|\bcamera\b/)
            ? "Have students point out the camera or video-streaming feature and explain what it adds to the robot."
            : "",
          has(/\bmotor\b|\bmovement\b/)
            ? "Check whether students can identify the movement system rather than describing motion in vague terms."
            : "",
          "Stop passive watching by asking students to name the exact system behind one observed behaviour."
        ]).slice(0, 4)
      },
      {
        pageTitles: quizEvidence.title ? [quizEvidence.title] : [],
        outcomeHint: "Explain how Zippy's power, control, movement, and communication systems work together during the demo.",
        reinforceHints: dedupe([
          has(/\bcontrol\b/)
            ? "Listen for whether students can explain how Zippy is controlled, not just name a controller or input."
            : "",
          has(/\bcommunication\b|\bwifi\b|\bbluetooth\b/)
            ? "Check that students can distinguish communication from power or control when they describe the robot."
            : "",
          "Ask students to predict what would fail first if one subsystem was removed or disconnected."
        ]).slice(0, 4)
      },
      {
        pageTitles: quizEvidence.title ? [quizEvidence.title] : [],
        outcomeHint: "Use the demo as a reference point for later build and customisation sessions.",
        reinforceHints: dedupe([
          "Make students link one demo feature to a later build, coding, or customisation session before moving on.",
          "Have confident students predict which subsystem they would most like to customise first and why.",
          "Use quick compare-and-explain questions so the session feels active rather than presentational."
        ]).slice(0, 4)
      }
    ];
  } else if (detectedDomains.includes("soldering")) {
    templates = [
      {
        outcomeHint: "Prepare tools, parts, and the work area so the first joints are controlled and safe.",
        reinforceHints: [
          "Check iron handling, workspace setup, and component orientation before students begin soldering.",
          "Make students tin, position, and inspect simple parts before they move to denser joints."
        ]
      },
      {
        outcomeHint: "Solder the main components systematically and inspect each joint before moving on.",
        reinforceHints: [
          "Inspect for shiny joints, correct wetting, and no solder bridges before students continue.",
          "Pause on polarity and lead placement before heat makes rework expensive."
        ]
      },
      {
        outcomeHint: "Diagnose weak joints or faults by inspecting, testing continuity, and reworking with purpose.",
        reinforceHints: [
          "Require continuity or visual inspection before power-on.",
          "Ask students to explain whether a fault is likely a bridge, cold joint, polarity mistake, or wiring issue."
        ]
      }
    ];
  } else if (
    detectedDomains.includes("coding_debugging") &&
    detectedDomains.includes("wiring_electronics")
  ) {
    templates = [
      {
        outcomeHint: "Verify the core wiring and power path before any code changes are made.",
        reinforceHints: [
          "Make students trace power, ground, and signal separately before they upload or test anything.",
          "Check connector orientation and cable placement before deeper troubleshooting."
        ]
      },
      {
        outcomeHint: "Upload or modify code in a controlled way and test one change at a time.",
        reinforceHints: [
          "Force one change, one test, one explanation.",
          "Use upload, error, or behaviour changes as evidence instead of guessing."
        ]
      },
      {
        outcomeHint: "Integrate the full system, test behaviour, and isolate faults systematically.",
        reinforceHints: [
          "Make students explain whether the next suspected fault is wiring, code, or hardware and why.",
          "Require a known-good checkpoint before students attempt extensions."
        ]
      }
    ];
  } else if (detectedDomains.includes("mechanical_build")) {
    templates = [
      {
        outcomeHint: "Prepare the printed parts, tools, and fasteners before permanent assembly begins.",
        reinforceHints: [
          "Check part clean-up, screw choice, and tool selection before students start fastening anything.",
          "Stop students from forcing parts together when a fit issue should be cleaned up first."
        ]
      },
      {
        outcomeHint: "Assemble the main structure in the correct order while protecting alignment.",
        reinforceHints: [
          "Watch build order closely so students do not lock in a part that blocks later assembly.",
          "Check hinge, orientation, and fastener placement before anything is tightened fully."
        ]
      },
      {
        outcomeHint: "Finish fit, fastening, and final checks so the build is stable and ready for later wiring or testing.",
        reinforceHints: [
          "Make students test fit and movement before they call the task complete.",
          "Ask students to identify one alignment or fit risk before they move on."
        ]
      }
    ];
  } else if (detectedDomains.includes("wiring_electronics")) {
    templates = [
      {
        outcomeHint: "Wire the first subsystem carefully against the diagram and verify each connection.",
        reinforceHints: [
          "Have students trace each connection aloud against the diagram one at a time.",
          "Separate power, ground, and signal checks instead of treating the whole circuit as one mystery."
        ]
      },
      {
        outcomeHint: "Build or test the main circuit while catching the most likely miswires early.",
        reinforceHints: [
          "Check breadboard rows, pin order, and labelled signals before students power the circuit.",
          "Use one small test to prove the circuit is behaving as expected before extending it."
        ]
      },
      {
        outcomeHint: "Explain how the circuit should behave and isolate faults systematically if it does not.",
        reinforceHints: [
          "Ask what evidence would prove the issue is in wiring rather than code or hardware.",
          "Require one correction at a time, followed by an immediate retest."
        ]
      }
    ];
  } else if (detectedDomains.includes("theory_concepts")) {
    templates = [
      {
        outcomeHint: "Identify the key components or concepts that matter in this session.",
        reinforceHints: [
          "Ask students to name the part or concept and then explain its purpose in plain language.",
          "Use short compare-and-contrast questions to expose shallow memorisation early."
        ]
      },
      {
        outcomeHint: "Apply the concept to a practical example instead of leaving it at a definition level.",
        reinforceHints: [
          "Push students to connect the concept to a real part, signal, or robot behaviour.",
          "Check whether students can explain why the concept matters to the build."
        ]
      },
      {
        outcomeHint: "Use the concept as a basis for prediction, troubleshooting, or extension thinking.",
        reinforceHints: [
          "Ask students what they would expect to happen if one key part or idea changed.",
          "Listen for cause-and-effect explanations, not just repeated terms."
        ]
      }
    ];
  } else {
    templates = [
      {
        outcomeHint: "Build confidence with the core tools, ideas, or parts introduced in this session.",
        reinforceHints: [
          "Check that students can explain what they are doing and why before they move on.",
          "Use a short checkpoint so misunderstandings are corrected early."
        ]
      },
      {
        outcomeHint: "Complete the main practical task with deliberate choices and visible checks for quality.",
        reinforceHints: [
          "Ask students to justify their next change before they make it.",
          "Require one test or verification step before students call the task complete."
        ]
      },
      {
        outcomeHint: "Reflect on the result, fix one issue, and connect the work to the next stage of the project.",
        reinforceHints: [
          "Get students to explain one thing that worked and one thing they still need to improve.",
          "Link the task back to the wider project so students understand why it matters."
        ]
      }
    ];
  }

  return titles.map((title, index) => ({
    title,
    ...(templates[Math.min(index, templates.length - 1)] ?? templates[templates.length - 1])
  }));
}

function buildDefaultTaskTitles(sessionName: string, count: number): string[] {
  const match = sessionName.match(/^(Session\s+\d+)/i);
  const sessionLabel = match?.[1] ?? "Session";
  return Array.from({ length: count }, (_, index) =>
    `${sessionLabel}: Task ${String.fromCharCode(65 + index)}`
  );
}

function buildFallbackTaskOutputs(
  taskContexts: TeacherNotesAgentTaskInput[]
): TeacherNotesAgentOutput["tasks"] {
  return taskContexts.map((task) => ({
    title: task.title,
    outcome: task.outcomeHint,
    reinforce: dedupe(task.reinforceHints ?? []).slice(0, 5),
    goldenNuggets: [],
    beginner: task.beginnerHint,
    extension: task.extensionHint
  }));
}

function mergeFallbackTasks(
  primary: TeacherNotesAgentOutput["tasks"],
  fallback: TeacherNotesAgentOutput["tasks"]
): TeacherNotesAgentOutput["tasks"] {
  if (fallback.length === 0) return primary;
  if (primary.length === 0) return fallback;

  const fallbackByTitle = new Map(fallback.map((task) => [normalizeLoose(task.title), task]));
  const merged = primary.map((task) => {
    const candidate = fallbackByTitle.get(normalizeLoose(task.title));
    if (!candidate) return task;
    return {
      title: task.title,
      outcome: task.outcome ?? candidate.outcome,
      reinforce: dedupe([...task.reinforce, ...candidate.reinforce]).slice(0, 5),
      goldenNuggets: dedupe(task.goldenNuggets).slice(0, 3),
      beginner: task.beginner ?? candidate.beginner,
      extension: task.extension ?? candidate.extension
    };
  });

  for (const candidate of fallback) {
    if (!merged.some((task) => normalizeLoose(task.title) === normalizeLoose(candidate.title))) {
      merged.push(candidate);
    }
  }

  return merged;
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

function buildObjectivePoints(
  introPages: SessionPageContext[],
  tasks: SessionTask[],
  sessionName: string,
  detectedDomains: TeacherNotesDomainKey[],
  evidenceText = ""
): string[] {
  const points: string[] = [];
  const lowerEvidence = evidenceText.toLowerCase();

  if (detectedDomains.includes("demo_orientation")) {
    points.push("Explain what Nexgen Zippy can do and how the session connects to later build work.");
    if (
      /\bbattery\b|\bvideo streaming\b|\bcamera\b|\bcontrol\b|\bmotor\b|\bcommunication\b/.test(
        lowerEvidence
      )
    ) {
      points.push(
        "Identify the systems that power Zippy, control it, move it, and communicate or stream information during the demo."
      );
    }
  }
  if (detectedDomains.includes("software_setup")) {
    points.push("Set up the required software and confirm it is ready for later sessions.");
  }
  if (detectedDomains.includes("cad_3d")) {
    points.push("Customise Zippy in Tinkercad while working within the available chassis space.");
    points.push("Test design decisions against fit, clearance, and printability before treating the model as finished.");
    if (/\bextrude\b|\bgroup\b|\bfile format\b|\bbasic shape\b/.test(lowerEvidence)) {
      points.push(
        "Use core Tinkercad tools such as basic shapes, grouping, and extrusion to build a printable customisation."
      );
    }
  }
  if (detectedDomains.includes("soldering")) {
    points.push("Identify the soldering quality checks that matter before powering the robot or board.");
  }
  if (detectedDomains.includes("wiring_electronics")) {
    points.push("Verify key wiring paths and explain how the circuit should be checked before testing.");
  }
  if (detectedDomains.includes("coding_debugging")) {
    points.push("Use a simple test loop to confirm the software setup or code is working before moving on.");
  }

  const taskSequence = buildTaskSequenceObjective(tasks);
  if (taskSequence && points.length < 2) {
    points.push(taskSequence);
  }

  const introSentence = firstSentence(introPages.map((p) => p.bodyText).join(" "));
  if (introSentence && !isPromotionalObjectiveSentence(introSentence)) {
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

function isPromotionalObjectiveSentence(value: string): boolean {
  return /\b(dive into|diving into|exciting world|amazing world|fun world|journey into|let'?s explore|in this exciting session|get ready to explore)\b/i.test(
    value
  );
}

function buildTaskSummary(task: SessionTask): string {
  const sources = task.pages.map((page) => page.title).join(", ");
  return `Complete the activities in ${sources}.`;
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
  sessionName: string,
  detectedDomains: TeacherNotesDomainKey[] = []
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

  if (detectedDomains.includes("demo_orientation")) {
    issues.push(
      {
        issue: "Students remember the exciting feature they saw but cannot explain which subsystem made it possible.",
        solution: "Pause the demo and ask students to name the exact part or system responsible for that behaviour before moving on."
      },
      {
        issue: "Students mix up power, control, movement, and communication when describing how Zippy works.",
        solution: "Have students sort one observed feature into the correct system bucket, then justify why it belongs there."
      }
    );
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
  sessionName: string,
  detectedDomains: TeacherNotesDomainKey[]
): CommonIssue[] {
  const issues = buildCommonIssues(tasks, fullText, [], sessionName, detectedDomains);
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
  moduleText: string,
  detectedDomains: TeacherNotesDomainKey[]
): CourseInsight {
  const isSoldering = isSolderingContext(sessionName, moduleText);
  const highlightAreas = dedupe(
    detectedDomains.flatMap((domainKey) =>
      TEACHER_NOTES_CONTRACT.domains[domainKey].strongTeacherMoves.slice(0, 2)
    )
  );

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
  if (/\b(upload|compile|port|board)\b/i.test(moduleText)) {
    issueHints.push({
      issue: "Board/port mismatch appears repeatedly across sessions.",
      solution: "Run a 30-second board-port-cable check at the start of practical work before opening debugging support."
    });
  }
  if (/\b(wiring|pin|connection)\b/i.test(moduleText)) {
    issueHints.push({
      issue: "Wiring mistakes recur across multiple sessions.",
      solution: "Require students to annotate each verified connection and get a peer check before upload."
    });
  }
  if (/\b(save|checkpoint|version)\b/i.test(moduleText)) {
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

function buildTaskDifferentiation(
  task: SessionTask
): { beginner?: string; extension?: string } | undefined {
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

  return undefined;
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

function dedupeTeacherMoves(
  values: Array<{ issue: string; teacherMove: string }>
): Array<{ issue: string; teacherMove: string }> {
  const seen = new Set<string>();
  const out: Array<{ issue: string; teacherMove: string }> = [];
  for (const value of values) {
    const issue = value.issue.replace(SPACE_RE, " ").trim();
    const teacherMove = value.teacherMove.replace(SPACE_RE, " ").trim();
    if (!issue || !teacherMove) continue;
    const key = issue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ issue, teacherMove });
  }
  return out;
}

function dedupeDomainKeys(values: TeacherNotesDomainKey[]): TeacherNotesDomainKey[] {
  return Array.from(new Set(values));
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
