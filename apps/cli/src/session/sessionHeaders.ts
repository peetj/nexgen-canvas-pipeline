import { CanvasClient } from "../canvas/canvasClient.js";

type ModuleSummary = { id: number; name: string };

type SessionHeaderConfig = {
  sessionNumberPad: number;
  headersTemplate: string[];
};

const TOKEN_PADDED = "{nn}";
const TOKEN_RAW = "{n}";

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function buildSessionHeaderTitles(
  sessionNumber: number,
  config: SessionHeaderConfig
): string[] {
  if (!Number.isInteger(sessionNumber) || sessionNumber <= 0) {
    throw new Error("Session number must be a positive integer.");
  }
  const templates = config.headersTemplate;
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error("Session header templates are missing.");
  }
  const pad = Math.max(1, Math.trunc(config.sessionNumberPad || 2));
  const padded = String(sessionNumber).padStart(pad, "0");
  const raw = String(sessionNumber);

  return templates.map((title) =>
    title.replaceAll(TOKEN_PADDED, padded).replaceAll(TOKEN_RAW, raw)
  );
}

export async function resolveModuleByName(
  client: CanvasClient,
  courseId: number,
  moduleName: string
): Promise<ModuleSummary> {
  const target = normalizeName(moduleName);
  if (!target) {
    throw new Error("Module name is required.");
  }

  const modules = await client.listModules(courseId, moduleName);
  const matches = modules.filter((m) => normalizeName(m.name) === target);

  if (matches.length === 1) return matches[0];

  if (matches.length > 1) {
    const names = matches.map((m) => m.name).join(", ");
    throw new Error(`Multiple modules matched "${moduleName}": ${names}`);
  }

  if (modules.length === 0) {
    throw new Error(`No modules found matching "${moduleName}".`);
  }

  const suggestions = modules.map((m) => m.name).join(", ");
  throw new Error(`No exact module name match for "${moduleName}". Closest matches: ${suggestions}`);
}
