import { Command } from "commander";
import { listPlugins, runPlugin } from "./runtime.js";

const program = new Command();

type RunOptions = {
  plugin: string;
  courseId: string;
  arg: string[];
  dryRun: boolean;
};

function parseArgs(input: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of input) {
    const idx = item.indexOf("=");
    if (idx <= 0 || idx === item.length - 1) {
      throw new Error(`Invalid --arg "${item}". Use key=value.`);
    }
    const key = item.slice(0, idx).trim();
    const value = item.slice(idx + 1).trim();
    if (!key) {
      throw new Error(`Invalid --arg "${item}". Key cannot be empty.`);
    }
    out[key] = value;
  }
  return out;
}

program
  .name("nexgen-plugins")
  .description("Run Canvas plugins from the Nexgen plugins runner.")
  .version("0.1.0");

program
  .command("list")
  .description("List available plugins.")
  .action(() => {
    const plugins = listPlugins();
    if (plugins.length === 0) {
      console.log("No plugins registered.");
      return;
    }
    console.log("Available plugins:");
    for (const plugin of plugins) {
      console.log(`- ${plugin.id}: ${plugin.description}`);
    }
  });

program
  .command("run")
  .description("Run a plugin.")
  .requiredOption("--plugin <id>", "Plugin id to run")
  .requiredOption("--course-id <id>", "Canvas course id")
  .option("--arg <key=value>", "Plugin argument (repeatable)", (value, prev: string[]) => [...prev, value], [])
  .option("--dry-run", "Run in dry-run mode", false)
  .action(async (opts: RunOptions) => {
    const courseId = Number(opts.courseId);
    if (!Number.isFinite(courseId)) {
      throw new Error("Invalid --course-id. Provide a numeric Canvas course id.");
    }

    const args = parseArgs(opts.arg ?? []);
    const result = await runPlugin({
      pluginId: opts.plugin,
      courseId,
      dryRun: opts.dryRun ?? false,
      args
    });

    console.log(`Plugin: ${opts.plugin}`);
    console.log(`Course: ${courseId}`);
    console.log(`Dry run: ${opts.dryRun ? "yes" : "no"}`);
    console.log(`Summary: ${result.summary}`);
    if (result.details !== undefined) {
      console.log("Details:");
      console.log(JSON.stringify(result.details, null, 2));
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
