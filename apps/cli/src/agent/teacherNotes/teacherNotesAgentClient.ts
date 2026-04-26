import { env } from "../../env.js";

export type TeacherNotesAgentTaskInput = {
  title: string;
  pageTitles?: string[];
  outcomeHint?: string;
  pageSummaries?: string[];
  reinforceHints?: string[];
  beginnerHint?: string;
  extensionHint?: string;
  reviewNotes?: string;
};

export type TeacherNotesAgentInput = {
  sessionName: string;
  pageTitle: string;
  sessionOverview?: string;
  modulePageTitles?: string[];
  contextKeywords?: string[];
  reviewNotes?: string;
  currentDraft?: TeacherNotesAgentOutput;
  reviewCommonIssues?: string[];
  objectiveHints?: string[];
  softwareHints?: string[];
  hardwareHints?: string[];
  highlightAreaHints?: string[];
  commonIssueHints?: Array<{ issue: string; teacherMove: string }>;
  taskContexts?: TeacherNotesAgentTaskInput[];
};

export type TeacherNotesAgentTaskOutput = {
  title: string;
  outcome?: string;
  reinforce: string[];
  goldenNuggets: string[];
  beginner?: string;
  extension?: string;
};

export type TeacherNotesAgentOutput = {
  sessionObjective: string[];
  teacherFocus?: string;
  software: string[];
  hardware: string[];
  highlightAreas: string[];
  tasks: TeacherNotesAgentTaskOutput[];
  commonIssues: Array<{ issue: string; teacherMove: string }>;
  troubleshootingClose?: string;
};

function normalizeSingleLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function normalizeStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const cleaned = normalizeSingleLine(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeTaskOutputs(value: unknown, max: number): TeacherNotesAgentTaskOutput[] {
  if (!Array.isArray(value)) return [];
  const out: TeacherNotesAgentTaskOutput[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const title = normalizeSingleLine(record.title);
    if (!title) continue;

    out.push({
      title,
      outcome: normalizeSingleLine(record.outcome),
      reinforce: normalizeStringArray(record.reinforce, 5),
      goldenNuggets: normalizeStringArray(record.goldenNuggets, 3),
      beginner: normalizeSingleLine(record.beginner),
      extension: normalizeSingleLine(record.extension)
    });

    if (out.length >= max) break;
  }
  return out;
}

function normalizeIssueOutputs(
  value: unknown,
  max: number
): Array<{ issue: string; teacherMove: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ issue: string; teacherMove: string }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const issue = normalizeSingleLine(record.issue);
    const teacherMove = normalizeSingleLine(record.teacherMove);
    if (!issue || !teacherMove) continue;
    const key = issue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ issue, teacherMove });
    if (out.length >= max) break;
  }
  return out;
}

export async function generateTeacherNotesFromAgent(
  input: TeacherNotesAgentInput
): Promise<TeacherNotesAgentOutput> {
  if (!env.teacherNotesAgentUrl) {
    throw new Error(
      "Teacher notes agent URL is not set. Configure CANVAS_AGENT_URL (recommended) or TEACHER_NOTES_AGENT_URL."
    );
  }

  const res = await fetch(env.teacherNotesAgentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.teacherNotesAgentApiKey
        ? { "Authorization": `Bearer ${env.teacherNotesAgentApiKey}` }
        : {})
    },
    body: JSON.stringify({
      sessionName: input.sessionName,
      pageTitle: input.pageTitle,
      sessionOverview: input.sessionOverview,
      modulePageTitles: input.modulePageTitles ?? [],
      contextKeywords: input.contextKeywords ?? [],
      reviewNotes: input.reviewNotes,
      currentDraft: input.currentDraft,
      reviewCommonIssues: input.reviewCommonIssues ?? [],
      objectiveHints: input.objectiveHints ?? [],
      softwareHints: input.softwareHints ?? [],
      hardwareHints: input.hardwareHints ?? [],
      highlightAreaHints: input.highlightAreaHints ?? [],
      commonIssueHints: input.commonIssueHints ?? [],
      taskContexts: input.taskContexts ?? []
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (
      res.status === 404 ||
      /available routes/i.test(text) ||
      /not found/i.test(text)
    ) {
      throw new Error(
        "Teacher notes agent endpoint is not available at the configured URL. " +
        "Deploy or update the canvas agent worker with the /teacher-notes route."
      );
    }
    throw new Error(`Teacher notes agent error ${res.status} ${res.statusText}\n${text}`);
  }

  const body = (await res.json()) as {
    sessionObjective?: unknown;
    teacherFocus?: unknown;
    software?: unknown;
    hardware?: unknown;
    highlightAreas?: unknown;
    tasks?: unknown;
    commonIssues?: unknown;
    troubleshootingClose?: unknown;
  };

  return {
    sessionObjective: normalizeStringArray(body.sessionObjective, 4),
    teacherFocus: normalizeSingleLine(body.teacherFocus),
    software: normalizeStringArray(body.software, 8),
    hardware: normalizeStringArray(body.hardware, 10),
    highlightAreas: normalizeStringArray(body.highlightAreas, 6),
    tasks: normalizeTaskOutputs(body.tasks, 8),
    commonIssues: normalizeIssueOutputs(body.commonIssues, 8),
    troubleshootingClose: normalizeSingleLine(body.troubleshootingClose)
  };
}
