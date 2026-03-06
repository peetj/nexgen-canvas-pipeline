import type { CanvasPlugin } from "../types.js";

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
  if (v === undefined) return defaultValue;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return defaultValue;
}

function buildBasicHtml(params: {
  question?: string;
  answer: string;
  cta?: string;
  pillText?: string;
  maxWidthPx: number;
}): string {
  const { question, answer, cta, pillText, maxWidthPx } = params;

  const questionBlock =
    question && question.trim()
      ? `<div style="margin:0 0 10px 0;font-size:16px;line-height:1.4;color:#111827;"><strong>${question}</strong></div>`
      : "";

  // NOTE: No JS and no <style> tag. This survives most Canvas/TinyMCE sanitizers.
  // The tradeoff: you can't reliably swap + -> – without CSS.
  return `<!-- Nexgen: reveal-answer (basic, Canvas-safe) -->
<div style="max-width:${maxWidthPx}px;margin:18px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:left;">
  ${questionBlock}
  <details style="border:1px solid #d6d9df;border-radius:14px;background:#f7f8fb;box-shadow:0 10px 24px rgba(16,24,40,.08);padding:0;">
    <summary style="cursor:pointer;user-select:none;padding:14px 14px;display:flex;align-items:center;gap:12px;text-align:left;">
      <span aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:8px;background:#111827;color:#fff;font-weight:800;font-size:14px;line-height:1;flex:0 0 auto;">+</span>
      <span style="flex:1 1 auto;min-width:0;">
        <span style="display:block;font-weight:700;color:#111827;line-height:1.2;">${cta ?? "Click to reveal answer"}</span>
        <span style="display:block;font-size:13px;color:#4b5563;line-height:1.3;">Tap this bar to show / hide the answer.</span>
      </span>
      <span style="font-size:12px;color:#111827;border:1px dashed #c9ced8;background:#ffffff;padding:7px 10px;border-radius:999px;white-space:nowrap;flex:0 0 auto;">${pillText ?? "Reveal"}</span>
    </summary>
    <div style="padding:0 14px 14px 14px;text-align:left;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 14px;background:#ffffff;color:#111827;line-height:1.55;">
        <div style="font-size:12px;color:#6b7280;margin:0 0 8px 0;"><strong>Answer:</strong></div>
        ${answer}
      </div>
    </div>
  </details>
</div>`;
}

function buildEnhancedHtml(params: {
  question?: string;
  answer: string;
  cta?: string;
  pillTextClosed?: string;
  pillTextOpen?: string;
  maxWidthPx: number;
}): string {
  const { question, answer, cta, pillTextClosed, pillTextOpen, maxWidthPx } = params;

  const questionBlock =
    question && question.trim()
      ? `<div style="margin:0 0 10px 0;font-size:16px;line-height:1.4;color:#111827;"><strong>${question}</strong></div>`
      : "";

  // This version uses a small <style> block so the icon swaps +/– when open.
  // If Canvas strips <style>, it degrades to “always +” and “always closed pill”.
  return `<!-- Nexgen: reveal-answer (enhanced; requires <style> support) -->
<div style="max-width:${maxWidthPx}px;margin:18px 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;text-align:left;">
  ${questionBlock}
  <style>
    details[data-reveal] > summary::-webkit-details-marker { display:none; }
    details[data-reveal] summary { list-style:none; }
    details[data-reveal][open] [data-plus] { display:none !important; }
    details[data-reveal]:not([open]) [data-minus] { display:none !important; }
    details[data-reveal][open] [data-pill-closed] { display:none !important; }
    details[data-reveal]:not([open]) [data-pill-open] { display:none !important; }
  </style>
  <details data-reveal style="border:1px solid #d6d9df;border-radius:14px;background:#f7f8fb;box-shadow:0 10px 24px rgba(16,24,40,.08);padding:0;">
    <summary style="cursor:pointer;user-select:none;padding:14px 14px;display:flex;align-items:center;gap:12px;text-align:left;">
      <span aria-hidden="true" style="display:grid;place-items:center;width:22px;height:22px;border-radius:8px;background:#111827;color:#fff;font-weight:800;font-size:14px;line-height:1;flex:0 0 auto;">
        <span data-plus style="display:block;transform:translateY(-0.5px);">+</span>
        <span data-minus style="display:block;transform:translateY(-1px);">–</span>
      </span>
      <span style="flex:1 1 auto;min-width:0;">
        <span style="display:block;font-weight:700;color:#111827;line-height:1.2;">${cta ?? "Click to reveal answer"}</span>
        <span style="display:block;font-size:13px;color:#4b5563;line-height:1.3;">Tap this bar to show / hide the answer.</span>
      </span>
      <span data-pill-closed style="font-size:12px;color:#111827;border:1px dashed #c9ced8;background:#ffffff;padding:7px 10px;border-radius:999px;white-space:nowrap;flex:0 0 auto;">${pillTextClosed ?? "Reveal"}</span>
      <span data-pill-open style="font-size:12px;color:#111827;border:1px dashed #c9ced8;background:#ffffff;padding:7px 10px;border-radius:999px;white-space:nowrap;flex:0 0 auto;">${pillTextOpen ?? "Hide"}</span>
    </summary>
    <div style="padding:0 14px 14px 14px;text-align:left;">
      <div style="border:1px solid #e5e7eb;border-radius:12px;padding:14px 14px;background:#ffffff;color:#111827;line-height:1.55;">
        <div style="font-size:12px;color:#6b7280;margin:0 0 8px 0;"><strong>Answer:</strong></div>
        ${answer}
      </div>
    </div>
  </details>
</div>`;
}

export const revealAnswerPlugin: CanvasPlugin = {
  id: "reveal-answer",
  description:
    "Generate a Canvas-friendly HTML snippet: a click-to-reveal answer block (details/summary).",
  async run(ctx) {
    // Args
    // - answer (required)
    // - question (optional)
    // - escape (default true) => escape question/answer (answer escaped + newlines -> <br>)
    // - mode=basic|enhanced|both (default both)
    // - maxWidthPx (default 720)
    const mode = (getArg(ctx, "mode") ?? "both").trim().toLowerCase();
    const maxWidthPx = Number(getArg(ctx, "maxWidthPx") ?? "720");
    const escape = truthy(getArg(ctx, "escape"), true);

    const questionRaw = getArg(ctx, "question");
    const answerRaw = getArg(ctx, "answer");

    if (!answerRaw || !answerRaw.trim()) {
      throw new Error('Missing required --arg answer="..."');
    }

    const question = questionRaw ? (escape ? escapeHtml(questionRaw) : questionRaw) : undefined;

    let answer: string;
    if (escape) {
      // Keep it pleasant when pasting plain text answers.
      answer = escapeHtml(answerRaw).replaceAll("\n", "<br>\n");
    } else {
      answer = answerRaw;
    }

    const basic = buildBasicHtml({
      question,
      answer,
      cta: getArg(ctx, "cta") ? (escape ? escapeHtml(getArg(ctx, "cta")!) : getArg(ctx, "cta")!) : undefined,
      pillText: getArg(ctx, "pillText") ? (escape ? escapeHtml(getArg(ctx, "pillText")!) : getArg(ctx, "pillText")!) : undefined,
      maxWidthPx: Number.isFinite(maxWidthPx) ? maxWidthPx : 720
    });

    const enhanced = buildEnhancedHtml({
      question,
      answer,
      cta: getArg(ctx, "cta") ? (escape ? escapeHtml(getArg(ctx, "cta")!) : getArg(ctx, "cta")!) : undefined,
      pillTextClosed: getArg(ctx, "pillTextClosed")
        ? escape
          ? escapeHtml(getArg(ctx, "pillTextClosed")!)
          : getArg(ctx, "pillTextClosed")!
        : undefined,
      pillTextOpen: getArg(ctx, "pillTextOpen")
        ? escape
          ? escapeHtml(getArg(ctx, "pillTextOpen")!)
          : getArg(ctx, "pillTextOpen")!
        : undefined,
      maxWidthPx: Number.isFinite(maxWidthPx) ? maxWidthPx : 720
    });

    const details: Record<string, unknown> = {
      usage: {
        commandExamples: [
          "nexgen-plugins run --plugin reveal-answer --course-id 123 --arg question=\"Question here\" --arg answer=\"Answer here\"",
          "nexgen-plugins run --plugin reveal-answer --course-id 123 --arg mode=basic --arg answer=\"Answer\"",
          "nexgen-plugins run --plugin reveal-answer --course-id 123 --arg mode=enhanced --arg escape=false --arg answer=\"<p>Answer with <strong>HTML</strong></p>\""
        ]
      }
    };

    if (mode === "basic") {
      details.html = basic;
    } else if (mode === "enhanced") {
      details.html = enhanced;
    } else {
      details.htmlBasic = basic;
      details.htmlEnhanced = enhanced;
      details.note =
        "If Canvas strips <style>, use htmlBasic. The +/– swap requires htmlEnhanced (CSS support).";
    }

    return {
      summary: "Generated reveal-answer HTML snippet.",
      details
    };
  }
};
