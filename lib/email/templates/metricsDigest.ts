// Weekly founder-metrics digest — the passive "is it growing?" view, pushed to
// the admin's inbox so there's nothing to remember to open (and zero inbound
// surface). Built from the same PII-free Metrics object the CLI uses.

import { renderEmailLayout, renderEmailText, type EmailLayoutOptions } from "./_shared";
import type { Metrics } from "@/lib/metrics";

function delta(now: number, prev: number): string {
  if (prev === 0) return now > 0 ? "new this week" : "flat";
  const d = now - prev;
  return `${d >= 0 ? "+" : ""}${d} vs last week`;
}

export function metricsDigestEmail(m: Metrics): {
  subject: string;
  html: string;
  text: string;
} {
  const a = m.accounts;
  const an = m.analyses;
  const top = m.topRepos
    .slice(0, 3)
    .map((r) => `${r.repo} (${r.count})`)
    .join(", ");

  const subject = `CodeTrawl this week: +${a.thisWeek} account${a.thisWeek === 1 ? "" : "s"} · ${an.thisWeek} analyses`;

  const opts: EmailLayoutOptions = {
    brand: "CodeTrawl",
    heading: "Your CodeTrawl week",
    paragraphs: [
      `This week: ${a.thisWeek} new account${a.thisWeek === 1 ? "" : "s"} (${delta(a.thisWeek, a.prevWeek)}) and ${an.thisWeek} repo analyses (${delta(an.thisWeek, an.prevWeek)}).`,
      `Totals: ${a.total} accounts · ${a.paid} paid (Plus ${a.byTier.Plus ?? 0} · Pro ${a.byTier.Pro ?? 0}) · ${an.total} analyses across ${an.uniqueRepos} repos · ${an.refreshes} re-runs.`,
      top ? `Most analyzed: ${top}.` : "No analyses yet — the sea is still.",
    ],
    footnote:
      "You're getting this because you're the CodeTrawl admin. It's a deterministic snapshot of your own product's counts — no third-party tracking.",
  };

  return {
    subject,
    html: renderEmailLayout(opts),
    text: renderEmailText(opts),
  };
}
