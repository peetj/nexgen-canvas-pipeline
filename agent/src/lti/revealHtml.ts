export type RevealMode = "basic" | "enhanced";

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

type RevealResolved = {
  mode: RevealMode;
  escape: boolean;
  text: RevealTextOptions;
  design: RevealDesignOptions;
};

const DEFAULT_FONT_FAMILY =
  "system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function truthy(value: string | undefined, fallback = false): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseMode(raw: string | undefined): RevealMode {
  const mode = (raw ?? "basic").trim().toLowerCase();
  return mode === "enhanced" ? "enhanced" : "basic";
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

function resolve(rawArgs: Record<string, string>): RevealResolved {
  const mode = parseMode(rawArgs.mode);
  const escape = truthy(rawArgs.escape, true);
  const answerRaw = rawArgs.answer;
  if (!answerRaw || !answerRaw.trim()) {
    throw new Error('Missing required field "answer".');
  }

  const text: RevealTextOptions = {
    question: maybeText(rawArgs.question, escape),
    answer: escape ? escapeHtml(answerRaw).replaceAll("\n", "<br>\n") : answerRaw,
    cta: maybeText(rawArgs.cta, escape) ?? "Click to reveal answer",
    helperText:
      maybeText(rawArgs.helperText, escape) ?? "Tap this bar to show / hide the answer.",
    answerLabel: maybeText(rawArgs.answerLabel, escape) ?? "Answer:",
    pillText: maybeText(rawArgs.pillText, escape) ?? "Reveal",
    pillTextClosed: maybeText(rawArgs.pillTextClosed, escape) ?? "Reveal",
    pillTextOpen: maybeText(rawArgs.pillTextOpen, escape) ?? "Hide"
  };

  const design: RevealDesignOptions = {
    maxWidthPx: parseNumber(rawArgs.maxWidthPx, 720, { min: 280, max: 1600 }),
    marginYPx: parseNumber(rawArgs.marginYPx, 18, { min: 0, max: 120 }),
    panelRadiusPx: parseNumber(rawArgs.panelRadiusPx, 14, { min: 0, max: 48 }),
    summaryPadYPx: parseNumber(rawArgs.summaryPadYPx, 14, { min: 4, max: 48 }),
    summaryPadXPx: parseNumber(rawArgs.summaryPadXPx, 14, { min: 4, max: 64 }),
    iconSizePx: parseNumber(rawArgs.iconSizePx, 22, { min: 14, max: 64 }),
    iconRadiusPx: parseNumber(rawArgs.iconRadiusPx, 8, { min: 0, max: 24 }),
    answerCardRadiusPx: parseNumber(rawArgs.answerCardRadiusPx, 12, { min: 0, max: 48 }),
    answerCardPaddingPx: parseNumber(rawArgs.answerCardPaddingPx, 14, { min: 6, max: 48 }),
    baseFontSizePx: parseNumber(rawArgs.baseFontSizePx, 16, { min: 12, max: 24 }),
    answerLineHeight: parseNumber(rawArgs.answerLineHeight, 1.55, { min: 1, max: 2.5 }),
    fontFamily: sanitizeCssValue(rawArgs.fontFamily, DEFAULT_FONT_FAMILY),
    panelBorderColor: sanitizeCssValue(rawArgs.panelBorderColor, "#d6d9df"),
    panelBackgroundColor: sanitizeCssValue(rawArgs.panelBackgroundColor, "#f7f8fb"),
    panelShadow: sanitizeCssValue(rawArgs.panelShadow, "0 10px 24px rgba(16,24,40,.08)"),
    questionColor: sanitizeCssValue(rawArgs.questionColor, "#111827"),
    titleColor: sanitizeCssValue(rawArgs.titleColor, "#111827"),
    helperColor: sanitizeCssValue(rawArgs.helperColor, "#4b5563"),
    iconBgColor: sanitizeCssValue(rawArgs.iconBgColor, "#111827"),
    iconTextColor: sanitizeCssValue(rawArgs.iconTextColor, "#ffffff"),
    pillTextColor: sanitizeCssValue(rawArgs.pillTextColor, "#111827"),
    pillBorderColor: sanitizeCssValue(rawArgs.pillBorderColor, "#c9ced8"),
    pillBackgroundColor: sanitizeCssValue(rawArgs.pillBackgroundColor, "#ffffff"),
    answerCardBorderColor: sanitizeCssValue(rawArgs.answerCardBorderColor, "#e5e7eb"),
    answerCardBackgroundColor: sanitizeCssValue(rawArgs.answerCardBackgroundColor, "#ffffff"),
    answerTextColor: sanitizeCssValue(rawArgs.answerTextColor, "#111827"),
    answerLabelColor: sanitizeCssValue(rawArgs.answerLabelColor, "#6b7280")
  };

  return { mode, escape, text, design };
}

function buildQuestionBlock(question: string | undefined, design: RevealDesignOptions): string {
  if (!question || !question.trim()) {
    return "";
  }
  return `<div style="margin:0 0 10px 0;font-size:${design.baseFontSizePx}px;line-height:1.4;color:${design.questionColor};"><strong>${question}</strong></div>`;
}

function buildBasicHtml(text: RevealTextOptions, design: RevealDesignOptions): string {
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

function buildEnhancedHtml(text: RevealTextOptions, design: RevealDesignOptions): string {
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

export function generateRevealHtml(rawArgs: Record<string, string>): {
  mode: RevealMode;
  html: string;
  basicHtml: string;
  enhancedHtml: string;
} {
  const resolved = resolve(rawArgs);
  const basicHtml = buildBasicHtml(resolved.text, resolved.design);
  const enhancedHtml = buildEnhancedHtml(resolved.text, resolved.design);
  return {
    mode: resolved.mode,
    html: resolved.mode === "enhanced" ? enhancedHtml : basicHtml,
    basicHtml,
    enhancedHtml
  };
}
