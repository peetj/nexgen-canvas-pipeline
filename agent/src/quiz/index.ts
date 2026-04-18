type QuizRequest = {
  prompt: string;
  difficulty?: "easy" | "medium" | "hard" | "mixed";
  schemaVersion?: string;
  settings?: {
    questionCount?: number;
    choicesPerQuestion?: number;
    shuffleAnswers?: boolean;
    timeLimitMinutes?: number;
    allowedAttempts?: number;
  };
  yearLevel?: {
    min?: number;
    max?: number;
  };
};

type Env = {
  AGENT_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
};

type SanitizedQuestion = {
  id: "Q1" | "Q2" | "Q3" | "Q4" | "Q5";
  type: "multiple_choice";
  prompt: string;
  choices: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation?: string;
  difficulty?: "easy" | "medium" | "hard";
  outcomeTags?: string[];
};

const DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_QUESTION_COUNT = 5;
const DEFAULT_CHOICES_PER_QUESTION = 4;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

async function callOpenAi(prompt: string, env: Env): Promise<string> {
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
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.6,
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
  if (!content) {
    throw new Error("OpenAI API returned empty content");
  }
  return content;
}

function buildSystemPrompt(): string {
  return [
    "You are a quiz generator.",
    "Return ONLY valid JSON. No markdown, no code fences, no extra text.",
    "Use schemaVersion 'nexgen-quiz.v1'.",
    "All questions must be multiple_choice with exactly 4 choices.",
    "There must be exactly 5 questions with ids Q1..Q5.",
    "Use correctIndex 0..3 for the right answer.",
    "Vary the correct answer position across the quiz. Do not put every correct answer in the same slot.",
    "Keep prompts concise and age-appropriate.",
    "If unsure, keep description and tags short."
  ].join(" ");
}

function buildUserPrompt(
  payload: QuizRequest,
  yearLevel: { min: number; max: number },
  settings: { questionCount: number; choicesPerQuestion: number }
): string {
  const difficultyInstruction =
    payload.difficulty === "easy"
      ? "Set all questions to easy difficulty and keep distractors straightforward."
      : payload.difficulty === "medium"
        ? "Set all questions to medium difficulty with plausible distractors and moderate reasoning."
        : payload.difficulty === "hard"
          ? "Set all questions to hard difficulty with stronger distractors and deeper reasoning."
          : payload.difficulty === "mixed"
            ? "Use a deliberate mix of easy, medium, and hard questions across the quiz."
            : "Use your best judgment for a sensible spread of question difficulty.";

  return [
    `Prompt: ${payload.prompt}`,
    `Year level: ${yearLevel.min}-${yearLevel.max}.`,
    `Question count: ${settings.questionCount}.`,
    `Choices per question: ${settings.choicesPerQuestion}.`,
    `Shuffle answers: ${payload.settings?.shuffleAnswers === true ? "yes" : "no"}.`,
    `Difficulty preference: ${payload.difficulty ?? "unspecified"}.`,
    difficultyInstruction,
    "Include fields:",
    "schemaVersion, title, description, topic, tags, yearLevel, settings, questions, source.",
    "source.prompt should match the prompt.",
    "source.generator should be 'cloudflare-agent'.",
    "source.generatedAtUtc should be ISO8601 UTC."
  ].join(" ");
}

function normalizeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeChoice(value: unknown): string | undefined {
  const direct = toNonEmptyString(value);
  if (direct) return direct;
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return (
    toNonEmptyString(record.text) ??
    toNonEmptyString(record.answer_text) ??
    toNonEmptyString(record.label) ??
    toNonEmptyString(record.value)
  );
}

function sanitizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value) {
    const tag = toNonEmptyString(entry);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= 12) break;
  }
  return tags.length ? tags : undefined;
}

function normalizeDifficulty(value: unknown): "easy" | "medium" | "hard" | "mixed" | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "easy" ||
    normalized === "medium" ||
    normalized === "hard" ||
    normalized === "mixed"
  ) {
    return normalized;
  }
  return undefined;
}

function sanitizeQuestions(
  value: unknown,
  count: number,
  choicesPerQuestion: number
): SanitizedQuestion[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length < count) return null;
  const subset = value.slice(0, count);

  const questions = subset.map((raw, idx) => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const id = `Q${idx + 1}` as SanitizedQuestion["id"];
    const prompt = toNonEmptyString(record.prompt) ?? `Question ${idx + 1}`;

    const choicesRaw = Array.isArray(record.choices) ? record.choices : [];
    const choicesClean = choicesRaw
      .map((choice) => normalizeChoice(choice))
      .filter((choice): choice is string => Boolean(choice));
    if (choicesClean.length < choicesPerQuestion) {
      return null;
    }
    const choices = choicesClean.slice(0, choicesPerQuestion) as [
      string,
      string,
      string,
      string
    ];

    const correctIndexRaw = normalizeNumber(record.correctIndex, 0);
    const correctIndex = (correctIndexRaw >= 0 && correctIndexRaw <= 3
      ? correctIndexRaw
      : 0) as SanitizedQuestion["correctIndex"];

    const explanation = toNonEmptyString(record.explanation);
    const difficulty = toNonEmptyString(record.difficulty) as SanitizedQuestion["difficulty"] | undefined;
    const outcomeTags = sanitizeTags(record.outcomeTags);

    const question: SanitizedQuestion = {
      id,
      type: "multiple_choice",
      prompt,
      choices,
      correctIndex
    };
    if (explanation) question.explanation = explanation;
    if (difficulty === "easy" || difficulty === "medium" || difficulty === "hard") {
      question.difficulty = difficulty;
    }
    if (outcomeTags) question.outcomeTags = outcomeTags;

    return question;
  });

  if (questions.some((q) => q === null)) return null;
  return questions as SanitizedQuestion[];
}

function moveCorrectChoice(
  question: SanitizedQuestion,
  targetIndex: SanitizedQuestion["correctIndex"]
): SanitizedQuestion {
  if (question.correctIndex === targetIndex) {
    return question;
  }

  const choices = [...question.choices];
  const [correctChoice] = choices.splice(question.correctIndex, 1);
  choices.splice(targetIndex, 0, correctChoice);

  return {
    ...question,
    choices: choices as SanitizedQuestion["choices"],
    correctIndex: targetIndex
  };
}

function redistributeUniformCorrectIndexes(
  questions: SanitizedQuestion[],
  choicesPerQuestion: number
): SanitizedQuestion[] {
  if (questions.length < 2) return questions;

  const firstCorrectIndex = questions[0]?.correctIndex;
  if (firstCorrectIndex === undefined) return questions;
  if (!questions.every((question) => question.correctIndex === firstCorrectIndex)) {
    return questions;
  }

  return questions.map((question, idx) => {
    const targetIndex = ((firstCorrectIndex + idx + 1) % choicesPerQuestion) as SanitizedQuestion["correctIndex"];
    return moveCorrectChoice(question, targetIndex);
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return errorResponse("Method not allowed", 405);
    }

    const requiredKey = env.AGENT_API_KEY?.trim();
    if (requiredKey && requiredKey.length > 0) {
      const auth = request.headers.get("Authorization") ?? "";
      if (auth !== `Bearer ${requiredKey}`) {
        return errorResponse("Unauthorized", 401);
      }
    }

    let payload: QuizRequest;
    try {
      payload = (await request.json()) as QuizRequest;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    if (!payload || typeof payload.prompt !== "string" || payload.prompt.trim().length < 5) {
      return errorResponse("prompt is required", 400);
    }

    const schemaVersion = payload.schemaVersion ?? "nexgen-quiz.v1";
    const yearLevel = {
      min: normalizeNumber(payload.yearLevel?.min, 7),
      max: normalizeNumber(payload.yearLevel?.max, 10)
    };
    const requestedDifficulty = normalizeDifficulty(payload.difficulty);
    const settings = {
      questionCount: normalizeNumber(payload.settings?.questionCount, DEFAULT_QUESTION_COUNT),
      choicesPerQuestion: normalizeNumber(payload.settings?.choicesPerQuestion, DEFAULT_CHOICES_PER_QUESTION),
      shuffleAnswers: payload.settings?.shuffleAnswers === true
    };
    if (yearLevel.max < yearLevel.min) {
      return errorResponse("yearLevel.max must be >= yearLevel.min", 400);
    }
    if (payload.difficulty && !requestedDifficulty) {
      return errorResponse("difficulty must be one of easy, medium, hard, or mixed", 400);
    }

    let text: string;
    try {
      const prompt = buildUserPrompt(payload, yearLevel, settings);
      text = await callOpenAi(prompt, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResponse(message, 502);
    }
    const jsonText = extractJson(text);
    if (!jsonText) {
      return errorResponse("Model did not return JSON", 502);
    }

    let quiz: Record<string, unknown>;
    try {
      quiz = JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      return errorResponse("Model returned invalid JSON", 502);
    }

    const questions = sanitizeQuestions(quiz.questions, settings.questionCount, settings.choicesPerQuestion);
    if (!questions) {
      return errorResponse("Model returned invalid choices for one or more questions", 502);
    }
    const normalizedQuestions =
      requestedDifficulty && requestedDifficulty !== "mixed"
        ? questions.map((question) => ({
            ...question,
            difficulty: question.difficulty ?? requestedDifficulty
          }))
        : questions;
    const redistributedQuestions = redistributeUniformCorrectIndexes(
      normalizedQuestions,
      settings.choicesPerQuestion
    );

    const sanitized: Record<string, unknown> = {
      schemaVersion,
      title: toNonEmptyString(quiz.title) ?? "Generated Quiz",
      description: toNonEmptyString(quiz.description),
      topic: toNonEmptyString(quiz.topic),
      tags: sanitizeTags(quiz.tags),
      yearLevel,
      settings: {
        questionCount: settings.questionCount,
        choicesPerQuestion: settings.choicesPerQuestion,
        shuffleAnswers: settings.shuffleAnswers
      },
      questions: redistributedQuestions,
      source: {
        prompt: payload.prompt,
        generator: "cloudflare-agent",
        generatedAtUtc: new Date().toISOString()
      }
    };

    if (typeof quiz.source === "object" && quiz.source) {
      const source = quiz.source as Record<string, unknown>;
      sanitized.source = {
        prompt: toNonEmptyString(source.prompt) ?? payload.prompt,
        generator: toNonEmptyString(source.generator) ?? "cloudflare-agent",
        generatedAtUtc: toNonEmptyString(source.generatedAtUtc) ?? new Date().toISOString()
      };
    }

    return jsonResponse(sanitized);
  }
};
