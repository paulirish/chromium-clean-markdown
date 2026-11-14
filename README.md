# page-distiller

Turn any webpage into clean Markdown (`URL -> Markdown`): **just the actual content**, without headers, footers, nav bars, sidebars, ad slots, or layout wrapper soup.

```bash
npx page-distiller https://web.dev/articles/lcp
```

## Why? (And what is `AnnotatedPageContent`?)

If you pipe a webpage's DOM into an HTML-to-Markdown converter like [Turndown](https://github.com/mixmark-io/turndown), you get the *entire* DOM: mega-menus, header links, footer sitemaps, cookie banners, sidebar widgets, and "related posts" cards. Half your output (and context window) goes to page chrome instead of the article.

Deep inside Chromium is a feature almost no web developers know about (and tbh most Chromium engineers don't realize you can grab over CDP and decode in JS): **Annotated Page Content** (`APC`).

Chrome built [`AIPageContentAgent`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/content_extraction/ai_page_content_agent.cc) inside Blink to power "Gemini in Chrome" and Optimization Guide features, and exposed it over the Chrome DevTools Protocol as [`Page.getAnnotatedPageContent`](https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-getAnnotatedPageContent).

When you call `Page.getAnnotatedPageContent`, Chrome returns a base64-encoded binary protobuf matching [`AnnotatedPageContent`](https://source.chromium.org/chromium/chromium/src/+/main:components/optimization_guide/proto/features/common_quality_data.proto) (`common_quality_data.proto`). `page-distiller` compiles that `.proto` definition to JS with `@bufbuild/protobuf`, decodes the binary tree in Node, isolates the main content, and serializes it into clean Markdown.

In short: you get the page's real content at **50% to 70% smaller byte/token size** than converting raw HTML:

| Page | Raw HTML -> `turndown` | `page-distiller` | Reduction |
| :--- | ---: | ---: | ---: |
| `web.dev/articles/lcp` | 21.0 KB | **11.0 KB** | **47% smaller** |
| `paulirish.com` | 7.4 KB | **2.4 KB** | **67% smaller** |

## How Chrome generates `AnnotatedPageContent`

Unlike Readability or DOM-to-Markdown scripts that parse raw HTML strings and guess from tag names, [`AIPageContentAgent`](https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/modules/content_extraction/ai_page_content_agent.cc) runs **inside Blink after style and layout** (`UpdateLifecycleToLayoutClean`). It walks the live **`LayoutObject` tree** across the main document and any embedded iframes (including cross-process OOPIFs, stitched together in the browser process by [`page_content_proto_provider.cc`](https://source.chromium.org/chromium/chromium/src/+/main:components/optimization_guide/content/browser/page_content_proto_provider.cc)).

A lot of magic happens during that C++ layout walk:

- Unstyled `<div>` and `<span>` **wrapper soup disappears automatically**. If a layout box has no semantic role, interaction state, or sticky/fixed/scrollable behavior, `ShouldSkipSingleNode()` skips the wrapper and hoists its visible children straight up into a sparse tree.
- Visibility is **computed from layout**, not guessed. Nodes with `display: none`, `visibility: hidden`, or empty `0x0` geometry are dropped. Even better: Blink temporarily forces `content-visibility: hidden` and `hidden="until-found"` display locks open (`ScopedForceActivatableDisplayLocks`) so collapsed accordion content gets laid out and extracted, tagging those subtrees with `ANNOTATED_ROLE_CONTENT_HIDDEN`.
- Typography comes **straight from `ComputedStyle`**. Instead of trusting `<h*>` or `<b>` tags, Blink compares each `LayoutText` leaf's `ComputedFontSize()` against the root document font size to bucket text into `XL` (`>= 2em`), `L` (`>= 1.17em`), `M`, `S`, and `XS` (`GetTextSize`). It also checks computed `font-weight`, `font-style`, applied `text-decoration`, and `vertical-align: sub/super` to set `has_emphasis`.
- Landmarks, ads, and paywalls are **tagged natively**. Blink combines HTML tags (`<main>`, `<article>`, `<nav>`, `<header>`, `<footer>`, `<aside>`, `<search>`) and explicit ARIA roles into `AnnotatedRole`s, queries Chrome's Subresource Filter (`element->IsAdRelated()`) to flag ad nodes with `is_ad_related: true`, and checks schema.org `isAccessibleForFree=false` metadata to tag `ANNOTATED_ROLE_PAID_CONTENT`.

## How `page-distiller` turns it into Markdown

Turning Chrome's `AnnotatedPageContent` proto into good Markdown takes a 3-step pipeline ([`scripts/distill-page.ts`](./scripts/distill-page.ts) and [`scripts/decode_annotations.ts`](./scripts/decode_annotations.ts)):

### 1. Bridging the `<pre>` / `<code>` gap (`injectSemanticMarkers`)

Because `AnnotatedPageContent` was designed for visual/layout extraction, Blink's `TextStyle` doesn't record monospace fonts or `<code>`/`<pre>` tags. Left alone, inline code and code blocks flatten into ordinary `TEXT` nodes.

Before calling `Page.getAnnotatedPageContent`, we run a tiny `page.evaluate()` pass that wraps `<code>` and outermost `<pre>` elements in Unicode Private Use Area delimiters (`\uE000distill-page-...\uE001`). Blink includes those characters verbatim inside its `LayoutText` runs, so our parser can reconstruct fenced code blocks and backtick spans (even with nested backticks or bold runs crossing inline code).

### 2. Isolating the content root & pruning noise (`parseProtoToAST`)

We decode the base64 protobuf payload and compile the `ContentNode` tree into a typed intermediate AST (`ASTDocument`):

- Picks the **largest `MAIN` landmark** if it holds at least 50% of the page's text (`findContentRoot`), so small promo/shell `<main>` blocks or inline `<article>` cards don't hijack or truncate extraction (falling back to a dominant `ARTICLE` or the page root).
- Prunes any subtree tagged with **`ANNOTATED_ROLE_NAV`, `ANNOTATED_ROLE_FOOTER`, or `isAdRelated: true`**.
- Strips noisy **heading permalink anchors** (`#`, `¶`, `🔗`, `permalink`) and suppresses `has_emphasis` bolding inside `[text](url)` links (since Blink flags nearly all colored/underlined link text as emphasized).
- Maps `ASIDE` subtrees to `<aside>`, `CONTENT_HIDDEN` subtrees to `<details><summary>Collapsed Content</summary>`, `PAID_CONTENT` to `[!IMPORTANT]` alerts, `TableData.table_name` to table headers, and failed iframes (`<host> refused to connect.`) into `[Link to <host> embed](url)` links.

### 3. Serializing to Markdown (`convertToMarkdown`)

A separate pass walks the `ASTDocument`, merges contiguous bold and inline-code segments, sizes headings (`XL` -> `#`, `L` -> `##`, `M` -> `###`, `S`/`XS` -> `####`), and formats GFM tables and lists.

## CLI

```bash
# Fetch a URL with Playwright and output distilled Markdown
npx page-distiller https://www.debugbear.com/blog/content-visibility-api

# Dump the raw decoded AnnotatedPageContent protobuf as JSON
npx page-distiller --json https://www.debugbear.com/blog/content-visibility-api

# Decode a base64 payload from stdin (skips launching Playwright)
npx page-distiller --base64-stdin < payload.b64
```

## JS / TS API

```ts
import {
  processPage,
  convertToMarkdown,
  injectSemanticMarkers,
  decodeAnnotatedPageContent,
} from 'page-distiller';

// High-level: launch Chromium, extract APC, and convert to Markdown
const proto = await processPage('https://web.dev/articles/lcp');
const markdown = convertToMarkdown(proto);
```

Or bring your own Playwright `Page` / CDP session:

```ts
const client = await page.context().newCDPSession(page);
await client.send('Page.enable');

// Optional: inject private-use markers so <pre> and <code> survive layout extraction
await injectSemanticMarkers(page);

const {content} = await client.send('Page.getAnnotatedPageContent');
const proto = decodeAnnotatedPageContent(content);
const markdown = convertToMarkdown(proto);
```

**Headless note:** When launching Chromium yourself, use Chrome's new headless mode (`headless: false` in Playwright with `--headless=new` in `args`, plus `--enable-features=OptimizationHints,PageContentAnnotation,OptimizationGuideModelDownloading --enable-dom-distiller`). Legacy headless mode fails with a CDP `Protocol error` on `Page.getAnnotatedPageContent`, and `about:blank` / empty pages will also reject.

## Tradeoffs: Visual Extraction vs. HTML Syntax Parsers

Because `AnnotatedPageContent` throws away raw HTML tag names in favor of rendered layout and computed styles, it intentionally behaves differently from syntax-driven parsers like [Turndown](https://github.com/mixmark-io/turndown):

- Blink's `TextStyle` collapses `<b>`, `<strong>`, `<i>`, `<em>`, and `<u>` into a **single `has_emphasis: true` boolean**, which we render as `**bold**`.
- `<blockquote>` elements **flatten to normal paragraphs**. Blink's layout extractor maps `<blockquote>` to `AX_ROLE_UNKNOWN`, and injecting `> ` prefixes into raw DOM nodes breaks across multi-line blocks.
- When using `--base64-stdin` on a payload captured **without `injectSemanticMarkers()`**, `<pre>` and `<code>` blocks lack our private-use DOM delimiters and emit as regular text.

We test against Turndown's suite in [`test/turndown-cdp.test.ts`](./test/turndown-cdp.test.ts): `pnpm test` runs the 37 syntax cases we expect to match verbatim alongside our CDP layout stress tests, while `pnpm run test:compatibility` runs all 139 Turndown cases for gap analysis.

To pull the latest `common_quality_data.proto` from Chromium `main` and regenerate the TypeScript protobuf bindings, see [updating.md](./updating.md).
