import {
  buildTeacherNotesPromptGuidance,
  type TeacherNotesDomainKey
} from "../../../apps/cli/src/session/teacherNotesContract.ts";

type TeacherNotesTaskContext = {
  title: string;
  pageTitles?: string[];
  outcomeHint?: string;
  pageSummaries?: string[];
  keyPointHints?: string[];
  reinforceHints?: string[];
};

type TeacherNotesSourcePage = {
  title?: string;
  bodyText?: string;
};

type TeacherNotesRequest = {
  sessionName: string;
  pageTitle?: string;
  sourcePages?: TeacherNotesSourcePage[];
  quizTitle?: string;
  quizQuestionStems?: string[];
  sessionOverview?: string;
  modulePageTitles?: string[];
  contextKeywords?: string[];
  detectedDomains?: TeacherNotesDomainKey[];
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
  keyPoints: string[];
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

function sanitizeSourcePages(value: unknown, max: number): Array<{ title?: string; bodyText?: string }> {
  if (!Array.isArray(value)) return [];
  const out: Array<{ title?: string; bodyText?: string }> = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const title = toNonEmptyString(record.title);
    const bodyText = toNonEmptyString(record.bodyText);
    if (!title && !bodyText) continue;
    out.push({
      title,
      bodyText: bodyText ? bodyText.slice(0, 8000) : undefined
    });
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

    const keyPoints = toStringArray(record.keyPoints, 5);
    const reinforce = toStringArray(record.reinforce, 5);
    const outcome = toNonEmptyString(record.outcome);

    if (!outcome && keyPoints.length === 0 && reinforce.length === 0) {
      continue;
    }

    out.push({
      title,
      outcome,
      keyPoints: keyPoints.length > 0 ? keyPoints : reinforce
    });

    if (out.length >= max) break;
  }
  return out;
}

function mergeFallbackLines(primary: string[], fallback: string[], min: number, max: number): string[] {
  const out = [...primary];
  const seen = new Set(out.map((item) => item.toLowerCase()));
  for (const item of fallback) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out.slice(0, Math.max(min, Math.min(max, out.length)));
}

function mergeFallbackIssues(
  primary: Array<{ issue: string; solution: string }>,
  fallback: Array<{ issue: string; solution: string }>,
  min: number,
  max: number
): Array<{ issue: string; solution: string }> {
  const out = [...primary];
  const seen = new Set(out.map((item) => item.issue.toLowerCase()));
  for (const item of fallback) {
    const key = item.issue.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out.slice(0, Math.max(min, Math.min(max, out.length)));
}

function buildSystemPrompt(): string {
  return [
    "You write canonical Teacher Notes pages for STEM project sessions.",
    "Audience: busy classroom teachers who need sharp, useful notes before and during the lesson.",
    "Primary question: how can the teacher maximise help to students to build an effective project?",
    "The page structure is fixed. You are filling sections, not inventing a new format.",
    "Each section has a specific meaning.",
    "Main Session Objective: exactly 1 sentence only, student-facing only, beginning with 'Students will' or 'Students can'. No teacher advice here.",
    "Main Session Objective should usually come from the Introduction page rather than becoming a checklist of every task.",
    "Teacher Focus: one sentence immediately after the objective. It should capture the biggest student mistakes or quality checks the teacher should watch for in this session.",
    "Components & Software Required: include only software that is genuinely needed in the tasks. Do not list 'Serial Monitor' as software because it is part of Arduino IDE, not separate software.",
    "Hardware should be grounded in the parts lists from the task pages, especially Task A and Task B where available.",
    "Do not include a Teacher Highlight Areas section or anything equivalent.",
    "Task-by-Task Guidance: for each task, give a short outcome and a keyPoints array. Do not return golden nuggets, differentiation, beginner, or extension fields.",
    "Task titles must follow the format 'Task X - <task title>'.",
    "Task outcomes must describe the actual student result for that task. Never write 'Complete the activities in...'.",
    "Key points must be concrete watch-fors, checks, or teacher guidance moves drawn from that task's evidence.",
    "Most Common Issues: observable student failure patterns or misconceptions paired with the fastest useful session-specific solution.",
    "Do not leak soldering, wiring, or coding issues into a session unless the supplied evidence clearly shows that work happening in this session.",
    "Prefer observable warning signs, preventative checks, and practical teacher moves over generic pedagogy.",
    "Do not write filler, motivational language, or broad advice that could fit any session.",
    "Do not copy page summaries verbatim.",
    "A strong line should sound clearly tied to this session and would need editing before reuse in another session.",
    "Evaluate the supplied sourcePages and quizQuestionStems as the source of truth for what is actually in the session.",
    "Use task titles, task order, summaries, hints, and context keywords only as navigation aids, not as objectives.",
    "Treat contractPromptRules, domainGuidance, and genericRejects in the supplied context as binding instructions.",
    "If a category is weakly supported, return fewer items instead of padding.",
    "Reject generic lines like 'encourage independence' unless they are anchored to a concrete classroom move in this session.",
    "Use Australian spelling where natural.",
    "Return ONLY valid JSON with keys: sessionObjective, teacherFocus, software, hardware, tasks, commonIssues.",
    "sessionObjective: array containing exactly 1 string.",
    "teacherFocus: one string.",
    "software: array of 0-6 strings.",
    "hardware: array of 0-12 strings.",
    "tasks: array matching the supplied task order where possible.",
    "tasks[].outcome: one short sentence.",
    "tasks[].keyPoints: array of 2-5 concrete teacher key points.",
    "commonIssues: array of 2-6 objects with keys issue and solution.",
    "commonIssues[].issue: an observable failure pattern or misconception.",
    "commonIssues[].solution: the fastest useful teacher intervention or check.",
    "No markdown, no code fences, no extra text."
  ].join(" ");
}

function buildUserPrompt(payload: TeacherNotesRequest): string {
  const promptGuidance = buildTeacherNotesPromptGuidance(
    toStringArray(payload.detectedDomains, 8).filter(
      (value): value is TeacherNotesDomainKey => value in {
        demo_orientation: true,
        software_setup: true,
        cad_3d: true,
        soldering: true,
        wiring_electronics: true,
        coding_debugging: true,
        mechanical_build: true,
        theory_concepts: true
      }
    )
  );
  const context = {
    sessionName: payload.sessionName,
    pageTitle: toNonEmptyString(payload.pageTitle),
    sourcePages: sanitizeSourcePages(payload.sourcePages, 10),
    quizTitle: toNonEmptyString(payload.quizTitle),
    quizQuestionStems: toStringArray(payload.quizQuestionStems, 12),
    sessionOverview: toNonEmptyString(payload.sessionOverview),
    modulePageTitles: toStringArray(payload.modulePageTitles, 12),
    contextKeywords: toStringArray(payload.contextKeywords, 24),
    detectedDomains: promptGuidance.domains,
    contractPromptRules: promptGuidance.globalRules,
    domainGuidance: promptGuidance.domainRules,
    genericRejects: promptGuidance.genericRejects,
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
          keyPointHints: toStringArray(task.keyPointHints, 6).length > 0
            ? toStringArray(task.keyPointHints, 6)
            : toStringArray(task.reinforceHints, 6)
        }))
      : []
  };

  return [
    "Write tight, teacher-facing notes from the following session evidence.",
    "Stay faithful to the fixed structure and section meanings.",
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
      max_tokens: 2200
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
    const fallbackSoftware = toStringArray(payload.softwareHints, 8);
    const fallbackHardware = toStringArray(payload.hardwareHints, 10);
    const fallbackHighlights = toStringArray(payload.highlightAreaHints, 5);
    const fallbackIssues = sanitizeCommonIssues(payload.commonIssueHints, 8).map((item) => ({
      issue: item.issue,
      solution: item.teacherMove
    }));

    const sessionObjective = toStringArray(parsed.sessionObjective, 3);
    const teacherFocus = toNonEmptyString(parsed.teacherFocus);
    const software = toStringArray(parsed.software, 8);
    const hardware = toStringArray(parsed.hardware, 10);
    const tasks = sanitizeTasks(parsed.tasks, fallbackTaskTitles, 8);
    const commonIssues = sanitizeCommonIssues(parsed.commonIssues, 8).map((item) => ({
      issue: item.issue,
      solution: item.teacherMove
    }));

    if (
      sessionObjective.length === 0 &&
      !teacherFocus &&
      tasks.length === 0 &&
      commonIssues.length === 0
    ) {
      return errorResponse("Model returned no usable teacher notes content", 502);
    }

    const resolvedIssues = mergeFallbackIssues(commonIssues, fallbackIssues, 2, 6);

    return jsonResponse({
      sessionObjective,
      teacherFocus: teacherFocus ?? fallbackHighlights[0],
      software: software.length > 0 ? software : fallbackSoftware,
      hardware: hardware.length > 0 ? hardware : fallbackHardware,
      tasks,
      commonIssues: resolvedIssues,
      source: {
        sessionName,
        generatedAtUtc: new Date().toISOString(),
        generator: "cloudflare-agent-teacher-notes"
      }
    });
  }
};
