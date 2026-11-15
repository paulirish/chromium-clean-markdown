---
name: chromium-clean-markdown
description: Fetch a URL or webpage as clean, reader-mode Markdown stripped of headers, footers, nav bars, sidebars, and ads using Chromium's AnnotatedPageContent over CDP.
---

# Chromium Clean Markdown (`chromium-clean-markdown`)

Extracts clean, noise-free Markdown from a webpage using Chromium's `Page.getAnnotatedPageContent` CDP command (`AIPageContentAgent`).

Unlike generic HTML-to-Markdown parsers (e.g. Turndown) that convert the entire DOM tree, this uses Blink's post-layout extraction to isolate primary content (`MAIN` / `ARTICLE`) and strip navigation bars, footers, ads, and wrapper soup.

## Usage

```bash
npx chromium-clean-markdown [--json] <URL>
```

(Or from a local checkout: `node src/index.ts [--json] <URL>`)

### Options:
* `--json`: Output the raw decoded `AnnotatedPageContent` protobuf as JSON instead of Markdown (Markdown is the default).
* `--base64-stdin`: Decode a base64-encoded `AnnotatedPageContent` protobuf payload from stdin instead of launching Playwright.

### Examples:
```bash
# Distill a webpage into clean Markdown (default)
npx chromium-clean-markdown https://example.com

# Dump the raw JSON structure of the annotated layout tree
npx chromium-clean-markdown --json https://example.com

# Decode an existing base64 CDP payload into Markdown
npx chromium-clean-markdown --base64-stdin < payload.b64
```
