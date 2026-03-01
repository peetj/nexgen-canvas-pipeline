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
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value.trim();
}

export const env = {
  canvasBaseUrl: mustGet("CANVAS_BASE_URL"),
  canvasApiToken: mustGet("CANVAS_API_TOKEN")
};
