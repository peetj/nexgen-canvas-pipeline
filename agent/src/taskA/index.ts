type TaskARequest = {
  sessionName: string;
  sessionTopic?: string;
  taskTitle?: string;
  philosophyText?: string;
  notesText?: string;
  mediaLabels?: string[];
};

type Env = {
  AGENT_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
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
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const normalized = toNonEmptyString(item);
    if (!normalized) continue;
    out.push(normalized.replace(/\s+/g, " ").trim());
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const line = toNonEmptyString(raw);
    if (!line) continue;
    const cleaned = line.replace(/\s+/g, " ").trim();
    if (cleaned.length < 10) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function buildSystemPrompt(): string {
  return [
    "You produce student-facing structure for STEM Task A pages.",
    "Task A is the foundation task: clear, safe, and confidence-building.",
    "Treat notesText as authoring instructions to interpret, not text to copy verbatim.",
    "Return ONLY valid JSON with keys: overview, learningGoals, safetyNotes, taskBodyMarkdown.",
    "overview: 1 short paragraph, plain text.",
    "learningGoals: array of 2-5 short statements.",
    "safetyNotes: array of 0-4 short checks.",
    "taskBodyMarkdown: student-facing markdown instructions (3-6 short sections).",
    "Use direct student language and include practical step-by-step guidance.",
    "Never include meta-authoring text like 'add image' or 'explain this task'.",
    "Do not use markdown or numbering inside overview/learningGoals/safetyNotes values."
  ].join(" ");
}

function buildUserPrompt(payload: TaskARequest): string {
  const lines: string[] = [];
  lines.push(`Session name: ${payload.sessionName}`);
  if (payload.sessionTopic) lines.push(`Session topic: ${payload.sessionTopic}`);
  if (payload.taskTitle) lines.push(`Task title: ${payload.taskTitle}`);
  if (payload.philosophyText) lines.push(`Task A philosophy: ${payload.philosophyText}`);
  if (payload.notesText) lines.push(`Task notes draft: ${payload.notesText}`);
  const mediaLabels = toStringArray(payload.mediaLabels, 12);
  if (mediaLabels.length > 0) {
    lines.push(`Media/context hints: ${mediaLabels.join(", ")}`);
  }
  return lines.join("\n");
}

async function callOpenAi(payload: TaskARequest, env: Env): Promise<string> {
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
      temperature: 0.6,
      max_tokens: 700
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

    let payload: TaskARequest;
    try {
      payload = (await request.json()) as TaskARequest;
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

    const overview = toNonEmptyString(parsed.overview);
    const learningGoals = sanitizeList(parsed.learningGoals, 5);
    const safetyNotes = sanitizeList(parsed.safetyNotes, 4);
    const taskBodyMarkdown = toNonEmptyString(parsed.taskBodyMarkdown);

    if (!overview && learningGoals.length === 0 && safetyNotes.length === 0 && !taskBodyMarkdown) {
      return errorResponse("Model returned no usable task content", 502);
    }

    return jsonResponse({
      overview,
      learningGoals,
      safetyNotes,
      taskBodyMarkdown,
      source: {
        sessionName,
        generatedAtUtc: new Date().toISOString(),
        generator: "cloudflare-agent-task-a"
      }
    });
  }
};
