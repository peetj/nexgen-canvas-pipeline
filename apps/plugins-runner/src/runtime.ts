import { CanvasClient } from "@nexgen/canvas-sdk";
import { getCanvasEnv } from "./env.js";
import { pluginsById } from "./plugins/index.js";
import type { CanvasPlugin, PluginContext, PluginResult } from "./types.js";

export function listPlugins(): CanvasPlugin[] {
  return [...pluginsById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function resolvePlugin(pluginId: string): CanvasPlugin {
  const plugin = pluginsById.get(pluginId.trim().toLowerCase());
  if (!plugin) {
    const ids = listPlugins().map((p) => p.id).join(", ");
    throw new Error(`Unknown plugin "${pluginId}". Available plugins: ${ids}`);
  }
  return plugin;
}

export async function runPlugin(input: {
  pluginId: string;
  courseId?: number;
  dryRun: boolean;
  args: Record<string, string>;
  log?: (message: string) => void;
}): Promise<PluginResult> {
  const plugin = resolvePlugin(input.pluginId);
  const logger = input.log ?? console.log;
  const requiresCanvas = plugin.requiresCanvas !== false;

  let canvas: CanvasClient | null = null;
  if (requiresCanvas) {
    if (!Number.isFinite(input.courseId)) {
      throw new Error(`Plugin "${plugin.id}" requires --course-id <id>.`);
    }
    const env = getCanvasEnv();
    canvas = new CanvasClient(env.canvasBaseUrl, env.canvasApiToken);
  }

  const ctx: PluginContext = {
    canvas,
    courseId: Number.isFinite(input.courseId) ? Number(input.courseId) : null,
    dryRun: input.dryRun,
    args: input.args,
    log: logger
  };

  return plugin.run(ctx);
}
