import { env } from "../../env.js";

export type TodayIntroAgentInput = {
  sessionName: string;
  sessionTopic: string;
  notesText?: string;
  taskLabels?: string[];
  modulePageTitles?: string[];
  fallbackSummaryParagraphs?: string[];
  paragraphCount?: 1 | 2;
};

export type TodayIntroAgentOutput = {
  paragraphs: string[];
  imagePrompt?: string;
};

function normalizeParagraphs(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (cleaned.length < 20) continue;
    out.push(cleaned);
    if (out.length >= max) break;
  }
  return out;
}

export async function generateTodayIntroFromAgent(
  input: TodayIntroAgentInput
): Promise<TodayIntroAgentOutput> {
  if (!env.todayIntroAgentUrl) {
    throw new Error(
      "Today intro agent URL is not set. Configure CANVAS_AGENT_URL (recommended) or TODAY_INTRO_AGENT_URL."
    );
  }

  const res = await fetch(env.todayIntroAgentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.todayIntroAgentApiKey ? { "Authorization": `Bearer ${env.todayIntroAgentApiKey}` } : {})
    },
    body: JSON.stringify({
      sessionName: input.sessionName,
      sessionTopic: input.sessionTopic,
      notesText: input.notesText,
      taskLabels: input.taskLabels ?? [],
      modulePageTitles: input.modulePageTitles ?? [],
      fallbackSummaryParagraphs: input.fallbackSummaryParagraphs ?? [],
      paragraphCount: input.paragraphCount ?? 2
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (/prompt is required/i.test(text)) {
      throw new Error(
        "Today intro agent endpoint is not available at the configured URL. " +
        "Deploy/update the canvas agent worker with the /today-intro route."
      );
    }
    throw new Error(`Today intro agent error ${res.status} ${res.statusText}\n${text}`);
  }

  const body = (await res.json()) as {
    paragraphs?: unknown;
    imagePrompt?: unknown;
  };

  const paragraphs = normalizeParagraphs(body.paragraphs, input.paragraphCount ?? 2);
  if (paragraphs.length === 0) {
    throw new Error("Today intro agent returned no usable paragraphs.");
  }

  const imagePrompt =
    typeof body.imagePrompt === "string" && body.imagePrompt.trim().length > 0
      ? body.imagePrompt.trim()
      : undefined;

  return { paragraphs, imagePrompt };
}
