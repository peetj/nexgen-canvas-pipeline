import { moduleOverviewPlugin } from "./moduleOverview.js";
import { revealAnswerPlugin } from "./revealAnswer.js";
import type { CanvasPlugin } from "../types.js";

const plugins: CanvasPlugin[] = [moduleOverviewPlugin, revealAnswerPlugin];

export const pluginsById = new Map<string, CanvasPlugin>(
  plugins.map((plugin) => [plugin.id.toLowerCase(), plugin])
);
