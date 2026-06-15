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
  teacherFocusHints: string[];
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

export type TeacherNotesSourceInspection = {
  module: CanvasModuleSummary;
  moduleItems: Array<{
    position: number;
    type: string;
    title: string;
  }>;
  sourcePages: Array<{
    position: number;
    title: string;
    pageUrl: string;
    characterCount: number;
    excerpt?: string;
  }>;
  introPages: string[];
  quiz: {
    title?: string;
    questionCount: number;
    questionStems: string[];
  };
  detectedDomains: TeacherNotesDomainKey[];
  agentInput: TeacherNotesAgentInput;
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
  { pattern: /\bblender\b/i, label: "Blender" },
  { pattern: /\btinkercad\b/i, label: "Tinkercad" },
  { pattern: /\bmobile app\b|\bweb application\b|\bweb app\b/i, label: "Mobile web app" },
  { pattern: /\bweb browser\b/i, label: "Web browser (Chrome preferred)" }
];

const HARDWARE_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bzippy\b/i, label: "Nexgen Zippy robot" },
  { pattern: /\bchassis\b/i, label: "Chassis" },
  { pattern: /\blcd\b/i, label: "LCD screen module" },
  { pattern: /\b3x4\b|\bmatrix keypad\b|\bkeypad\b/i, label: "3x4 matrix keypad" },
  { pattern: /\bpcb\b/i, label: "PCB" },
  { pattern: /\besp32\b|\bnodemcu\b/i, label: "NodeMCU ESP32 board" },
  { pattern: /\bbuck converter\b|\b5v buck\b/i, label: "5V buck converter" },
  { pattern: /\besp32-?cam\b|\bcamera\b|\bvideo streaming\b/i, label: "ESP32-CAM / camera module" },
  { pattern: /\bservo\b/i, label: "Servo motor" },
  { pattern: /\bmotor driver\b/i, label: "Motor driver module" },
  { pattern: /\btt motors?\b|\bmotors?\b/i, label: "Drive motors" },
  { pattern: /\bbatter(?:y|ies)\b|\bbattery pack\b/i, label: "Battery pack / batteries" },
  { pattern: /\bbreadboard\b/i, label: "Breadboard" },
  { pattern: /\bjumper wire/i, label: "Jumper wires" },
  { pattern: /\busb\b/i, label: "USB cable" },
  { pattern: /\bswitch\b/i, label: "Switch" },
  { pattern: /\bstandoff\b/i, label: "Standoffs" },
  { pattern: /\bwheel\b/i, label: "Wheels" },
  { pattern: /\bcastor\b|\bcaster\b/i, label: "Castor wheel" },
  { pattern: /\bmarble\b/i, label: "Marble" },
  { pattern: /\bdc connector\b|\bpower connector\b/i, label: "DC power connector" },
  { pattern: /\bmobile phone\b|\bphone\b/i, label: "Mobile phone" },
  { pattern: /\bsolder(?:ing)?\b|\bsoldering iron\b/i, label: "Soldering iron" },
  { pattern: /\bflux\b/i, label: "Flux / solder paste" },
  { pattern: /\bmultimeter\b|\bcontinuity\b/i, label: "Multimeter (continuity mode)" },
  { pattern: /\bdesolder(?:ing)?\b|\bsolder wick\b/i, label: "Desoldering braid / solder wick" }
];

const HEURISTIC_TEACHER_FOCUS_FALLBACK =
  "Watch for students forcing parts into place instead of checking fit, orientation, and assembly order first.";

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
  const allowTheoryTaskLanguage = hasResearchStyleTask(tasks);
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
    const validation = validateTeacherNotesContent(completedAgentOutput, {
      detectedDomains,
      allowTheoryTaskLanguage
    });
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

export async function inspectTeacherNotesSourceForSession(
  client: CanvasClient,
  courseId: number,
  sessionName: string,
  pageTitle: string
): Promise<TeacherNotesSourceInspection> {
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

  return {
    module,
    moduleItems: sortedItems.map((item) => ({
      position: item.position,
      type: item.type,
      title: item.title
    })),
    sourcePages: modulePages.map((page) => ({
      position: page.position,
      title: page.title,
      pageUrl: page.pageUrl,
      characterCount: page.bodyText.length,
      excerpt: buildPageExcerpt(page.bodyText, 2, 360)
    })),
    introPages: introPages.map((page) => page.title),
    quiz: {
      title: quizEvidence.title,
      questionCount: quizEvidence.questionStems.length,
      questionStems: quizEvidence.questionStems
    },
    detectedDomains,
    agentInput
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
    sourcePages: modulePages.map((page) => ({
      title: page.title,
      bodyText: page.bodyText
    })),
    quizTitle: quizEvidence.title,
    quizQuestionStems: quizEvidence.questionStems,
    sessionOverview:
      buildPageExcerpt(introPages.map((page) => page.bodyText).join(" "), 3, 420) ??
      buildPageExcerpt(fullText, 3, 420),
    modulePageTitles: modulePages.map((page) => page.title),
    contextKeywords,
    detectedDomains,
    softwareHints: detectRequiredSoftware(tasks, fullText),
    hardwareHints: detectRequiredHardware(tasks, fullText),
    highlightAreaHints: courseInsight.teacherFocusHints,
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
  const software = detectRequiredSoftware(tasks, fullText);
  const hardware = detectRequiredHardware(tasks, fullText);
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
  const normalizedObjectives = normalizeStudentObjectives(objectivePoints);
  if (normalizedObjectives[0]) {
    lines.push(`<p>${escapeHtml(normalizedObjectives[0])}</p>`);
  }
  lines.push(
    `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherFocusLabel)}</strong> ${escapeHtml(
      buildTeacherFocusFallback(courseInsight.teacherFocusHints)
    )}</p>`
  );
  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.componentsAndSoftwareHeading)}</h3>`);
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.softwareLabel)}</strong></p>`);
  if (software.length > 0) {
    lines.push("<ul>");
    for (const item of software) {
      lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
    }
    lines.push("</ul>");
  } else {
    lines.push("<p>None required in this session.</p>");
  }
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.hardwareLabel)}</strong></p>`);
  lines.push("<ul>");
  for (const item of (hardware.length > 0 ? hardware : ["N/A"])) {
    lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
  }
  lines.push("</ul>");

  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.taskGuidanceHeading)}</h3>`);
  if (tasks.length === 0) {
    lines.push("<p>No usable task guidance was found in the current session pages. Update the Task A/B/C page content to expand this section automatically.</p>");
  }
  tasks.forEach((task, index) => {
    lines.push(`<h4>${escapeHtml(buildTaskDisplayTitle(task))}</h4>`);
    lines.push(
      `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.outcomeLabel)}</strong> ${escapeHtml(
        buildTaskOutcome(task, sessionName, detectedDomains)
      )}</p>`
    );

    const taskPoints = buildTaskKeyPoints(task);
    if (taskPoints.length > 0) {
      lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.keyPointsLabel)}</strong></p>`);
      lines.push("<ul>");
      for (const point of taskPoints) {
        lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
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
      `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.solutionLabel)}</strong> ${escapeHtml(
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
  const normalizedObjectives = normalizeStudentObjectives(content.sessionObjective);
  if (normalizedObjectives[0]) {
    lines.push(`<p>${escapeHtml(normalizedObjectives[0])}</p>`);
  }
  if (content.teacherFocus) {
    lines.push(
      `<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.teacherFocusLabel)}</strong> ${escapeHtml(content.teacherFocus)}</p>`
    );
  }

  pushSectionDivider(lines);
  lines.push(`<h3>${escapeHtml(TEACHER_NOTES_TEMPLATE.componentsAndSoftwareHeading)}</h3>`);
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.softwareLabel)}</strong></p>`);
  if (content.software.length > 0) {
    lines.push("<ul>");
    for (const item of content.software) {
      lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
    }
    lines.push("</ul>");
  } else {
    lines.push("<p>None required in this session.</p>");
  }
  lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.hardwareLabel)}</strong></p>`);
  lines.push("<ul>");
  for (const item of (content.hardware.length > 0 ? content.hardware : ["N/A"])) {
    lines.push(`<li><p>${escapeHtml(item)}</p></li>`);
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
    if (task.keyPoints.length > 0) {
      lines.push(`<p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.keyPointsLabel)}</strong></p>`);
      lines.push("<ul>");
      for (const point of task.keyPoints) {
        lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
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
      `<li><p><strong>${escapeHtml(TEACHER_NOTES_TEMPLATE.solutionLabel)}</strong> ${escapeHtml(issue.solution)}</p></li>`
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

function buildTeacherFocusFallback(teacherFocusHints: string[]): string {
  return teacherFocusHints[0] ?? HEURISTIC_TEACHER_FOCUS_FALLBACK;
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
  const fallbackIssues = buildAgentCommonIssues([], evidenceText, sessionName, detectedDomains).map((issue) => ({
    issue: issue.issue,
    solution: issue.solution
  }));

  return {
    ...content,
    sessionObjective: content.sessionObjective.slice(
      0,
      TEACHER_NOTES_CONTRACT.mainSessionObjective.maxEntries
    ),
    teacherFocus: content.teacherFocus ?? buildTeacherFocusFallback(courseInsight.teacherFocusHints),
    tasks: mergeFallbackTasks(content.tasks, fallbackTasks),
    commonIssues: dedupeIssueSolutions([
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
      keyPoints: task.keyPoints.filter(
        (value) =>
          hasContextKeywordOverlap(value, taskKeywords) &&
          !isLowValueAdminLine(value) &&
          !isEditorialReviewMetaLine(value) &&
          keepDomainSafeLine(value)
      )
    };
  }).filter((task) => !!task.outcome || task.keyPoints.length > 0);

  const commonIssues = content.commonIssues.filter(
    (item) =>
      hasContextKeywordOverlap(item.issue, evidence.sessionKeywords) &&
      hasContextKeywordOverlap(item.solution, evidence.sessionKeywords) &&
      !isEditorialReviewMetaLine(item.issue) &&
      !isEditorialReviewMetaLine(item.solution) &&
      keepDomainSafeLine(item.issue) &&
      keepDomainSafeLine(item.solution)
  );
  const teacherFocus =
    content.teacherFocus &&
    hasContextKeywordOverlap(content.teacherFocus, evidence.sessionKeywords) &&
    !isEditorialReviewMetaLine(content.teacherFocus) &&
    keepDomainSafeLine(content.teacherFocus)
      ? content.teacherFocus
      : buildTeacherFocusFallback([]);

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
            ...(task.keyPointHints ?? [])
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

function hasResearchStyleTask(tasks: SessionTask[]): boolean {
  return tasks.some((task) => {
    const combined = `${task.title} ${task.pages.map((page) => `${page.title} ${page.bodyText}`).join(" ")}`.toLowerCase();
    return /\bresearch\b|\bdeeper understanding\b|\bparts connect\b|\bwhat job does this part do\b|\bunderstand what each main .* part does\b/.test(
      combined
    );
  });
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
    tasks.map((task) => buildTaskDisplayTitle(task)),
    sessionName,
    quizEvidence,
    detectedDomains
  );
}

function buildTeacherNotesTaskContext(task: SessionTask): TeacherNotesAgentTaskInput {
  return {
    title: buildTaskDisplayTitle(task),
    pageTitles: task.pages.map((page) => page.title),
    outcomeHint: buildTaskOutcome(task),
    pageSummaries: task.pages
      .map((page) => buildPageExcerpt(page.bodyText))
      .filter((summary): summary is string => Boolean(summary)),
    keyPointHints: buildTaskKeyPoints(task)
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
        keyPointHints: dedupe([
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
        keyPointHints: dedupe([
          has(/\bextrude\b/)
            ? "Ask students to explain what their extrusion or cut is doing to the model before approving it."
            : "",
          "Check fit, clearance, and connection points before students commit to decorative detail.",
          "Stop decorative drift by asking what the change improves: fit, function, or appearance.",
          has(/\bgroup\b/)
            ? "Watch for grouped shapes that hide imprecise placement or make later edits harder."
            : ""
        ]).slice(0, 4)
      },
      {
        pageTitles: quizEvidence.title ? [quizEvidence.title] : [],
        outcomeHint: "Check print readiness and save a clean version of the design for later build work.",
        keyPointHints: dedupe([
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
        keyPointHints: dedupe([
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
        keyPointHints: dedupe([
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
        keyPointHints: dedupe([
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
        keyPointHints: [
          "Check iron handling, workspace setup, and component orientation before students begin soldering.",
          "Make students tin, position, and inspect simple parts before they move to denser joints."
        ]
      },
      {
        outcomeHint: "Solder the main components systematically and inspect each joint before moving on.",
        keyPointHints: [
          "Inspect for shiny joints, correct wetting, and no solder bridges before students continue.",
          "Pause on polarity and lead placement before heat makes rework expensive."
        ]
      },
      {
        outcomeHint: "Diagnose weak joints or faults by inspecting, testing continuity, and reworking with purpose.",
        keyPointHints: [
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
        keyPointHints: [
          "Make students trace power, ground, and signal separately before they upload or test anything.",
          "Check connector orientation and cable placement before deeper troubleshooting."
        ]
      },
      {
        outcomeHint: "Upload or modify code in a controlled way and test one change at a time.",
        keyPointHints: [
          "Force one change, one test, one explanation.",
          "Use upload, error, or behaviour changes as evidence instead of guessing."
        ]
      },
      {
        outcomeHint: "Integrate the full system, test behaviour, and isolate faults systematically.",
        keyPointHints: [
          "Make students explain whether the next suspected fault is wiring, code, or hardware and why.",
          "Require a known-good checkpoint before students attempt extensions."
        ]
      }
    ];
  } else if (detectedDomains.includes("mechanical_build")) {
    templates = [
      {
        outcomeHint: "Prepare the printed parts, tools, and fasteners before permanent assembly begins.",
        keyPointHints: [
          "Check part clean-up, screw choice, and tool selection before students start fastening anything.",
          "Stop students from forcing parts together when a fit issue should be cleaned up first."
        ]
      },
      {
        outcomeHint: "Assemble the main structure in the correct order while protecting alignment.",
        keyPointHints: [
          "Watch build order closely so students do not lock in a part that blocks later assembly.",
          "Check hinge, orientation, and fastener placement before anything is tightened fully."
        ]
      },
      {
        outcomeHint: "Finish fit, fastening, and final checks so the build is stable and ready for later wiring or testing.",
        keyPointHints: [
          "Make students test fit and movement before they call the task complete.",
          "Ask students to identify one alignment or fit risk before they move on."
        ]
      }
    ];
  } else if (detectedDomains.includes("wiring_electronics")) {
    templates = [
      {
        outcomeHint: "Wire the first subsystem carefully against the diagram and verify each connection.",
        keyPointHints: [
          "Have students trace each connection aloud against the diagram one at a time.",
          "Separate power, ground, and signal checks instead of treating the whole circuit as one mystery."
        ]
      },
      {
        outcomeHint: "Build or test the main circuit while catching the most likely miswires early.",
        keyPointHints: [
          "Check breadboard rows, pin order, and labelled signals before students power the circuit.",
          "Use one small test to prove the circuit is behaving as expected before extending it."
        ]
      },
      {
        outcomeHint: "Explain how the circuit should behave and isolate faults systematically if it does not.",
        keyPointHints: [
          "Ask what evidence would prove the issue is in wiring rather than code or hardware.",
          "Require one correction at a time, followed by an immediate retest."
        ]
      }
    ];
  } else if (detectedDomains.includes("theory_concepts")) {
    templates = [
      {
        outcomeHint: "Identify the key components or concepts that matter in this session.",
        keyPointHints: [
          "Ask students to name the part or concept and then explain its purpose in plain language.",
          "Use short compare-and-contrast questions to expose shallow memorisation early."
        ]
      },
      {
        outcomeHint: "Apply the concept to a practical example instead of leaving it at a definition level.",
        keyPointHints: [
          "Push students to connect the concept to a real part, signal, or robot behaviour.",
          "Check whether students can explain why the concept matters to the build."
        ]
      },
      {
        outcomeHint: "Use the concept as a basis for prediction, troubleshooting, or extension thinking.",
        keyPointHints: [
          "Ask students what they would expect to happen if one key part or idea changed.",
          "Listen for cause-and-effect explanations, not just repeated terms."
        ]
      }
    ];
  } else {
    templates = [
      {
        outcomeHint: "Build confidence with the core tools, ideas, or parts introduced in this session.",
        keyPointHints: [
          "Check that students can explain what they are doing and why before they move on.",
          "Use a short checkpoint so misunderstandings are corrected early."
        ]
      },
      {
        outcomeHint: "Complete the main practical task with deliberate choices and visible checks for quality.",
        keyPointHints: [
          "Ask students to justify their next change before they make it.",
          "Require one test or verification step before students call the task complete."
        ]
      },
      {
        outcomeHint: "Reflect on the result, fix one issue, and connect the work to the next stage of the project.",
        keyPointHints: [
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
  return Array.from({ length: count }, (_, index) => `Task ${String.fromCharCode(65 + index)}`);
}

function buildFallbackTaskOutputs(
  taskContexts: TeacherNotesAgentTaskInput[]
): TeacherNotesAgentOutput["tasks"] {
  return taskContexts.map((task) => ({
    title: task.title,
    outcome: task.outcomeHint,
    keyPoints: dedupe(task.keyPointHints ?? []).slice(0, 5)
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
      keyPoints: dedupe([...task.keyPoints, ...candidate.keyPoints]).slice(0, 5)
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
  const lowerEvidence = evidenceText.toLowerCase();
  const introSentence = firstSentence(introPages.map((p) => p.bodyText).join(" "));
  if (introSentence && !isPromotionalObjectiveSentence(introSentence)) {
    return [normalizeStudentObjective(introSentence)];
  }

  if (detectedDomains.includes("mechanical_build")) {
    return [
      "Students will assemble Zippy's main parts in the correct order so the robot is ready for wiring and testing next session."
    ];
  }
  if (detectedDomains.includes("cad_3d")) {
    return [
      "Students will create a Zippy customisation that fits the chassis and remains practical to print."
    ];
  }
  if (detectedDomains.includes("software_setup")) {
    return [
      "Students will set up the required software and confirm it is ready for the next stage of the project."
    ];
  }
  if (detectedDomains.includes("demo_orientation")) {
    return [
      "Students will explain the main Zippy features and how they connect to later build sessions."
    ];
  }
  if (detectedDomains.includes("soldering")) {
    return [
      "Students will produce clean, reliable soldered connections and check them before moving on."
    ];
  }
  if (
    detectedDomains.includes("coding_debugging") &&
    detectedDomains.includes("wiring_electronics")
  ) {
    return [
      "Students will wire and test Zippy methodically so faults can be isolated one change at a time."
    ];
  }
  if (detectedDomains.includes("wiring_electronics")) {
    return [
      "Students will connect the required parts correctly and explain how each connection should behave."
    ];
  }
  if (detectedDomains.includes("theory_concepts")) {
    return [
      "Students will explain the main concepts or parts that this session depends on before applying them."
    ];
  }

  const taskSequence = buildTaskSequenceObjective(tasks);
  if (taskSequence) {
    return [normalizeStudentObjective(taskSequence)];
  }

  if (/\bassemble\b|\bassembly\b/.test(lowerEvidence)) {
    return [
      `Students will complete the main assembly steps for ${sessionName.replace(/^Session\s+\d+\s*-\s*/i, "")}.`
    ];
  }

  return [`Students will apply the core skills from ${sessionName} in the intended task order.`];
}

function isPromotionalObjectiveSentence(value: string): boolean {
  return /\b(dive into|diving into|exciting world|amazing world|fun world|journey into|let'?s explore|in this exciting session|get ready to explore)\b/i.test(
    value
  );
}

function buildTaskDisplayTitle(task: SessionTask): string {
  const parsed = parseTaskHeader(task.title);
  const taskLabel = parsed ? `Task ${parsed.taskLabel}` : task.title;
  const subject = deriveTaskSubject(task);
  return subject ? `${taskLabel} - ${subject}` : taskLabel;
}

function deriveTaskSubject(task: SessionTask): string {
  const pageTitles = task.pages.map((page) => page.title.trim()).filter(Boolean);
  if (pageTitles.length === 0) return "";
  if (pageTitles.length === 1) return pageTitles[0];

  const prefixes = pageTitles
    .map((title) => {
      const match = title.match(/^(.+?)\s*-\s*/);
      return match?.[1]?.trim();
    })
    .filter((value): value is string => Boolean(value));

  if (prefixes.length === pageTitles.length && prefixes.every((value) => value === prefixes[0])) {
    return prefixes[0];
  }

  return pageTitles[0];
}

function buildTaskOutcome(
  task: SessionTask,
  sessionName = "",
  detectedDomains: TeacherNotesDomainKey[] = []
): string {
  const titleContext = buildTaskDisplayTitle(task).toLowerCase();
  const bodyContext = task.pages.map((page) => page.bodyText).join(" ").toLowerCase();
  const pageTitleContext = task.pages.map((page) => page.title).join(" ").toLowerCase();

  if (/\bgather parts\b|\bparts for assembly\b/.test(titleContext)) {
    return "Students gather the required parts and tools so the main assembly can start smoothly.";
  }
  if (/\bresearch\b|\bdeeper understanding\b|\bparts connect\b/.test(titleContext + bodyContext)) {
    return "Students identify what each main part does before wiring begins next session.";
  }
  if (/\bassembly\b/.test(titleContext) || /\bassembly\b/.test(pageTitleContext)) {
    return "Students assemble Zippy's main mechanical components in the correct order so the chassis is ready for wiring next session.";
  }
  if (/\binstall\b|\bsetup\b/.test(bodyContext)) {
    return "Students complete the required setup and confirm it works before moving on.";
  }

  const summary = buildTaskSequenceObjective([task]);
  if (summary) {
    return normalizeStudentObjective(summary);
  }

  const trimmedSession = sessionName.replace(/^Session\s+\d+\s*-\s*/i, "");
  return trimmedSession
    ? `Students complete the main ${trimmedSession.toLowerCase()} work for this task.`
    : "Students complete the main result expected in this task.";
}

function buildTaskKeyPoints(task: SessionTask): string[] {
  const titleContext = buildTaskDisplayTitle(task).toLowerCase();
  const context = `${task.title} ${task.pages.map((page) => `${page.title} ${page.bodyText}`).join(" ")}`.toLowerCase();

  if (/\bgather parts\b|\bparts for assembly\b/.test(titleContext)) {
    return [
      "Check that students have the correct parts, fasteners, and tools laid out before the main assembly starts.",
      "Make students fix wire length issues now by cutting and re-stripping any leads that are obviously too long.",
      "Use the exploded view to confirm that students can identify the major parts before they begin fastening anything."
    ];
  }

  if (/\bdeeper understanding\b|\bresearch\b|\bparts connect\b/.test(titleContext + context)) {
    return [
      "Keep the task focused on what each part does, not on starting the physical wiring early.",
      "Check that students can explain why the motor drivers are needed instead of connecting the motors directly.",
      "Use the research questions to expose misconceptions about power, switching, and PCB organisation before the next session."
    ];
  }

  const points: string[] = [];

  if (/\bnot overtight\b|\bfinger-tight\b|\btight fit\b/.test(context)) {
    points.push("Check that students secure screws and terminal blocks firmly without over-tightening them.");
  }
  if (/\bwires are on the top\b|\bopposite direction\b|\bcable tie\b/.test(context)) {
    points.push("Check motor orientation and wire direction before both motors are fixed in place.");
  }
  if (/\btoo long\b|\bre-strip\b|\bslack\b|\bwirestrippers?\b/.test(context)) {
    points.push("Make students shorten, re-strip, and twist wires neatly when extra slack will interfere with the build.");
  }
  if (/\balign\b|\bshaft\b|\bslot it onto\b|\bcastor\b|\bmarble\b/.test(context)) {
    points.push("Watch alignment closely so students do not force wheels, shafts, or the castor into place when they are slightly off.");
  }
  if (/\bstandoff\b|\bpcb\b|\besp32\b|\bbuck converter\b/.test(context)) {
    points.push("Check that the standoffs, PCB, ESP32, and buck converter are positioned correctly before the top layer is screwed down.");
  }
  if (/\bswitch\b/.test(context)) {
    points.push("Stop students from forcing the switch or other tight-fitting parts past the point where the chassis may be damaged.");
  }
  if (/\bdo not connect any wires yet\b|\bresearch\b|\bwhat job does this part do\b/.test(context)) {
    points.push("Keep the research task focused on part purpose and connection logic; do not let students begin wiring early.");
  }
  if (/\bcheck your work\b|\blook a bit like this\b/.test(context)) {
    points.push("Require a visible quality check after each mini-step so students catch a bad fit before it carries into the next assembly stage.");
  }

  if (points.length === 0) {
    for (const page of task.pages) {
      const sentence = firstSentence(page.bodyText);
      if (sentence) {
        points.push(toOutcomeBullet(sentence));
      }
      if (points.length >= 3) break;
    }
  }

  return dedupe(points).slice(0, 5);
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

  if (/\bnot overtight\b|\bfinger-tight\b/.test(lower)) {
    issues.push({
      issue: "Students over-tighten screws or terminal blocks and damage the part or strip the connection.",
      solution: "Stop them at the first sign of resistance and reset the expectation to firm, secure fastening rather than maximum force."
    });
  }
  if (/\btoo long\b|\bre-strip\b|\bslack\b/.test(lower)) {
    issues.push({
      issue: "Students leave motor or switch wires too long, which creates slack, strain, or a messy fit.",
      solution: "Have them cut the wire to a sensible length, re-strip it cleanly, twist the strands, and reconnect it neatly before continuing."
    });
  }
  if (/\bwires are on the top\b|\bopposite direction\b/.test(lower)) {
    issues.push({
      issue: "Students mount the motors with the wrong orientation or wire direction.",
      solution: "Pause the build, compare both motors to the reference animation, and fix the orientation before the rest of the assembly locks it in."
    });
  }
  if (/\balign\b|\bshaft\b|\bslot it onto\b/.test(lower)) {
    issues.push({
      issue: "Students try to force a wheel, shaft, or moving part before it is properly aligned.",
      solution: "Make them back the part out, realign it carefully, and test the fit again rather than pushing harder."
    });
  }
  if (/\btight fit\b|\bdoesn't fit\b|\bdoes not fit\b/.test(lower)) {
    issues.push({
      issue: "Students assume a tight-fitting component should be forced into place.",
      solution: "Tell them to stop and re-check the orientation, fit, and reference image before applying more pressure."
    });
  }
  if (/\bdo not connect any wires yet\b/.test(lower)) {
    issues.push({
      issue: "Students start wiring during the research task instead of just identifying part roles and connections.",
      solution: "Keep them on the research questions only and hold off any physical wiring until the next session."
    });
  }

  if (detectedDomains.includes("cad_3d")) {
    issues.push({
      issue: "Students design a feature that looks interesting but will not attach or print cleanly.",
      solution: "Check fit, clearance, and printability before the design is treated as finished."
    });
  }
  if (detectedDomains.includes("demo_orientation")) {
    issues.push({
      issue: "Students remember the exciting feature but cannot explain which subsystem made it happen.",
      solution: "Pause the demo and make them name the exact part or subsystem responsible before moving on."
    });
  }
  if (detectedDomains.includes("software_setup")) {
    issues.push({
      issue: "Students say setup is complete without proving the software or board connection actually works.",
      solution: "Run one short success check before they leave setup: open the tool, choose the right board, and confirm the expected connection appears."
    });
  }

  issues.push(...issueHints);

  if (issues.length < 2 && tasks.length > 0) {
    issues.push({
      issue: "Students move to the next step without checking whether the current assembly still looks correct.",
      solution: "Add a quick compare-to-reference checkpoint before each new stage begins."
    });
  }

  return dedupeIssues(issues).slice(0, TEACHER_NOTES_CONTRACT.mostCommonIssues.maxEntries);
}

function buildAgentCommonIssues(
  tasks: SessionTask[],
  fullText: string,
  sessionName: string,
  detectedDomains: TeacherNotesDomainKey[]
): CommonIssue[] {
  return buildCommonIssues(tasks, fullText, [], sessionName, detectedDomains);
}

function buildCourseInsights(
  sessionName: string,
  moduleText: string,
  detectedDomains: TeacherNotesDomainKey[]
): CourseInsight {
  const teacherFocusHints: string[] = [];
  const lower = `${sessionName} ${moduleText}`.toLowerCase();

  if (/\bnot overtight\b|\bfinger-tight\b/.test(lower)) {
    teacherFocusHints.push("Check that students do not over-tighten screws or terminal blocks while assembling.");
  }
  if (/\btoo long\b|\bre-strip\b|\bslack\b/.test(lower)) {
    teacherFocusHints.push("Check wire length and have students cut and re-strip wires that will create slack or strain.");
  }
  if (/\bwires are on the top\b|\balign\b|\btight fit\b|\bcastor\b|\bpcb\b|\bstandoff\b/.test(lower)) {
    teacherFocusHints.push("Check that parts are oriented and seated correctly before students lock them in with screws or pressure.");
  }
  if (teacherFocusHints.length === 0) {
    teacherFocusHints.push(
      ...detectedDomains.flatMap((domainKey) =>
        TEACHER_NOTES_CONTRACT.domains[domainKey].strongTeacherMoves.slice(0, 1)
      )
    );
  }

  return {
    teacherFocusHints: dedupe(teacherFocusHints).slice(0, 4),
    issueHints: []
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

function detectRequiredSoftware(tasks: SessionTask[], text: string): string[] {
  return detectComponents(tasks.map((task) => task.pages.map((page) => page.bodyText).join(" ")).join(" "), SOFTWARE_KEYWORDS, []);
}

function detectRequiredHardware(tasks: SessionTask[], text: string): string[] {
  const taskText = tasks
    .filter((task) => {
      const parsed = parseTaskHeader(task.title);
      return !parsed || parsed.taskLabel === "A" || parsed.taskLabel === "B";
    })
    .map((task) => task.pages.map((page) => page.bodyText).join(" "))
    .join(" ");
  const sourceText = taskText || text;
  const toolLabels = new Set([
    "Soldering iron",
    "Flux / solder paste",
    "Multimeter (continuity mode)",
    "Desoldering braid / solder wick"
  ]);

  return detectComponents(sourceText, HARDWARE_KEYWORDS, [])
    .filter((label) => !toolLabels.has(label))
    .filter((label) => label !== "Battery pack / batteries" || !/\bnot needed today\b/i.test(sourceText));
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
  const has3dDesign = matchesAny(context, [
    /\btinkercad\b/i,
    /\b3d\b/i,
    /\bmodel(?:ling|ing)?\b/i,
    /\b3d\s+print(?:ing)?\b/i,
    /\bprint(?:able|ability)\b/i,
    /\bchassis\b/i
  ]);
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

function dedupeIssueSolutions(
  values: Array<{ issue: string; solution: string }>
): Array<{ issue: string; solution: string }> {
  const seen = new Set<string>();
  const out: Array<{ issue: string; solution: string }> = [];
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
