import { env } from "../../env.js";

export type QuizDifficulty = "easy" | "medium" | "hard" | "mixed";

export async function generateQuizFromAgent(
  prompt: string,
  options?: { difficulty?: QuizDifficulty }
): Promise<unknown> {
  if (!env.quizAgentUrl) {
    throw new Error(
      "Quiz agent URL is not set. Configure CANVAS_AGENT_URL (recommended) or QUIZ_AGENT_URL."
    );
  }

  const res = await fetch(env.quizAgentUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(env.quizAgentApiKey ? { "Authorization": `Bearer ${env.quizAgentApiKey}` } : {})
    },
    body: JSON.stringify({
      prompt,
      difficulty: options?.difficulty,
      schemaVersion: "nexgen-quiz.v1",
      settings: { questionCount: 5, choicesPerQuestion: 4, shuffleAnswers: true },
      yearLevel: { min: 7, max: 10 }
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Quiz agent error ${res.status} ${res.statusText}\n${text}`);
  }

  return res.json();
}
