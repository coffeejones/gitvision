// Client-side syntax highlighting for the Source view, via Shiki's JavaScript
// RegExp engine — NOT the oniguruma WASM engine. The project already fights
// WASM in the build (tree-sitter needs webpack + serverExternalPackages); the JS
// engine sidesteps all of that at a small accuracy cost on exotic grammars,
// which is the right trade for a read-only viewer of mainstream source.
//
// One highlighter instance is created lazily and cached; grammars load on demand
// (only the languages actually opened get fetched). Output is decoupled from
// Shiki's own token type so CodeView — and its tests — don't depend on Shiki.

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

/** One highlighted token: text plus its resolved hex colour. */
export interface Tok {
  content: string;
  color?: string;
}
export type CodeLines = Tok[][];

const THEME = "github-dark-default";

/** Extension → Shiki language id. Only languages we can meaningfully highlight;
 *  anything else falls back to un-highlighted plain text (still line-numbered). */
const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  java: "java",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  kt: "kotlin",
  swift: "swift",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  css: "css",
  scss: "scss",
  html: "html",
  vue: "vue",
  svelte: "svelte",
  md: "markdown",
  sh: "shellscript",
  bash: "shellscript",
  sql: "sql",
};

/** Dynamic grammar loaders, keyed by Shiki language id. Each is a separate
 *  webpack chunk so only opened languages are ever fetched. */
const LANG_LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  shellscript: () => import("shiki/langs/bash.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
};

let hlPromise: Promise<HighlighterCore> | null = null;
const loaded = new Set<string>();

function getHighlighter(): Promise<HighlighterCore> {
  if (!hlPromise) {
    hlPromise = createHighlighterCore({
      themes: [import("shiki/themes/github-dark-default.mjs")],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return hlPromise;
}

/** Un-highlighted fallback: one plain token per line, so a file we can't
 *  highlight still renders with line numbers and gutters. */
function plain(code: string): CodeLines {
  return code.split("\n").map((line) => [{ content: line }]);
}

/** Highlight source into per-line tokens. Never throws — an unknown language or
 *  a grammar that fails to load degrades to plain (un-highlighted) lines. */
export async function highlightToLines(
  code: string,
  ext: string,
): Promise<{ lines: CodeLines; lang: string | null }> {
  const lang = LANG_BY_EXT[ext];
  const loader = lang ? LANG_LOADERS[lang] : undefined;
  if (!lang || !loader) return { lines: plain(code), lang: null };

  try {
    const hl = await getHighlighter();
    if (!loaded.has(lang)) {
      await hl.loadLanguage(loader() as never);
      loaded.add(lang);
    }
    const tokens = hl.codeToTokensBase(code, { lang, theme: THEME });
    const lines: CodeLines = tokens.map((row) =>
      row.map((t) => ({ content: t.content, color: t.color })),
    );
    return { lines, lang };
  } catch {
    return { lines: plain(code), lang: null };
  }
}
