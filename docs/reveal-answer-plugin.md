# Reveal Answer Plugin

`reveal-answer` generates Canvas-ready HTML snippets for click-to-reveal answer blocks.

If you want this as a Canvas External App (`Apps` / LTI install), use:
`docs/canvas-external-app-reveal-answer.md`.

## Why this plugin
- Standalone: does not require Canvas API credentials.
- Canvas-safe default (`mode=basic`) for stricter sanitizers.
- Optional enhanced mode (`mode=enhanced`) for open/close state visuals.
- Optional package export (`outDir`) to generate a folder you can share with other teachers/schools.

## Quick start
Direct command:
```bash
npx tsx apps/plugins-runner/src/cli.ts run --plugin reveal-answer --arg "question=What is Ohm's Law?" --arg "answer=V = I * R"
```

Workspace script:
```bash
npm run plugins:dev -- run -- --plugin reveal-answer --arg "question=What is Ohm's Law?" --arg "answer=V = I * R"
```

## Generate a shareable package
```bash
npx tsx apps/plugins-runner/src/cli.ts run --plugin reveal-answer --arg "mode=both" --arg "answer=Your answer text" --arg "outDir=dist/reveal-answer-package"
```

Generated files:
- `reveal-answer.basic.html`
- `reveal-answer.enhanced.html`
- `reveal-answer.args.example.json`
- `README.md`

Use `--dry-run` to preview package paths without writing files.

## Canvas install steps
1. Open a Canvas page and switch to HTML editor.
2. Copy from `reveal-answer.basic.html` (safest) or `reveal-answer.enhanced.html`.
3. Paste into page content and save.
4. Re-run plugin with different args whenever you need a new visual style/text variant.

## Core args
- `answer` (required): answer content.
- `question`: optional prompt shown above block.
- `mode`: `basic`, `enhanced`, or `both` (default `both`).
- `escape`: `true` (default) or `false` (allow raw HTML in text args).
- `outDir`: folder to write package files.

## Text customization args
- `cta`
- `helperText`
- `answerLabel`
- `pillText` (basic mode)
- `pillTextClosed` and `pillTextOpen` (enhanced mode)

## Design customization args
- Layout: `maxWidthPx`, `marginYPx`, `panelRadiusPx`, `summaryPadYPx`, `summaryPadXPx`
- Icon: `iconSizePx`, `iconRadiusPx`, `iconBgColor`, `iconTextColor`
- Panel: `panelBorderColor`, `panelBackgroundColor`, `panelShadow`
- Typography: `fontFamily`, `baseFontSizePx`, `answerLineHeight`
- Text colors: `questionColor`, `titleColor`, `helperColor`, `answerTextColor`, `answerLabelColor`
- Pill: `pillTextColor`, `pillBorderColor`, `pillBackgroundColor`
- Answer card: `answerCardRadiusPx`, `answerCardPaddingPx`, `answerCardBorderColor`, `answerCardBackgroundColor`

## Example: theme override
```bash
npx tsx apps/plugins-runner/src/cli.ts run --plugin reveal-answer \
  --arg "question=How many bits are in one byte?" \
  --arg "answer=8" \
  --arg "mode=basic" \
  --arg "panelBackgroundColor=#eefaf4" \
  --arg "panelBorderColor=#8fd8b9" \
  --arg "iconBgColor=#0b6b44" \
  --arg "titleColor=#0b6b44" \
  --arg "pillBackgroundColor=#ffffff"
```
