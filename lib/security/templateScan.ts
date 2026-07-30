// Template XSS scanner (v0.82+).
//
// The RealVuln measurement found our single biggest in-scope gap: XSS, 0/79.
// The reason is structural — most of that XSS lives in TEMPLATE files
// (`.html`, `.jinja2`), not in Python, and the AST plugins never looked there.
// `py-mark-safe` was a weak stand-in for the Python side; this is the template
// side, where the bulk of it actually is.
//
// TWO HIGH-PRECISION RULES, chosen from what the ground truth actually labels:
//
//   safe filter        `{{ user_input | safe }}` — the `safe` filter disables
//                      the template engine's auto-escaping for that value. It
//                      is the template equivalent of mark_safe: a deliberate,
//                      unambiguous escape-off. Django and Jinja share it.
//   autoescape off     `{% autoescape off %}` (Django) / `{% autoescape false %}`
//                      (Jinja) — turns escaping off for a whole block. The
//                      opener IS the misconfiguration.
//
// Measured on RealVuln: `| safe` alone covers ~20 of 38 template-XSS lines.
//
// DELIBERATELY NOT flagged: a bare `{{ x }}`. In an auto-escaping template
// (the default for both Django and Flask/Jinja on .html) that is SAFE, and
// flagging it would be a precision catastrophe. The cases where a bare `{{ x }}`
// IS XSS depend on autoescape being disabled in PYTHON config (e.g.
// `aiohttp_jinja2.setup(app, autoescape=False)`) — a cross-file config read we
// don't do yet. A documented miss, not a wrong answer.
//
// REACHABILITY: a template sink is `unknown`. It has no function and no call
// edge, so classifySinks cannot trace it — and we have no view→template linkage
// yet. Honest: we found an escape-disabled interpolation, we cannot prove which
// view renders it. `unknown` is surfaced, never suppressed.

import type { SinkGraphEntry } from "../codeAnalysis/types";

interface SourceLike {
  rel: string;
  ext: string;
  content: string;
}

/** Extensions the walker reads as templates (registered on regexFallback so the
 *  file walker includes them). */
export const TEMPLATE_EXTENSIONS: ReadonlySet<string> = new Set([
  "html",
  "htm",
  "jinja",
  "jinja2",
  "j2",
]);

/** `{{ ... | safe }}` — the safe filter, with or without spaces around the
 *  pipe, anywhere inside a `{{ }}` interpolation. `\bsafe\b` so `safely` or a
 *  `safe_html` custom filter don't match. Captures the piped expression so a
 *  framework-trusted value can be excluded. */
/** bootstrap-flask's `render_table(..., safe_columns=['x'])` — the named
 *  columns are emitted unescaped. `safe_columns=[]` is the escaping-ON form and
 *  must stay quiet, which is why a non-empty first element is required.
 *
 *  Measured: 0 hits across 688 production template files, while NetBox uses the
 *  bare name `render_table` 51 times (django_tables2's unrelated tag) — so the
 *  silence is discrimination, not absence. */
const SAFE_COLUMNS = /\{\{[^}]*\brender_table\s*\([^}]*\bsafe_columns\s*=\s*\[\s*[^\]\s][^}]*\}\}/g;

const SAFE_FILTER = /\{\{\s*([^|}]*?)\s*\|\s*safe\b(?:[^}]*?)\}\}/g;

/** Values the framework generates, not the user — `| safe` on them is correct
 *  usage, not XSS. Deliberately tiny: `csrf_token` is unambiguous. Form fields
 *  and other values are genuinely ambiguous (a form can echo user input), so
 *  they are NOT excluded — we keep the finding and let the reader judge. */
const TRUSTED_TEMPLATE_VALUES = new Set(["csrf_token"]);

/** Attributes the FRAMEWORK fills from the developer's own form definition, not
 *  from a request. `{{ field.help_text|safe }}` is the standard Django
 *  crispy-forms idiom and appeared in 10 of 64 false positives across 39
 *  realistic applications (§4w) — always as boilerplate in a generated form
 *  template. The `|safe` there is correct: help text is authored in Python. */
const TRUSTED_TEMPLATE_ATTRS = /\.(help_text|label|label_tag|as_p|as_table|as_ul|errors)$/;

/** `{% autoescape off %}` (Django) / `{% autoescape false %}` (Jinja). */
const AUTOESCAPE_OFF = /\{%\s*autoescape\s+(?:off|false)\s*%\}/gi;

/** Per-file cap so a generated template can't flood the panel. */
const MAX_PER_FILE = 50;

function lineOf(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (content[i] === "\n") line++;
  return line;
}

function lineText(content: string, offset: number): string {
  let start = offset;
  while (start > 0 && content[start - 1] !== "\n") start--;
  let end = offset;
  while (end < content.length && content[end] !== "\n") end++;
  const t = content.slice(start, end).trim();
  return t.length > 200 ? `${t.slice(0, 200)}…` : t;
}

/** Scan template files for escape-disabling XSS sinks. Pure: files in, findings
 *  out. Only files with a template extension are considered. */
export function scanTemplateXss(files: SourceLike[]): SinkGraphEntry[] {
  const out: SinkGraphEntry[] = [];
  for (const file of files) {
    if (!TEMPLATE_EXTENSIONS.has(file.ext)) continue;
    let perFile = 0;
    const emit = (offset: number, ruleId: string) => {
      if (perFile >= MAX_PER_FILE) return;
      perFile++;
      out.push({
        filePath: file.rel,
        ruleId,
        severity: "medium",
        line: lineOf(file.content, offset),
        inFunction: null,
        origin: "template",
        snippet: lineText(file.content, offset),
      });
    };
    for (const m of file.content.matchAll(SAFE_COLUMNS)) {
    emit(m.index ?? 0, "py-template-safe-columns");
  }

  for (const m of file.content.matchAll(SAFE_FILTER)) {
      const piped = (m[1] ?? "").trim();
      if (TRUSTED_TEMPLATE_VALUES.has(piped)) continue;
      if (TRUSTED_TEMPLATE_ATTRS.test(piped)) continue;
      emit(m.index ?? 0, "py-template-safe-filter");
    }
    for (const m of file.content.matchAll(AUTOESCAPE_OFF)) {
      emit(m.index ?? 0, "py-template-autoescape-off");
    }
  }
  return out;
}
