import { CanvasClient } from "@nexgen/canvas-sdk";

export type PluginResult = {
  summary: string;
  details?: unknown;
};

export type PluginContext = {
  canvas: CanvasClient | null;
  courseId: number | null;
  dryRun: boolean;
  args: Record<string, string>;
  log: (message: string) => void;
};

export type CanvasPlugin = {
  id: string;
  description: string;
  requiresCanvas?: boolean;
  run: (ctx: PluginContext) => Promise<PluginResult>;
};
