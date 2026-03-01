import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveEnvPath(): string | undefined {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(moduleDir, "..");
  const workspaceRoot = path.resolve(appRoot, "..", "..");

  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(appRoot, ".env"),
    path.resolve(workspaceRoot, ".env")
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

const resolvedEnvPath = resolveEnvPath();
if (resolvedEnvPath) {
  dotenv.config({ path: resolvedEnvPath });
} else {
  dotenv.config();
}

function mustGet(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

function getOptional(name: string): string | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}

function isPlaceholderAgentUrl(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.includes("<your-worker>") ||
    lower.includes("your-worker.your-domain.workers.dev")
  );
}

function getOptionalUrl(name: string): string | undefined {
  const value = getOptional(name);
  if (!value) return undefined;
  if (isPlaceholderAgentUrl(value)) return undefined;
  return value;
}

function deriveAgentRouteUrl(
  baseUrl: string | undefined,
  routePath: "/generate-quiz" | "/today-intro"
): string | undefined {
  if (!baseUrl) return undefined;
  try {
    const u = new URL(baseUrl);
    const trimmedPath = u.pathname.replace(/\/+$/, "");
    const normalized = trimmedPath || "/";
    if (normalized.endsWith(routePath)) {
      u.pathname = normalized;
      return u.toString();
    }

    if (normalized.endsWith("/generate-quiz")) {
      u.pathname = `${normalized.slice(0, -"/generate-quiz".length)}${routePath}`;
      return u.toString();
    }
    if (normalized.endsWith("/generate")) {
      u.pathname = `${normalized.slice(0, -"/generate".length)}${routePath}`;
      return u.toString();
    }
    if (normalized.endsWith("/today-intro")) {
      u.pathname = `${normalized.slice(0, -"/today-intro".length)}${routePath}`;
      return u.toString();
    }

    u.pathname = normalized === "/" ? routePath : `${normalized}${routePath}`;
    return u.toString();
  } catch {
    return undefined;
  }
}

const canvasAgentUrl = getOptionalUrl("CANVAS_AGENT_URL");
const canvasAgentApiKey = getOptional("CANVAS_AGENT_API_KEY");
const legacyQuizAgentUrl = getOptionalUrl("QUIZ_AGENT_URL");
const legacyTodayIntroAgentUrl = getOptionalUrl("TODAY_INTRO_AGENT_URL");

const quizAgentUrl =
  deriveAgentRouteUrl(legacyQuizAgentUrl, "/generate-quiz") ??
  deriveAgentRouteUrl(canvasAgentUrl, "/generate-quiz");
const quizAgentApiKey = getOptional("QUIZ_AGENT_API_KEY") ?? canvasAgentApiKey;

const todayIntroAgentUrl =
  legacyTodayIntroAgentUrl ??
  deriveAgentRouteUrl(canvasAgentUrl, "/today-intro") ??
  deriveAgentRouteUrl(quizAgentUrl, "/today-intro");
const todayIntroAgentApiKey =
  getOptional("TODAY_INTRO_AGENT_API_KEY") ??
  canvasAgentApiKey ??
  quizAgentApiKey;

export const env = {
  canvasBaseUrl: mustGet("CANVAS_BASE_URL"),
  canvasApiToken: mustGet("CANVAS_API_TOKEN"),
  canvasTestCourseId: Number(mustGet("CANVAS_TEST_COURSE_ID")),
  canvasAgentUrl,
  canvasAgentApiKey,
  quizAgentUrl,
  quizAgentApiKey,
  todayIntroAgentUrl,
  todayIntroAgentApiKey
};
