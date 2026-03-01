import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PipelineConfig = {
  quiz: {
    schemaVersion: string;
    defaults: {
      questionCount: number;
      choicesPerQuestion: number;
      allowedAttempts: number;
    };
  };
  sessions: {
    sessionNumberPad: number;
    headersTemplate: string[];
  };
};

const DEFAULT_CONFIG: PipelineConfig = {
  quiz: {
    schemaVersion: "nexgen-quiz.v1",
    defaults: {
      questionCount: 5,
      choicesPerQuestion: 4,
      allowedAttempts: 1
    }
  },
  sessions: {
    sessionNumberPad: 2,
    headersTemplate: [
      "Teachers Notes",
      "What we are doing Today",
      "QUIZ",
      "Session {nn}: Task A",
      "Session {nn}: Task B",
      "Session {nn}: Task C"
    ]
  }
};

function mergeConfig(input: Partial<PipelineConfig>): PipelineConfig {
  const quizDefaults: Partial<PipelineConfig["quiz"]["defaults"]> = input.quiz?.defaults ?? {};
  return {
    quiz: {
      schemaVersion: input.quiz?.schemaVersion ?? DEFAULT_CONFIG.quiz.schemaVersion,
      defaults: {
        questionCount: quizDefaults.questionCount ?? DEFAULT_CONFIG.quiz.defaults.questionCount,
        choicesPerQuestion: quizDefaults.choicesPerQuestion ?? DEFAULT_CONFIG.quiz.defaults.choicesPerQuestion,
        allowedAttempts: quizDefaults.allowedAttempts ?? DEFAULT_CONFIG.quiz.defaults.allowedAttempts
      }
    },
    sessions: {
      sessionNumberPad: input.sessions?.sessionNumberPad ?? DEFAULT_CONFIG.sessions.sessionNumberPad,
      headersTemplate: Array.isArray(input.sessions?.headersTemplate)
        ? input.sessions!.headersTemplate
        : DEFAULT_CONFIG.sessions.headersTemplate
    }
  };
}

export async function loadConfig(): Promise<PipelineConfig> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(moduleDir, "..");
  const workspaceRoot = path.resolve(appRoot, "..", "..");
  const candidates = [
    path.resolve(process.cwd(), "config", "nexgen-canvas-pipeline.config.json"),
    path.resolve(appRoot, "config", "nexgen-canvas-pipeline.config.json"),
    path.resolve(workspaceRoot, "config", "nexgen-canvas-pipeline.config.json")
  ];

  for (const configPath of candidates) {
    try {
      const raw = await fs.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<PipelineConfig>;
      return mergeConfig(parsed ?? {});
    } catch (err) {
      const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") {
        continue;
      }
      throw err;
    }
  }

  return DEFAULT_CONFIG;
}
