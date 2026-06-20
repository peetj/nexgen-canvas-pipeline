import { moduleOverviewPlugin } from "./module-overview/index.js";
import { revealAnswerPlugin } from "./reveal-answer/index.js";
import type { CanvasPlugin } from "../types.js";

const plugins: CanvasPlugin[] = [moduleOverviewPlugin, revealAnswerPlugin];

export const pluginsById = new Map<string, CanvasPlugin>(
  plugins.map((plugin) => [plugin.id.toLowerCase(), plugin])
);
