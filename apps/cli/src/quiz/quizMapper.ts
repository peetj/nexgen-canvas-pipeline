import type { NexgenQuizV1 } from "./types.js";

export function mapToCanvasQuiz(quiz: NexgenQuizV1): {
  canvasQuiz: {
    title: string;
    description?: string;
    published: boolean;
    time_limit?: number;
    allowed_attempts?: number;
  };
  canvasQuestions: Array<{
    question_name: string;
    question_text: string;
    question_type: "multiple_choice_question";
    points_possible: number;
    answers: Array<{ answer_text: string; answer_weight: number }>;
  }>;
} {
  const canvasQuiz = {
    title: quiz.title,
    description: quiz.description,
    published: false,
    time_limit: quiz.settings.timeLimitMinutes ?? undefined,
    allowed_attempts: quiz.settings.allowedAttempts ?? 1
  };

  const canvasQuestions = quiz.questions.map((q) => {
    const answers = q.choices.map((text, idx) => {
      return {
        answer_text: text,
        answer_weight: idx === q.correctIndex ? 100 : 0
      };
    });

    return {
      question_name: q.id,
      question_text: q.prompt,
      question_type: "multiple_choice_question" as const,
      points_possible: 1,
      answers
    };
  });

  return { canvasQuiz, canvasQuestions };
}
