type TodayIntroRequest = {
  sessionName: string;
  sessionTopic?: string;
  notesText?: string;
  taskLabels?: string[];
  modulePageTitles?: string[];
  fallbackSummaryParagraphs?: string[];
  paragraphCount?: 1 | 2;
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
  return trimmed.length ? trimmed : undefined;
}

function toStringArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const v = toNonEmptyString(item);
    if (!v) continue;
    out.push(v.replace(/\s+/g, " ").trim());
    if (out.length >= max) break;
  }
  return out;
}

function sanitizeParagraphs(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    const line = toNonEmptyString(raw);
    if (!line) continue;
    const cleaned = line.replace(/\s+/g, " ").trim();
    if (cleaned.length < 20) continue;
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

function buildSystemPrompt(): string {
  return [
    "You write student-facing lesson introductions for STEM sessions.",
    "Rewrite source notes into clear, engaging language for Years 7-10.",
    "Never copy teacher notes verbatim; improve wording and flow.",
    "Return ONLY valid JSON with keys: paragraphs (array), imagePrompt (string).",
    "paragraphs must contain 1-2 short paragraphs only, no markdown, no bullet points, no greeting."
  ].join(" ");
}

function buildUserPrompt(payload: TodayIntroRequest, paragraphCount: 1 | 2): string {
  const lines: string[] = [];
  lines.push(`Session name: ${payload.sessionName}`);
  if (payload.sessionTopic) lines.push(`Session topic: ${payload.sessionTopic}`);
  lines.push(`Paragraph count target: ${paragraphCount}`);

  const notes = toNonEmptyString(payload.notesText);
  if (notes) lines.push(`Teacher notes draft: ${notes}`);

  const taskLabels = toStringArray(payload.taskLabels, 10);
  if (taskLabels.length > 0) lines.push(`Task sequence: ${taskLabels.join(", ")}`);

  const modulePageTitles = toStringArray(payload.modulePageTitles, 12);
  if (modulePageTitles.length > 0) lines.push(`Related pages: ${modulePageTitles.join(", ")}`);

  const fallback = toStringArray(payload.fallbackSummaryParagraphs, 2);
  if (fallback.length > 0) lines.push(`Fallback summary: ${fallback.join(" ")}`);

  lines.push(
    "Also provide imagePrompt: one sentence for an inspiring classroom image aligned to the session."
  );

  return lines.join("\n");
}

async function callOpenAi(payload: TodayIntroRequest, paragraphCount: 1 | 2, env: Env): Promise<string> {
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
        { role: "user", content: buildUserPrompt(payload, paragraphCount) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
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

    let payload: TodayIntroRequest;
    try {
      payload = (await request.json()) as TodayIntroRequest;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const sessionName = toNonEmptyString(payload.sessionName);
    if (!sessionName) {
      return errorResponse("sessionName is required", 400);
    }
    const paragraphCount = payload.paragraphCount === 1 ? 1 : 2;

    let text: string;
    try {
      text = await callOpenAi({ ...payload, sessionName }, paragraphCount, env);
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

    const paragraphs = sanitizeParagraphs(parsed.paragraphs, paragraphCount);
    if (paragraphs.length === 0) {
      return errorResponse("Model did not return usable paragraphs", 502);
    }
    const imagePrompt = toNonEmptyString(parsed.imagePrompt);

    return jsonResponse({
      paragraphs,
      imagePrompt,
      source: {
        sessionName,
        generatedAtUtc: new Date().toISOString(),
        generator: "cloudflare-agent-today-intro"
      }
    });
  }
};
