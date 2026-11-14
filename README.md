# chromium-clean-markdown

Turn any webpage into clean Markdown (`URL -> Markdown`): **just the actual content**, without headers, footers, nav bars, sidebars, ad slots, or layout wrapper soup. Basically "Reader Mode", but outputting GFM Markdown instead of a restyled page.

```bash
npx chromium-clean-markdown https://web.dev/articles/lcp
```

## Why? (And what is `AnnotatedPageContent`?)

If you pipe a webpage's DOM into an HTML-to-Markdown converter like [Turndown](https://github.com/mixmark-io/turndown), you get the *entire* DOM: mega-menus, header links, footer sitemaps, cookie banners, sidebar widgets, and "related posts" cards. Half your output (and context window) goes to page chrome instead of the article.

Deep inside Chromium is a feature almost no web developers know about (and tbh most Chromium engineers don't realize you can grab over CDP and decode in JS): **Annotated Page Content** (`APC`).

Chrome built [`AIPageContentAgent`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/content_extraction/ai_page_content_agent.cc) inside Blink to power "Gemini in Chrome" and Optimization Guide features, and exposed it over the Chrome DevTools Protocol as [`Page.getAnnotatedPageContent`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-getAnnotatedPageContent).

Calling `Page.getAnnotatedPageContent` returns a base64-encoded binary protobuf ([`common_quality_data.proto`](https://source.chromium.org/chromium/chromium/src/+/main:components/optimization_guide/proto/features/common_quality_data.proto)). `chromium-clean-markdown` decodes that protobuf in Node, isolates the main content tree, and converts it into Markdown.

In short: you get the page's real content at **50% to 70% smaller byte/token size** than converting raw HTML:

| Page | Raw HTML -> `turndown` | `chromium-clean-markdown` | Reduction |
| :--- | ---: | ---: | ---: |
| `web.dev/articles/lcp` | 21.0 KB | **11.0 KB** | **47% smaller** |
| `paulirish.com` | 7.4 KB | **2.4 KB** | **67% smaller** |

## How Chrome builds `AnnotatedPageContent`

Unlike Readability or DOM-to-Markdown scripts that parse raw HTML strings and guess from tag names, Blink builds `AnnotatedPageContent` **after style and layout**, walking the live layout tree across the main document and any embedded iframes:

- Unstyled `<div>` and `<span>` **wrapper soup disappears automatically**. Layout boxes without a semantic role, interaction state, or sticky/fixed/scrollable behavior don't even emit a node; their visible children are hoisted straight up into a sparse tree.
- Visibility is **computed from layout**, not guessed. Anything with `display: none`, `visibility: hidden`, or an empty `0x0` bounding box is skipped. Even better: Blink temporarily unlocks `content-visibility: hidden` and `hidden="until-found"` subtrees so collapsed accordion content gets laid out and included.
- Typography comes **straight from computed styles**. Instead of trusting `<h*>` or `<b>` tags, Blink compares each text run's computed `font-size` against the root document font size to bucket text into `XL` / `L` / `M` / `S` / `XS`, and checks computed weight, slope, underline, and sub/superscript to mark emphasis.
- Landmarks, ads, and paywalls are **tagged natively**. Blink combines HTML tags (`<main>`, `<article>`, `<nav>`, `<header>`, `<footer>`, `<aside>`, `<search>`) with ARIA roles, flags ad subtrees via Chrome's Subresource Filter, and detects schema.org paywall declarations.

## How `chromium-clean-markdown` turns it into Markdown

Once we have the decoded `AnnotatedPageContent` tree, `chromium-clean-markdown` cleans and formats it into Markdown:

- **Isolates the primary content root** by picking the largest `main` or `article` landmark (only when it holds >= 50% of the page's text, so small promo shells or inline `<article>` cards don't hijack or truncate the page) and pruning all `nav`, `footer`, and ad-flagged subtrees.
- **Preserves `<pre>` and `<code>` blocks.** Blink's layout extractor ignores monospace fonts and `<code>`/`<pre>` tags (left alone, code flattens into plain text). Before calling CDP, we inject invisible private-use delimiters around `<code>` and `<pre>` in the DOM so fenced code blocks and inline backticks survive layout extraction.
- **Sizes headings from layout** (`XL` -> `#`, `L` -> `##`, `M` -> `###`, `S`/`XS` -> `####`) and strips noisy permalink anchors (`#`, `¶`, `🔗`, `permalink`) inside headings.
- **Suppresses bolding inside links** (since Blink marks almost all colored/underlined link text as emphasized).
- **Keeps callouts, accordions, tables, and embeds intact**, wrapping sidebars in `<aside>`, hidden/collapsed sections in `<details>`, paywalled sections in `[!IMPORTANT]` alerts, and turning broken iframes (`<host> refused to connect.`) into clean `[Link to <host> embed](url)` links.

## CLI

```bash
# Fetch a URL with Playwright and output distilled Markdown
npx chromium-clean-markdown https://www.debugbear.com/blog/content-visibility-api

# Dump the raw decoded AnnotatedPageContent protobuf as JSON
npx chromium-clean-markdown --json https://www.debugbear.com/blog/content-visibility-api

# Decode a base64 payload from stdin (skips launching Playwright)
npx chromium-clean-markdown --base64-stdin < payload.b64
```

## JS / TS API

```ts
import {
  processPage,
  convertToMarkdown,
  injectSemanticMarkers,
  decodeAnnotatedPageContent,
} from 'chromium-clean-markdown';

// High-level: launch Chromium, extract APC, and convert to Markdown
const proto = await processPage('https://web.dev/articles/lcp');
const markdown = convertToMarkdown(proto);
```

Or bring your own Playwright `Page` / CDP session:

```ts
const client = await page.context().newCDPSession(page);
await client.send('Page.enable');

// Optional: inject markers so <pre> and <code> survive layout extraction
await injectSemanticMarkers(page);

const {content} = await client.send('Page.getAnnotatedPageContent');
const proto = decodeAnnotatedPageContent(content);
const markdown = convertToMarkdown(proto);
```

**Playwright note:** When launching Chromium yourself, pass `chromium.launch({channel: 'chromium'})` so Playwright uses full Chrome for Testing (`--headless=new`) rather than `chrome-headless-shell`. Also note that `Page.getAnnotatedPageContent` rejects on `about:blank` or empty pages.

## Tradeoffs: Visual Extraction vs. HTML Syntax Parsers

Because `AnnotatedPageContent` throws away raw HTML tag names in favor of rendered layout and computed styles, it intentionally behaves differently from syntax-driven parsers like [Turndown](https://github.com/mixmark-io/turndown):

- Blink collapses `<b>`, `<strong>`, `<i>`, `<em>`, and `<u>` into a **single emphasis boolean**, which we render as `**bold**`.
- `<blockquote>` elements **flatten to normal paragraphs** (Blink doesn't emit a blockquote role, and injecting `> ` into the DOM breaks across wrapped lines).
- Payloads captured via `--base64-stdin` **without the DOM marker pass** emit `<pre>` and `<code>` as regular text.

We test against Turndown's suite in [`test/turndown-cdp.test.ts`](./test/turndown-cdp.test.ts): `pnpm test` runs the 37 syntax cases we expect to match verbatim alongside our CDP layout stress tests, while `pnpm run test:compatibility` runs all 139 Turndown cases for gap analysis.

To pull the latest `common_quality_data.proto` from Chromium `main` and regenerate the TypeScript bindings, see [updating.md](./updating.md).
