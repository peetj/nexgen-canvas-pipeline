export type NexgenSurveyV1 = {
  schemaVersion: "nexgen-survey.v1";
  title: string;
  description?: string;
  settings?: {
    surveyType?: "survey" | "graded_survey";
    shuffleAnswers?: boolean;
  };
  questions: Array<
    | {
        id: string;
        type: "multiple_choice_question";
        prompt: string;
        choices: string[];
      }
    | {
        id: string;
        type: "short_answer_question" | "essay_question" | "file_upload_question";
        prompt: string;
      }
  >;
  source?: {
    prompt?: string;
    generator?: string;
    generatedAtUtc?: string;
  };
};
