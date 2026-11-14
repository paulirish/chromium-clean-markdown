---
name: distill-page
description: Extract distilled page content as Markdown using Chromium's AnnotatedPageContent CDP extraction.
---

# Page Distiller Skill

Extracts clean, noise-free Markdown from a webpage using Chromium's experimental `Page.getAnnotatedPageContent` CDP command (`AIPageContentAgent`).

Unlike generic HTML-to-Markdown parsers (e.g. Turndown) that convert the entire DOM tree, this approach uses Blink's layout-tree extraction to isolate primary content (`MAIN` / `ARTICLE`) and strip navigation bars, footers, ads, and wrapper soup.

## Usage

```bash
npx page-distiller [--json] <URL>
```

(Or from a local checkout: `node scripts/distill-page.ts [--json] <URL>`)

### Options:
* `--json`: Output the raw decoded `AnnotatedPageContent` protobuf as JSON instead of Markdown (Markdown is the default).
* `--base64-stdin`: Decode a base64-encoded `AnnotatedPageContent` protobuf payload from stdin instead of launching Playwright.

### Examples:
```bash
# Distill a webpage into clean Markdown (default)
npx page-distiller https://example.com

# Dump the raw JSON structure of the annotated layout tree
npx page-distiller --json https://example.com

# Decode an existing base64 CDP payload into Markdown
npx page-distiller --base64-stdin < payload.b64
```
