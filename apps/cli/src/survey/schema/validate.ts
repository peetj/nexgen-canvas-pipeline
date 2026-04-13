import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../../schemas/nexgen-survey.v1.schema.json" with { type: "json" };
import type { NexgenSurveyV1 } from "../types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true
});

addFormats(ajv);

const validateFn = ajv.compile(schema);

export function validateNexgenSurvey(input: unknown): NexgenSurveyV1 {
  const ok = validateFn(input);
  if (!ok) {
    const errors = validateFn.errors?.map((e) => {
      const path = e.instancePath || "/";
      const msg = e.message || "Invalid";
      return `${path} ${msg}`;
    }) ?? ["Unknown validation error"];
    throw new Error(`Survey JSON failed schema validation:\n- ${errors.join("\n- ")}`);
  }

  const survey = input as NexgenSurveyV1;
  const ids = new Set(survey.questions.map((x) => x.id));
  if (ids.size !== survey.questions.length) {
    throw new Error("Survey question ids must be unique.");
  }

  return survey;
}
