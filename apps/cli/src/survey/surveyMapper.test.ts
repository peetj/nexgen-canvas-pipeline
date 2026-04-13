import test from "node:test";
import assert from "node:assert/strict";
import { validateNexgenSurvey } from "./schema/validate.js";
import { mapToCanvasSurvey } from "./surveyMapper.js";

test("validateNexgenSurvey accepts file upload and short answer questions", () => {
  const survey = validateNexgenSurvey({
    schemaVersion: "nexgen-survey.v1",
    title: "Weekly Check-In",
    settings: {
      surveyType: "survey"
    },
    questions: [
      {
        id: "Q1",
        type: "multiple_choice_question",
        prompt: "How did today's session feel?",
        choices: ["Very confusing", "Very clear"]
      },
      {
        id: "Q2",
        type: "short_answer_question",
        prompt: "Name one thing that you learned today."
      },
      {
        id: "Q3",
        type: "file_upload_question",
        prompt: "Upload an image that captured the essence of your session."
      }
    ]
  });

  assert.equal(survey.questions.length, 3);
});

test("mapToCanvasSurvey emits neutral multiple choice answers and file upload questions", () => {
  const mapped = mapToCanvasSurvey(
    validateNexgenSurvey({
      schemaVersion: "nexgen-survey.v1",
      title: "Weekly Check-In",
      settings: {
        surveyType: "survey",
        shuffleAnswers: false
      },
      questions: [
        {
          id: "Q1",
          type: "multiple_choice_question",
          prompt: "How did today's session feel?",
          choices: ["Very confusing", "Very clear"]
        },
        {
          id: "Q2",
          type: "file_upload_question",
          prompt: "Upload an image that captured the essence of your session."
        }
      ]
    }),
    { title: "Weekly Check-In-Session 01" }
  );

  assert.equal(mapped.canvasQuiz.title, "Weekly Check-In-Session 01");
  assert.equal(mapped.canvasQuiz.quiz_type, "survey");
  assert.equal(mapped.canvasQuestions[0].question_type, "multiple_choice_question");
  assert.deepEqual((mapped.canvasQuestions[0] as { answers: Array<{ answer_weight: number }> }).answers, [
    { answer_text: "Very confusing", answer_weight: 0 },
    { answer_text: "Very clear", answer_weight: 0 }
  ]);
  assert.equal(mapped.canvasQuestions[1].question_type, "file_upload_question");
});
