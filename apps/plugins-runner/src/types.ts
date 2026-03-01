import { CanvasClient } from "@nexgen/canvas-sdk";

export type PluginResult = {
  summary: string;
  details?: unknown;
};

export type PluginContext = {
  canvas: CanvasClient;
  courseId: number;
  dryRun: boolean;
  args: Record<string, string>;
  log: (message: string) => void;
};

export type CanvasPlugin = {
  id: string;
  description: string;
  run: (ctx: PluginContext) => Promise<PluginResult>;
};
