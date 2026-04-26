import type { NexgenSurveyV1 } from "./types.js";

type CanvasSurveyQuestion =
  | {
      question_name: string;
      question_text: string;
      question_type: "multiple_choice_question";
      points_possible: number;
      answers: Array<{ answer_text: string; answer_weight: number }>;
    }
  | {
      question_name: string;
      question_text: string;
      question_type: "short_answer_question" | "essay_question" | "file_upload_question";
      points_possible: number;
    };

export function mapToCanvasSurvey(
  survey: NexgenSurveyV1,
  options?: { title?: string; published?: boolean }
): {
  canvasQuiz: {
    title: string;
    description?: string;
    quiz_type: "survey" | "graded_survey";
    published: boolean;
    shuffle_answers?: boolean;
  };
  canvasQuestions: CanvasSurveyQuestion[];
} {
  const canvasQuiz = {
    title: options?.title ?? survey.title,
    description: survey.description,
    quiz_type: survey.settings?.surveyType ?? "survey",
    published: options?.published ?? false,
    shuffle_answers: survey.settings?.shuffleAnswers === true ? true : undefined
  };

  const canvasQuestions = survey.questions.map((question) => {
    if (question.type === "multiple_choice_question") {
      const answers = question.choices.map((choice) => ({
        answer_text: choice,
        // Surveys do not grade responses; all options are neutral.
        answer_weight: 0
      }));

      if (survey.settings?.shuffleAnswers === true) {
        shuffleInPlace(answers);
      }

      return {
        question_name: question.id,
        question_text: question.prompt,
        question_type: "multiple_choice_question" as const,
        points_possible: 0,
        answers
      };
    }

    return {
      question_name: question.id,
      question_text: question.prompt,
      question_type: question.type,
      points_possible: 0
    };
  });

  return { canvasQuiz, canvasQuestions };
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}
