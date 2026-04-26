type TeacherNotesTaskContext = {
  title: string;
  pageTitles?: string[];
  outcomeHint?: string;
  pageSummaries?: string[];
  reinforceHints?: string[];
  beginnerHint?: string;
  extensionHint?: string;
  reviewNotes?: string;
};

type TeacherNotesRequest = {
  sessionName: string;
  pageTitle?: string;
  sessionOverview?: string;
  modulePageTitles?: string[];
  contextKeywords?: string[];
  reviewNotes?: string;
  currentDraft?: unknown;
  reviewCommonIssues?: string[];
  objectiveHints?: string[];
  softwareHints?: string[];
  hardwareHints?: string[];
  highlightAreaHints?: string[];
  commonIssueHints?: Array<{ issue?: string; teacherMove?: string; solution?: string }>;
  taskContexts?: TeacherNotesTaskContext[];
};

type Env = {
  AGENT_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

type TeacherNotesTaskResponse = {
  title: string;
  outcome?: string;
  reinforce: string[];
  goldenNuggets: string[];
  beginner?: string;
  extension?: string;
};

const DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const cleaned = toNonEmptyString(item);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeCommonIssues(
  value: unknown,
  max: number
): Array<{ issue: string; teacherMove: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ issue: string; teacherMove: string }> = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const issue = toNonEmptyString(record.issue);
    const teacherMove =
      toNonEmptyString(record.teacherMove) ?? toNonEmptyString(record.solution);
    if (!issue || !teacherMove) continue;
    const key = issue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ issue, teacherMove });
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeTasks(
  value: unknown,
  fallbackTitles: string[],
  max: number
): TeacherNotesTaskResponse[] {
  if (!Array.isArray(value)) return [];
  const out: TeacherNotesTaskResponse[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const title = toNonEmptyString(record.title) ?? fallbackTitles[i];
    if (!title) continue;

    const reinforce = toStringArray(record.reinforce, 5);
    const goldenNuggets = toStringArray(record.goldenNuggets, 3);
    const outcome = toNonEmptyString(record.outcome);
    const beginner = toNonEmptyString(record.beginner);
    const extension = toNonEmptyString(record.extension);

    if (
      !outcome &&
      reinforce.length === 0 &&
      goldenNuggets.length === 0 &&
      !beginner &&
      !extension
    ) {
      continue;
    }

    out.push({
      title,
      outcome,
      reinforce,
      goldenNuggets,
      beginner,
      extension
    });

    if (out.length >= max) break;
  }
  return out;
}

function buildSystemPrompt(): string {
  return [
    "You write teacher notes for STEM practical sessions.",
    "Audience: busy classroom teachers who need high-leverage, concrete advice.",
    "Primary question: how can the teacher maximise help to students to build an effective project?",
    "Use the session structure and task sequence to identify where students stall, what the teacher should inspect, and what short intervention will unblock progress.",
    "Golden nuggets are concise, high-value teacher insights that prevent wasted time or reveal a hidden misconception.",
    "Prefer observable warning signs, preventative checks, and practical teacher moves over generic pedagogy.",
    "Do not copy source notes verbatim.",
    "Do not add filler, motivational language, or broad advice unless it is anchored to the actual task context.",
    "A strong line should sound obviously tied to this session and would need editing before reuse in another session.",
    "Only mention software, hardware, teacher highlights, or issues that are grounded in the supplied context.",
    "If a category is not clearly supported by the supplied context, return an empty array rather than guessing.",
    "Do not import patterns from other sessions unless they are explicitly present in the supplied context.",
    "Use the supplied contextKeywords and page titles as anchors. If you cannot tie a line to those anchors, omit it.",
    "It is better to return fewer strong items than pad the response with generic advice.",
    "Avoid low-value administrative reminders such as opening the correct link or class unless account access is clearly a major blocker in the source context.",
    "Teacher focus should be the single highest-leverage thing the teacher should inspect or listen for during the session.",
    "Highlight areas should feel like the 2-5 things a teacher would underline before class begins.",
    "Golden nuggets should be sharp teacher observations, checks, or prompts that prevent wasted student time.",
    "When reviewNotes are supplied, treat them as high-priority revision instructions for the currentDraft while staying faithful to the session evidence.",
    "If reviewNotes and currentDraft are present, revise the currentDraft rather than starting from scratch.",
    "Preserve any strong currentDraft content that does not conflict with reviewNotes.",
    "Review notes are editorial comments, not final page copy.",
    "Do not repeat review notes verbatim unless a short phrase is already polished final wording.",
    "Convert review notes into polished teacher-facing lines grounded in the session, not mechanical paraphrases.",
    "Never output meta commentary such as 'the wording is not correct', 'the first point is fine', or section labels.",
    "If a reviewer gives rough issue labels like 'wrong measurements', expand them into polished classroom-relevant issue statements.",
    "If a reviewer says a task is hard, turn that into a practical teacher move or expectation-setting note rather than a blunt warning.",
    "Implement concrete requested changes such as missing items, wording direction, or emphasis shifts without copying the review note structure.",
    "reviewCommonIssues are reviewer-supplied issue ideas and should be rewritten into polished issue statements when they fit the session evidence.",
    "taskContexts[].reviewNotes are task-specific revision notes and should inform that task's outcome, reinforce points, or golden nuggets without being quoted directly.",
    "Use Australian spelling where natural.",
    "Return ONLY valid JSON with keys: sessionObjective, teacherFocus, software, hardware, highlightAreas, tasks, commonIssues, troubleshootingClose.",
    "sessionObjective: array of 2-3 short student outcome statements.",
    "Every sessionObjective item must begin with 'Students will' or 'Students can'.",
    "teacherFocus: one short sentence.",
    "software: array of 0-6 items.",
    "hardware: array of 0-10 items.",
    "highlightAreas: array of 2-5 short actionable bullets.",
    "tasks: array matching the task order where possible. Each task object must use keys title, outcome, reinforce, goldenNuggets, beginner, extension.",
    "tasks[].outcome: one short sentence.",
    "tasks[].reinforce: array of 2-5 short points the teacher should reinforce.",
    "tasks[].goldenNuggets: array of 1-3 short, specific teacher insights.",
    "tasks[].beginner and tasks[].extension: one short sentence each.",
    "commonIssues: array of 2-6 objects with keys issue and teacherMove.",
    "commonIssues[].issue: an observable failure pattern or misconception.",
    "commonIssues[].teacherMove: the fastest teacher check or intervention.",
    "troubleshootingClose: one short sentence.",
    "No markdown, no code fences, no extra text."
  ].join(" ");
}

function buildUserPrompt(payload: TeacherNotesRequest): string {
  const context = {
    sessionName: payload.sessionName,
    pageTitle: toNonEmptyString(payload.pageTitle),
    sessionOverview: toNonEmptyString(payload.sessionOverview),
    modulePageTitles: toStringArray(payload.modulePageTitles, 12),
    contextKeywords: toStringArray(payload.contextKeywords, 24),
    reviewNotes: toNonEmptyString(payload.reviewNotes),
    currentDraft:
      payload.currentDraft && typeof payload.currentDraft === "object"
        ? payload.currentDraft
        : undefined,
    reviewCommonIssues: toStringArray(payload.reviewCommonIssues, 8),
    objectiveHints: toStringArray(payload.objectiveHints, 4),
    softwareHints: toStringArray(payload.softwareHints, 8),
    hardwareHints: toStringArray(payload.hardwareHints, 10),
    highlightAreaHints: toStringArray(payload.highlightAreaHints, 6),
    commonIssueHints: sanitizeCommonIssues(payload.commonIssueHints, 8),
    taskContexts: Array.isArray(payload.taskContexts)
      ? payload.taskContexts.slice(0, 8).map((task) => ({
          title: toNonEmptyString(task.title),
          pageTitles: toStringArray(task.pageTitles, 6),
          outcomeHint: toNonEmptyString(task.outcomeHint),
          pageSummaries: toStringArray(task.pageSummaries, 6),
          reinforceHints: toStringArray(task.reinforceHints, 6),
          beginnerHint: toNonEmptyString(task.beginnerHint),
          extensionHint: toNonEmptyString(task.extensionHint),
          reviewNotes: toNonEmptyString(task.reviewNotes)
        }))
      : []
  };

  return [
    "Use the following source context to write tight teacher notes that are worth reading.",
    "Select the details that help a teacher make fast, high-value interventions in class.",
    "Source context JSON:",
    JSON.stringify(context, null, 2)
  ].join("\n");
}

async function callOpenAi(payload: TeacherNotesRequest, env: Env): Promise<string> {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const model = env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(payload) }
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1600
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status} ${res.statusText}\n${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI API returned empty content");
  return content;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const requiredKey = env.AGENT_API_KEY?.trim();
    if (requiredKey) {
      const auth = request.headers.get("Authorization") ?? "";
      if (auth !== `Bearer ${requiredKey}`) {
        return errorResponse("Unauthorized", 401);
      }
    }

    let payload: TeacherNotesRequest;
    try {
      payload = (await request.json()) as TeacherNotesRequest;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const sessionName = toNonEmptyString(payload.sessionName);
    if (!sessionName) {
      return errorResponse("sessionName is required", 400);
    }

    let text: string;
    try {
      text = await callOpenAi({ ...payload, sessionName }, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message, 502);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return errorResponse("Model returned invalid JSON", 502);
    }

    const fallbackTaskTitles = Array.isArray(payload.taskContexts)
      ? payload.taskContexts
          .map((task) => toNonEmptyString(task.title))
          .filter((title): title is string => Boolean(title))
      : [];
    const fallbackObjectives = toStringArray(payload.objectiveHints, 3);
    const fallbackSoftware = toStringArray(payload.softwareHints, 8);
    const fallbackHardware = toStringArray(payload.hardwareHints, 10);
    const fallbackHighlights = toStringArray(payload.highlightAreaHints, 5);
    const fallbackIssues = sanitizeCommonIssues(payload.commonIssueHints, 8);

    const sessionObjective = toStringArray(parsed.sessionObjective, 3);
    const teacherFocus = toNonEmptyString(parsed.teacherFocus);
    const software = toStringArray(parsed.software, 8);
    const hardware = toStringArray(parsed.hardware, 10);
    const highlightAreas = toStringArray(parsed.highlightAreas, 5);
    const tasks = sanitizeTasks(parsed.tasks, fallbackTaskTitles, 8);
    const commonIssues = sanitizeCommonIssues(parsed.commonIssues, 8);
    const troubleshootingClose = toNonEmptyString(parsed.troubleshootingClose);

    if (
      sessionObjective.length === 0 &&
      !teacherFocus &&
      highlightAreas.length === 0 &&
      tasks.length === 0 &&
      commonIssues.length === 0
    ) {
      return errorResponse("Model returned no usable teacher notes content", 502);
    }

    return jsonResponse({
      sessionObjective: sessionObjective.length > 0 ? sessionObjective : fallbackObjectives,
      teacherFocus,
      software: software.length > 0 ? software : fallbackSoftware,
      hardware: hardware.length > 0 ? hardware : fallbackHardware,
      highlightAreas: highlightAreas.length > 0 ? highlightAreas : fallbackHighlights,
      tasks,
      commonIssues: commonIssues.length > 0 ? commonIssues : fallbackIssues,
      troubleshootingClose,
      source: {
        sessionName,
        generatedAtUtc: new Date().toISOString(),
        generator: "cloudflare-agent-teacher-notes"
      }
    });
  }
};
