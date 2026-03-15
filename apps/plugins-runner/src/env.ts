import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type CanvasEnv = {
  canvasBaseUrl: string;
  canvasApiToken: string;
};

let dotenvLoaded = false;

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

function ensureDotenvLoaded(): void {
  if (dotenvLoaded) {
    return;
  }

  const resolvedEnvPath = resolveEnvPath();
  if (resolvedEnvPath) {
    dotenv.config({ path: resolvedEnvPath });
  } else {
    dotenv.config();
  }

  dotenvLoaded = true;
}

function mustGet(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value.trim();
}

export function getCanvasEnv(): CanvasEnv {
  ensureDotenvLoaded();
  return {
    canvasBaseUrl: mustGet("CANVAS_BASE_URL"),
    canvasApiToken: mustGet("CANVAS_API_TOKEN")
  };
}
