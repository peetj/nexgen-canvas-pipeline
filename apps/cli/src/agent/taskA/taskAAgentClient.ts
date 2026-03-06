import { env } from "../../env.js";

export type TaskAAgentInput = {
  sessionName: string;
  sessionTopic: string;
  taskTitle: string;
  philosophyText: string;
  notesText?: string;
  mediaLabels?: string[];
};

export type TaskAAgentOutput = {
  overview?: string;
  learningGoals: string[];
  safetyNotes: string[];
  taskBodyMarkdown?: string;
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

export async function generateTaskAFromAgent(input: TaskAAgentInput): Promise<TaskAAgentOutput> {
  if (!env.taskAAgentUrl) {
    throw new Error(
      "Task A agent URL is not set. Configure CANVAS_AGENT_URL (recommended) or TASK_A_AGENT_URL."
    );
  }

  const res = await fetch(env.taskAAgentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.taskAAgentApiKey ? { "Authorization": `Bearer ${env.taskAAgentApiKey}` } : {})
    },
    body: JSON.stringify({
      sessionName: input.sessionName,
      sessionTopic: input.sessionTopic,
      taskTitle: input.taskTitle,
      philosophyText: input.philosophyText,
      notesText: input.notesText,
      mediaLabels: input.mediaLabels ?? []
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Task A agent error ${res.status} ${res.statusText}\n${text}`);
  }

  const body = (await res.json()) as {
    overview?: unknown;
    learningGoals?: unknown;
    safetyNotes?: unknown;
    taskBodyMarkdown?: unknown;
  };

  return {
    overview: normalizeSingleLine(body.overview),
    learningGoals: normalizeStringArray(body.learningGoals, 6),
    safetyNotes: normalizeStringArray(body.safetyNotes, 5),
    taskBodyMarkdown:
      typeof body.taskBodyMarkdown === "string" && body.taskBodyMarkdown.trim().length > 0
        ? body.taskBodyMarkdown.trim()
        : undefined
  };
}
