// Tests for template XSS detection. The negatives carry the weight, as with
// every other rule: a bare `{{ x }}` in an auto-escaping template is SAFE, and
// flagging it would wreck precision on every normal app.

import { describe, it, expect } from "vitest";
import { scanTemplateXss } from "../security/templateScan";

function tpl(content: string, ext = "html", rel = "templates/page.html") {
  return scanTemplateXss([{ rel, ext, content }]);
}

describe("scanTemplateXss", () => {
  it("flags the | safe filter", () => {
    const hits = tpl("<p>{{ post.text | safe }}</p>");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      ruleId: "py-template-safe-filter",
      severity: "medium",
      line: 1,
      origin: "template",
      inFunction: null,
    });
  });

  it("flags |safe with no surrounding spaces", () => {
    expect(tpl("{{ message|safe }}").map((h) => h.ruleId)).toEqual([
      "py-template-safe-filter",
    ]);
  });

  it("does NOT flag a bare interpolation — it is auto-escaped and safe", () => {
    // The precision-critical negative: the default template output IS escaped.
    expect(tpl("<h2>{{ course.title }}</h2>")).toEqual([]);
    expect(tpl("<p>{{ user.name }}</p>")).toEqual([]);
  });

  it("does NOT flag a safe-looking filter that isn't the safe filter", () => {
    expect(tpl("{{ x | safely }}")).toEqual([]);
    expect(tpl("{{ x | safe_html }}")).toEqual([]);
    expect(tpl("{{ x | escape }}")).toEqual([]);
  });

  it("excludes csrf_token — a framework value, not user input", () => {
    expect(tpl('const t = "{{ csrf_token|safe }}";')).toEqual([]);
    expect(tpl("{{ csrf_token | safe }}")).toEqual([]);
  });

  it("still flags a genuinely user-controlled value even inside script", () => {
    expect(tpl('<script>var x = "{{ user_input|safe }}";</script>').map((h) => h.ruleId)).toEqual([
      "py-template-safe-filter",
    ]);
  });

  it("flags {% autoescape off %} (Django) and false (Jinja)", () => {
    expect(tpl("{% autoescape off %}\n{{ x }}\n{% endautoescape %}").map((h) => h.ruleId)).toEqual([
      "py-template-autoescape-off",
    ]);
    expect(tpl("{% autoescape false %}{{ x }}{% endautoescape %}").map((h) => h.ruleId)).toEqual([
      "py-template-autoescape-off",
    ]);
  });

  it("does NOT flag {% autoescape on %} — that's escaping ENABLED", () => {
    expect(tpl("{% autoescape on %}{{ x }}{% endautoescape %}")).toEqual([]);
    expect(tpl("{% autoescape true %}{{ x }}{% endautoescape %}")).toEqual([]);
  });

  it("reports the right line and a trimmed snippet", () => {
    const hits = tpl("line one\nline two\n<td>{{ v | safe }}</td>\n");
    expect(hits[0].line).toBe(3);
    expect(hits[0].snippet).toBe("<td>{{ v | safe }}</td>");
  });

  it("scans .jinja2 / .j2 / .htm, ignores non-template extensions", () => {
    expect(tpl("{{ x|safe }}", "jinja2", "t.jinja2")).toHaveLength(1);
    expect(tpl("{{ x|safe }}", "j2", "t.j2")).toHaveLength(1);
    expect(tpl("{{ x|safe }}", "htm", "t.htm")).toHaveLength(1);
    // A .py file with the same bytes is not a template — the Python sink rules
    // own that world, not this scanner.
    expect(tpl("{{ x|safe }}", "py", "views.py")).toEqual([]);
  });

  it("caps findings per file", () => {
    const many = Array.from({ length: 80 }, (_, i) => `{{ v${i} | safe }}`).join("\n");
    expect(tpl(many).length).toBeLessThanOrEqual(50);
  });

  it("path-tags each finding to its file", () => {
    const hits = scanTemplateXss([
      { rel: "a/x.html", ext: "html", content: "{{ p|safe }}" },
      { rel: "b/y.jinja2", ext: "jinja2", content: "{{ q|safe }}" },
    ]);
    expect(hits.map((h) => h.filePath).sort()).toEqual(["a/x.html", "b/y.jinja2"]);
  });
});
