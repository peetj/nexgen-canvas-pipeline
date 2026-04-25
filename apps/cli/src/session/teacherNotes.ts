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
  const coursePages = await collectCoursePages(client, courseId, pageTitle, pageCache);
  const courseInsight = buildCourseInsights(sessionName, modulePages, coursePages);

  let notesHtml: string;
  let generationMode: "agent" | "heuristic" = "heuristic";
  let generationWarning: string | undefined;

  try {
    const agentInput = buildTeacherNotesAgentInput(
      pageTitle,
      sessionName,
      sortedItems,
      modulePages,
      courseInsight
    );
    const agentOutput = await generateTeacherNotesFromAgent(agentInput);
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
  courseInsight: CourseInsight
): TeacherNotesAgentInput {
  const introPages = resolveIntroPages(moduleItems, modulePages);
  const tasks = resolveTasks(moduleItems, modulePages);
  const fullText = modulePages.map((page) => page.bodyText).join("\n");

  return {
    sessionName,
    pageTitle,
    sessionOverview:
      buildPageExcerpt(introPages.map((page) => page.bodyText).join(" "), 3, 420) ??
      buildPageExcerpt(fullText, 3, 420),
    objectiveHints: buildObjectivePoints(introPages, tasks, sessionName),
    softwareHints: detectComponents(fullText, SOFTWARE_KEYWORDS, ["Arduino IDE", "Serial Monitor"]),
    hardwareHints: detectComponents(fullText, HARDWARE_KEYWORDS, [
      "LCD screen module",
      "3x4 matrix keypad",
      "NodeMCU ESP32 board"
    ]),
    highlightAreaHints: courseInsight.highlightAreas,
    commonIssueHints: buildCommonIssues(tasks, fullText, courseInsight.issueHints, sessionName).map(
      (item) => ({
        issue: item.issue,
        teacherMove: item.solution
      })
    ),
    taskContexts: tasks.map((task) => {
      const differentiation = buildTaskDifferentiation(task);
      return {
        title: task.title,
        pageTitles: task.pages.map((page) => page.title),
        outcomeHint: buildTaskSummary(task),
        pageSummaries: task.pages
          .map((page) => buildPageExcerpt(page.bodyText))
          .filter((summary): summary is string => Boolean(summary)),
        reinforceHints: buildTaskPoints(task),
        beginnerHint: differentiation.beginner,
        extensionHint: differentiation.extension
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
  for (const point of content.sessionObjective) {
    lines.push(`<li><p>${escapeHtml(point)}</p></li>`);
  }
  lines.push("</ul>");
  lines.push(
    `<p><strong>Teacher focus:</strong> ${escapeHtml(content.teacherFocus ?? TEACHER_NOTES_SYSTEM_RULES.sessionTeacherFocus)}</p>`
  );

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
  for (const item of content.hardware) {
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
  lines.push(
    `<p>${escapeHtml(content.troubleshootingClose ?? TEACHER_NOTES_SYSTEM_RULES.troubleshootingClose)}</p>`
  );

  return lines.join("\n");
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
