export type NexgenQuizV1 = {
  schemaVersion: "nexgen-quiz.v1";
  title: string;
  description?: string;
  topic?: string;
  tags?: string[];
  yearLevel: { min: 7 | 8 | 9 | 10; max: 7 | 8 | 9 | 10 };
  settings: {
    questionCount: 5;
    choicesPerQuestion: 4;
    shuffleAnswers?: boolean;
    timeLimitMinutes?: number;
    allowedAttempts?: number;
  };
  questions: Array<{
    id: "Q1" | "Q2" | "Q3" | "Q4" | "Q5";
    type: "multiple_choice";
    prompt: string;
    choices: [string, string, string, string];
    correctIndex: 0 | 1 | 2 | 3;
    explanation?: string;
    difficulty?: "easy" | "medium" | "hard";
    outcomeTags?: string[];
  }>;
  source?: {
    prompt?: string;
    generator?: string;
    generatedAtUtc?: string;
  };
};
