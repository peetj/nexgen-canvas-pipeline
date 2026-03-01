import { env } from "../../env.js";

export async function generateQuizFromAgent(prompt: string): Promise<unknown> {
  if (!env.quizAgentUrl) {
    throw new Error("QUIZ_AGENT_URL is not set. For now use --from-file.");
  }

  const res = await fetch(env.quizAgentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.quizAgentApiKey ? { "Authorization": `Bearer ${env.quizAgentApiKey}` } : {})
    },
    body: JSON.stringify({
      prompt,
      schemaVersion: "nexgen-quiz.v1",
      settings: { questionCount: 5, choicesPerQuestion: 4 },
      yearLevel: { min: 7, max: 10 }
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Quiz agent error ${res.status} ${res.statusText}\n${text}`);
  }

  return res.json();
}
