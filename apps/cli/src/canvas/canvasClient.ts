import {
  CanvasClient as BaseCanvasClient,
  type CanvasFolder,
  type CanvasModuleItem,
  type CanvasModuleSummary,
  type CanvasPage
} from "@nexgen/canvas-sdk";
import { env } from "../env.js";

export type { CanvasFolder, CanvasModuleItem, CanvasModuleSummary, CanvasPage };

export class CanvasClient extends BaseCanvasClient {
  constructor(baseUrl = env.canvasBaseUrl, token = env.canvasApiToken) {
    super(baseUrl, token);
  }
}
