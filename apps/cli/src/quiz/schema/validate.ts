import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../../schemas/nexgen-quiz.v1.schema.json" with { type: "json" };
import type { NexgenQuizV1 } from "../types.js";

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  $data: true
});

addFormats(ajv);

const validateFn = ajv.compile(schema);

export function validateNexgenQuiz(input: unknown): NexgenQuizV1 {
  const ok = validateFn(input);
  if (!ok) {
    const errors = validateFn.errors?.map(e => {
      const path = e.instancePath || "/";
      const msg = e.message || "Invalid";
      return `${path} ${msg}`;
    }) ?? ["Unknown validation error"];
    throw new Error(`Quiz JSON failed schema validation:\n- ${errors.join("\n- ")}`);
  }

  const q = input as NexgenQuizV1;

  // Extra guardrails with clear errors
  if (q.yearLevel.max < q.yearLevel.min) {
    throw new Error(`yearLevel.max must be >= yearLevel.min (got ${q.yearLevel.min} to ${q.yearLevel.max})`);
  }

  // Ensure ids are unique
  const ids = new Set(q.questions.map(x => x.id));
  if (ids.size !== q.questions.length) throw new Error("Question ids must be unique (Q1..Q5).");

  return q;
}
