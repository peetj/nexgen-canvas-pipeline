import type { CanvasModuleItem, CanvasModuleSummary } from "@nexgen/canvas-sdk";
import type { CanvasPlugin } from "../types.js";

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

function summariseItems(items: CanvasModuleItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }
  return counts;
}

async function resolveSingleModule(
  allModules: CanvasModuleSummary[],
  moduleName: string
): Promise<CanvasModuleSummary> {
  const target = normalize(moduleName);
  const exact = allModules.filter((m) => normalize(m.name) === target);
  if (exact.length === 1) {
    return exact[0];
  }
  if (exact.length > 1) {
    throw new Error(`Multiple modules matched "${moduleName}".`);
  }

  const close = allModules.filter((m) => normalize(m.name).includes(target)).map((m) => m.name);
  if (close.length > 0) {
    throw new Error(`No exact module match for "${moduleName}". Closest: ${close.join(", ")}`);
  }
  throw new Error(`No module found for "${moduleName}".`);
}

export const moduleOverviewPlugin: CanvasPlugin = {
  id: "module-overview",
  description:
    "Read-only summary of course modules. Optionally pass moduleName to inspect one module in detail.",
  async run(ctx) {
    const moduleName = ctx.args.moduleName;
    const modules = await ctx.canvas.listModules(ctx.courseId, moduleName);

    if (!moduleName) {
      return {
        summary: `Found ${modules.length} modules in course ${ctx.courseId}.`,
        details: {
          modules: modules.map((m) => ({ id: m.id, name: m.name }))
        }
      };
    }

    const module = await resolveSingleModule(modules, moduleName);
    const items = await ctx.canvas.listModuleItems(ctx.courseId, module.id);
    const byType = summariseItems(items);

    return {
      summary: `Module "${module.name}" has ${items.length} items.`,
      details: {
        module: { id: module.id, name: module.name },
        itemCountsByType: byType,
        items: items.map((item) => ({
          id: item.id,
          position: item.position,
          type: item.type,
          title: item.title,
          page_url: item.page_url ?? null
        }))
      }
    };
  }
};
