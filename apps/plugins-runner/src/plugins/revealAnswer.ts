import fs from "node:fs/promises";
import path from "node:path";
import type { CanvasPlugin } from "../types.js";

type RevealMode = "basic" | "enhanced" | "both";

type RevealTextOptions = {
  question?: string;
  answer: string;
  cta: string;
  helperText: string;
  answerLabel: string;
  pillText: string;
  pillTextClosed: string;
  pillTextOpen: string;
};

type RevealDesignOptions = {
  maxWidthPx: number;
  marginYPx: number;
  panelRadiusPx: number;
  summaryPadYPx: number;
  summaryPadXPx: number;
  iconSizePx: number;
  iconRadiusPx: number;
  answerCardRadiusPx: number;
  answerCardPaddingPx: number;
  baseFontSizePx: number;
  answerLineHeight: number;
  fontFamily: string;
  panelBorderColor: string;
  panelBackgroundColor: string;
  panelShadow: string;
  questionColor: string;
  titleColor: string;
  helperColor: string;
  iconBgColor: string;
  iconTextColor: string;
  pillTextColor: string;
  pillBorderColor: string;
  pillBackgroundColor: string;
  answerCardBorderColor: string;
  answerCardBackgroundColor: string;
  answerTextColor: string;
  answerLabelColor: string;
};

type PackageFile = {
  fileName: string;
  purpose: string;
};

const DEFAULT_FONT_FAMILY =
  "system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

const PARAMETER_REFERENCE = {
  required: [
    {
      key: "answer",
      description: "Answer body. Plain text by default, or raw HTML if escape=false."
    }
  ],
  behavior: [
    {
      key: "mode",
      default: "both",
      values: ["basic", "enhanced", "both"],
      description: "Choose which HTML variants to generate."
    },
    {
      key: "escape",
      default: "true",
      values: ["true", "false"],
      description: "Escape text args as HTML. Keep true unless you intentionally pass HTML."
    },
    {
      key: "outDir",
      default: "",
      description:
        "Optional output folder. When provided, plugin writes a shareable package for Canvas copy/paste install."
    }
  ],
  text: [
    { key: "question", default: "", description: "Optional question prompt shown above the reveal block." },
    { key: "cta", default: "Click to reveal answer", description: "Main clickable summary title." },
    {
      key: "helperText",
      default: "Tap this bar to show / hide the answer.",
      description: "Small helper text shown under the title."
    },
    { key: "answerLabel", default: "Answer:", description: "Label shown above answer content." },
    { key: "pillText", default: "Reveal", description: "Basic mode pill text." },
    { key: "pillTextClosed", default: "Reveal", description: "Enhanced mode closed-state pill text." },
    { key: "pillTextOpen", default: "Hide", description: "Enhanced mode open-state pill text." }
  ],
  design: [
    { key: "maxWidthPx", default: 720, description: "Outer wrapper max width in px." },
    { key: "marginYPx", default: 18, description: "Top and bottom margin in px." },
    { key: "panelRadiusPx", default: 14, description: "Reveal panel border radius in px." },
    { key: "summaryPadYPx", default: 14, description: "Summary vertical padding in px." },
    { key: "summaryPadXPx", default: 14, description: "Summary horizontal padding in px." },
    { key: "iconSizePx", default: 22, description: "Icon box width/height in px." },
    { key: "iconRadiusPx", default: 8, description: "Icon border radius in px." },
    { key: "answerCardRadiusPx", default: 12, description: "Answer card border radius in px." },
    { key: "answerCardPaddingPx", default: 14, description: "Answer card inner padding in px." },
    { key: "baseFontSizePx", default: 16, description: "Base text size for question/title area." },
    { key: "answerLineHeight", default: 1.55, description: "Answer content line-height value." },
    { key: "fontFamily", default: DEFAULT_FONT_FAMILY, description: "Font stack used by the snippet." },
    { key: "panelBorderColor", default: "#d6d9df", description: "Outer panel border color." },
    { key: "panelBackgroundColor", default: "#f7f8fb", description: "Outer panel background color." },
    { key: "panelShadow", default: "0 10px 24px rgba(16,24,40,.08)", description: "Outer panel box-shadow." },
    { key: "questionColor", default: "#111827", description: "Question text color." },
    { key: "titleColor", default: "#111827", description: "Summary title color." },
    { key: "helperColor", default: "#4b5563", description: "Summary helper text color." },
    { key: "iconBgColor", default: "#111827", description: "Icon background color." },
    { key: "iconTextColor", default: "#ffffff", description: "Icon text color." },
    { key: "pillTextColor", default: "#111827", description: "Pill text color." },
    { key: "pillBorderColor", default: "#c9ced8", description: "Pill border color." },
    { key: "pillBackgroundColor", default: "#ffffff", description: "Pill background color." },
    { key: "answerCardBorderColor", default: "#e5e7eb", description: "Answer card border color." },
    { key: "answerCardBackgroundColor", default: "#ffffff", description: "Answer card background color." },
    { key: "answerTextColor", default: "#111827", description: "Answer body text color." },
    { key: "answerLabelColor", default: "#6b7280", description: "Answer label text color." }
  ]
} as const;

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getArg(ctx: Parameters<CanvasPlugin["run"]>[0], key: string): string | undefined {
  const value = ctx.args[key];
  return value === undefined ? undefined : String(value);
}

function truthy(v: string | undefined, defaultValue = false): boolean {
  if (v === undefined) {
    return defaultValue;
  }
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(s)) {
    return false;
  }
  return defaultValue;
}

function parseMode(raw: string | undefined): RevealMode {
  const mode = (raw ?? "both").trim().toLowerCase();
  if (mode === "basic" || mode === "enhanced" || mode === "both") {
    return mode;
  }
  return "both";
}

function parseNumber(raw: string | undefined, fallback: number, opts: { min: number; max: number }): number {
  if (raw === undefined) {
    return fallback;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  if (n < opts.min) {
    return opts.min;
  }
  if (n > opts.max) {
    return opts.max;
  }
  return n;
}

function sanitizeCssValue(raw: string | undefined, fallback: string): string {
  if (raw === undefined) {
    return fallback;
  }
  const candidate = raw.trim();
  if (!candidate) {
    return fallback;
  }
  // Disallow characters that can break attribute boundaries or inject markup.
  if (!/^[#(),.%\w\s+\-/*!]+$/.test(candidate)) {
    return fallback;
  }
  return candidate;
}

function maybeText(raw: string | undefined, escape: boolean): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return escape ? escapeHtml(raw) : raw;
}

function resolveTextOptions(
  ctx: Parameters<CanvasPlugin["run"]>[0],
  escape: boolean
): RevealTextOptions {
  const answerRaw = getArg(ctx, "answer");
  if (!answerRaw || !answerRaw.trim()) {
    throw new Error('Missing required --arg answer="..."');
  }

  const answer = escape ? escapeHtml(answerRaw).replaceAll("\n", "<br>\n") : answerRaw;

  return {
    question: maybeText(getArg(ctx, "question"), escape),
    answer,
    cta: maybeText(getArg(ctx, "cta"), escape) ?? "Click to reveal answer",
    helperText:
      maybeText(getArg(ctx, "helperText"), escape) ?? "Tap this bar to show / hide the answer.",
    answerLabel: maybeText(getArg(ctx, "answerLabel"), escape) ?? "Answer:",
    pillText: maybeText(getArg(ctx, "pillText"), escape) ?? "Reveal",
    pillTextClosed: maybeText(getArg(ctx, "pillTextClosed"), escape) ?? "Reveal",
    pillTextOpen: maybeText(getArg(ctx, "pillTextOpen"), escape) ?? "Hide"
  };
}

function resolveDesignOptions(ctx: Parameters<CanvasPlugin["run"]>[0]): RevealDesignOptions {
  return {
    maxWidthPx: parseNumber(getArg(ctx, "maxWidthPx"), 720, { min: 280, max: 1600 }),
    marginYPx: parseNumber(getArg(ctx, "marginYPx"), 18, { min: 0, max: 120 }),
    panelRadiusPx: parseNumber(getArg(ctx, "panelRadiusPx"), 14, { min: 0, max: 48 }),
    summaryPadYPx: parseNumber(getArg(ctx, "summaryPadYPx"), 14, { min: 4, max: 48 }),
    summaryPadXPx: parseNumber(getArg(ctx, "summaryPadXPx"), 14, { min: 4, max: 64 }),
    iconSizePx: parseNumber(getArg(ctx, "iconSizePx"), 22, { min: 14, max: 64 }),
    iconRadiusPx: parseNumber(getArg(ctx, "iconRadiusPx"), 8, { min: 0, max: 24 }),
    answerCardRadiusPx: parseNumber(getArg(ctx, "answerCardRadiusPx"), 12, { min: 0, max: 48 }),
    answerCardPaddingPx: parseNumber(getArg(ctx, "answerCardPaddingPx"), 14, { min: 6, max: 48 }),
    baseFontSizePx: parseNumber(getArg(ctx, "baseFontSizePx"), 16, { min: 12, max: 24 }),
    answerLineHeight: parseNumber(getArg(ctx, "answerLineHeight"), 1.55, { min: 1, max: 2.5 }),
    fontFamily: sanitizeCssValue(getArg(ctx, "fontFamily"), DEFAULT_FONT_FAMILY),
    panelBorderColor: sanitizeCssValue(getArg(ctx, "panelBorderColor"), "#d6d9df"),
    panelBackgroundColor: sanitizeCssValue(getArg(ctx, "panelBackgroundColor"), "#f7f8fb"),
    panelShadow: sanitizeCssValue(getArg(ctx, "panelShadow"), "0 10px 24px rgba(16,24,40,.08)"),
    questionColor: sanitizeCssValue(getArg(ctx, "questionColor"), "#111827"),
    titleColor: sanitizeCssValue(getArg(ctx, "titleColor"), "#111827"),
    helperColor: sanitizeCssValue(getArg(ctx, "helperColor"), "#4b5563"),
    iconBgColor: sanitizeCssValue(getArg(ctx, "iconBgColor"), "#111827"),
    iconTextColor: sanitizeCssValue(getArg(ctx, "iconTextColor"), "#ffffff"),
    pillTextColor: sanitizeCssValue(getArg(ctx, "pillTextColor"), "#111827"),
    pillBorderColor: sanitizeCssValue(getArg(ctx, "pillBorderColor"), "#c9ced8"),
    pillBackgroundColor: sanitizeCssValue(getArg(ctx, "pillBackgroundColor"), "#ffffff"),
    answerCardBorderColor: sanitizeCssValue(getArg(ctx, "answerCardBorderColor"), "#e5e7eb"),
    answerCardBackgroundColor: sanitizeCssValue(getArg(ctx, "answerCardBackgroundColor"), "#ffffff"),
    answerTextColor: sanitizeCssValue(getArg(ctx, "answerTextColor"), "#111827"),
    answerLabelColor: sanitizeCssValue(getArg(ctx, "answerLabelColor"), "#6b7280")
  };
}

function buildQuestionBlock(question: string | undefined, design: RevealDesignOptions): string {
  if (!question || !question.trim()) {
    return "";
  }
  return `<div style="margin:0 0 10px 0;font-size:${design.baseFontSizePx}px;line-height:1.4;color:${design.questionColor};"><strong>${question}</strong></div>`;
}

function buildBasicHtml(input: { text: RevealTextOptions; design: RevealDesignOptions }): string {
  const { text, design } = input;
  const questionBlock = buildQuestionBlock(text.question, design);

  return `<!-- Nexgen: reveal-answer (basic, Canvas-safe) -->
<div style="max-width:${design.maxWidthPx}px;margin:${design.marginYPx}px 0;font-family:${design.fontFamily};text-align:left;">
  ${questionBlock}
  <details style="border:1px solid ${design.panelBorderColor};border-radius:${design.panelRadiusPx}px;background:${design.panelBackgroundColor};box-shadow:${design.panelShadow};padding:0;">
    <summary style="cursor:pointer;user-select:none;padding:${design.summaryPadYPx}px ${design.summaryPadXPx}px;display:flex;align-items:center;gap:12px;text-align:left;">
      <span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:${design.iconSizePx}px;height:${design.iconSizePx}px;border-radius:${design.iconRadiusPx}px;background:${design.iconBgColor};color:${design.iconTextColor};font-weight:800;font-size:14px;line-height:1;flex:0 0 auto;">+</span>
      <span style="flex:1 1 auto;min-width:0;">
        <span style="display:block;font-weight:700;color:${design.titleColor};line-height:1.2;">${text.cta}</span>
        <span style="display:block;font-size:13px;color:${design.helperColor};line-height:1.3;">${text.helperText}</span>
      </span>
      <span style="font-size:12px;color:${design.pillTextColor};border:1px dashed ${design.pillBorderColor};background:${design.pillBackgroundColor};padding:7px 10px;border-radius:999px;white-space:nowrap;flex:0 0 auto;">${text.pillText}</span>
    </summary>
    <div style="padding:0 ${design.summaryPadXPx}px ${design.summaryPadYPx}px ${design.summaryPadXPx}px;text-align:left;">
      <div style="border:1px solid ${design.answerCardBorderColor};border-radius:${design.answerCardRadiusPx}px;padding:${design.answerCardPaddingPx}px;background:${design.answerCardBackgroundColor};color:${design.answerTextColor};line-height:${design.answerLineHeight};">
        <div style="font-size:12px;color:${design.answerLabelColor};margin:0 0 8px 0;"><strong>${text.answerLabel}</strong></div>
        ${text.answer}
      </div>
    </div>
  </details>
</div>`;
}

function buildEnhancedHtml(input: { text: RevealTextOptions; design: RevealDesignOptions }): string {
  const { text, design } = input;
  const questionBlock = buildQuestionBlock(text.question, design);

  return `<!-- Nexgen: reveal-answer (enhanced; requires <style> support) -->
<div style="max-width:${design.maxWidthPx}px;margin:${design.marginYPx}px 0;font-family:${design.fontFamily};text-align:left;">
  ${questionBlock}
  <style>
    details[data-reveal] > summary::-webkit-details-marker { display:none; }
    details[data-reveal] summary { list-style:none; }
    details[data-reveal][open] [data-plus] { display:none !important; }
    details[data-reveal]:not([open]) [data-minus] { display:none !important; }
    details[data-reveal][open] [data-pill-closed] { display:none !important; }
    details[data-reveal]:not([open]) [data-pill-open] { display:none !important; }
  </style>
  <details data-reveal style="border:1px solid ${design.panelBorderColor};border-radius:${design.panelRadiusPx}px;background:${design.panelBackgroundColor};box-shadow:${design.panelShadow};padding:0;">
    <summary style="cursor:pointer;user-select:none;padding:${design.summaryPadYPx}px ${design.summaryPadXPx}px;display:flex;align-items:center;gap:12px;text-align:left;">
      <span aria-hidden="true" style="display:grid;place-items:center;width:${design.iconSizePx}px;height:${design.iconSizePx}px;border-radius:${design.iconRadiusPx}px;background:${design.iconBgColor};color:${design.iconTextColor};font-weight:800;font-size:14px;line-height:1;flex:0 0 auto;">
        <span data-plus style="display:block;transform:translateY(-0.5px);">+</span>
        <span data-minus style="display:block;transform:translateY(-1px);">-</span>
      </span>
      <span style="flex:1 1 auto;min-width:0;">
        <span style="display:block;font-weight:700;color:${design.titleColor};line-height:1.2;">${text.cta}</span>
        <span style="display:block;font-size:13px;color:${design.helperColor};line-height:1.3;">${text.helperText}</span>
      </span>
      <span data-pill-closed style="font-size:12px;color:${design.pillTextColor};border:1px dashed ${design.pillBorderColor};background:${design.pillBackgroundColor};padding:7px 10px;border-radius:999px;white-space:nowrap;flex:0 0 auto;">${text.pillTextClosed}</span>
      <span data-pill-open style="font-size:12px;color:${design.pillTextColor};border:1px dashed ${design.pillBorderColor};background:${design.pillBackgroundColor};padding:7px 10px;border-radius:999px;white-space:nowrap;flex:0 0 auto;">${text.pillTextOpen}</span>
    </summary>
    <div style="padding:0 ${design.summaryPadXPx}px ${design.summaryPadYPx}px ${design.summaryPadXPx}px;text-align:left;">
      <div style="border:1px solid ${design.answerCardBorderColor};border-radius:${design.answerCardRadiusPx}px;padding:${design.answerCardPaddingPx}px;background:${design.answerCardBackgroundColor};color:${design.answerTextColor};line-height:${design.answerLineHeight};">
        <div style="font-size:12px;color:${design.answerLabelColor};margin:0 0 8px 0;"><strong>${text.answerLabel}</strong></div>
        ${text.answer}
      </div>
    </div>
  </details>
</div>`;
}

function buildReadme(input: { packageName: string; mode: RevealMode; files: PackageFile[] }): string {
  const fileLines = input.files
    .map((file) => `- ${file.fileName}: ${file.purpose}`)
    .join("\n");

  return `# ${input.packageName}

## What this package contains
${fileLines}

## Canvas installation steps
1. Open a Canvas Page and switch to the HTML editor.
2. Choose a snippet from this package (basic for highest compatibility, enhanced for open/close icon + pill swap).
3. Paste the snippet HTML into the page content and save.
4. Duplicate and edit text/design by rerunning the plugin with new args.

## Notes
- Basic mode avoids style-tag dependencies and is safest for strict sanitizers.
- Enhanced mode uses a small style block for open/close state visuals.
- Generated from the reveal-answer plugin mode ${input.mode}.
`;
}

async function maybeWritePackage(input: {
  outDir: string | undefined;
  mode: RevealMode;
  basicHtml: string;
  enhancedHtml: string;
  design: RevealDesignOptions;
  dryRun: boolean;
}): Promise<
  | {
      outDir: string;
      dryRun: boolean;
      files: PackageFile[];
    }
  | undefined
> {
  if (!input.outDir || !input.outDir.trim()) {
    return undefined;
  }

  const targetDir = path.resolve(process.cwd(), input.outDir.trim());
  const files: PackageFile[] = [];

  if (input.mode === "basic" || input.mode === "both") {
    files.push({ fileName: "reveal-answer.basic.html", purpose: "Canvas-safe snippet" });
  }
  if (input.mode === "enhanced" || input.mode === "both") {
    files.push({ fileName: "reveal-answer.enhanced.html", purpose: "Enhanced snippet with style-based state" });
  }

  files.push({ fileName: "reveal-answer.args.example.json", purpose: "Editable args template" });
  files.push({ fileName: "README.md", purpose: "Install instructions" });

  if (input.dryRun) {
    return {
      outDir: targetDir,
      dryRun: true,
      files
    };
  }

  await fs.mkdir(targetDir, { recursive: true });

  if (input.mode === "basic" || input.mode === "both") {
    await fs.writeFile(path.join(targetDir, "reveal-answer.basic.html"), input.basicHtml, "utf8");
  }
  if (input.mode === "enhanced" || input.mode === "both") {
    await fs.writeFile(path.join(targetDir, "reveal-answer.enhanced.html"), input.enhancedHtml, "utf8");
  }

  const argsExample = {
    mode: input.mode,
    escape: true,
    question: "Replace with your question",
    answer: "Replace with your answer",
    cta: "Click to reveal answer",
    helperText: "Tap this bar to show / hide the answer.",
    answerLabel: "Answer:",
    pillText: "Reveal",
    pillTextClosed: "Reveal",
    pillTextOpen: "Hide",
    maxWidthPx: input.design.maxWidthPx,
    marginYPx: input.design.marginYPx,
    panelRadiusPx: input.design.panelRadiusPx,
    panelBorderColor: input.design.panelBorderColor,
    panelBackgroundColor: input.design.panelBackgroundColor,
    panelShadow: input.design.panelShadow,
    titleColor: input.design.titleColor,
    helperColor: input.design.helperColor,
    iconBgColor: input.design.iconBgColor,
    iconTextColor: input.design.iconTextColor,
    pillTextColor: input.design.pillTextColor,
    pillBorderColor: input.design.pillBorderColor,
    pillBackgroundColor: input.design.pillBackgroundColor,
    answerCardBorderColor: input.design.answerCardBorderColor,
    answerCardBackgroundColor: input.design.answerCardBackgroundColor,
    answerTextColor: input.design.answerTextColor,
    answerLabelColor: input.design.answerLabelColor
  };

  await fs.writeFile(
    path.join(targetDir, "reveal-answer.args.example.json"),
    `${JSON.stringify(argsExample, null, 2)}\n`,
    "utf8"
  );

  const readme = buildReadme({
    packageName: "Reveal Answer Canvas Snippets",
    mode: input.mode,
    files
  });
  await fs.writeFile(path.join(targetDir, "README.md"), readme, "utf8");

  return {
    outDir: targetDir,
    dryRun: false,
    files
  };
}

export const revealAnswerPlugin: CanvasPlugin = {
  id: "reveal-answer",
  description:
    "Generate Canvas-ready reveal-answer HTML snippets (basic/enhanced), with optional package export for sharing.",
  requiresCanvas: false,
  async run(ctx) {
    const mode = parseMode(getArg(ctx, "mode"));
    const escape = truthy(getArg(ctx, "escape"), true);

    const text = resolveTextOptions(ctx, escape);
    const design = resolveDesignOptions(ctx);

    const basicHtml = buildBasicHtml({ text, design });
    const enhancedHtml = buildEnhancedHtml({ text, design });

    const packageOutput = await maybeWritePackage({
      outDir: getArg(ctx, "outDir"),
      mode,
      basicHtml,
      enhancedHtml,
      design,
      dryRun: ctx.dryRun
    });

    const details: Record<string, unknown> = {
      mode,
      escape,
      parameterReference: PARAMETER_REFERENCE,
      usage: {
        commandExamples: [
          "nexgen-plugins run --plugin reveal-answer --arg question=\"Question here\" --arg answer=\"Answer here\"",
          "nexgen-plugins run --plugin reveal-answer --arg mode=basic --arg answer=\"Answer\"",
          "nexgen-plugins run --plugin reveal-answer --arg mode=enhanced --arg escape=false --arg answer=\"<p>Answer with <strong>HTML</strong></p>\"",
          "nexgen-plugins run --plugin reveal-answer --arg mode=both --arg answer=\"Answer\" --arg outDir=dist/reveal-answer-package"
        ]
      },
      installNotes: [
        "Paste htmlBasic in Canvas for highest sanitizer compatibility.",
        "Use htmlEnhanced when your Canvas editor preserves <style> tags.",
        "Set outDir to generate a ready-to-share package folder with snippets and install notes."
      ],
      resolvedDesign: design
    };

    if (mode === "basic") {
      details.html = basicHtml;
    } else if (mode === "enhanced") {
      details.html = enhancedHtml;
    } else {
      details.htmlBasic = basicHtml;
      details.htmlEnhanced = enhancedHtml;
      details.note = "If Canvas strips <style>, use htmlBasic. Open/close visual states require htmlEnhanced.";
    }

    if (packageOutput) {
      details.package = packageOutput;
    }

    return {
      summary: "Generated reveal-answer HTML snippet package.",
      details
    };
  }
};
