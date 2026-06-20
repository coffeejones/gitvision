// Watch regression-alert email. Sent by the monitor when a repo a user put on
// Watch got worse since the last sweep. One email per user, listing all of
// their regressions in this run (so a noisy day is one email, not ten).
//
// Plain-text paragraphs (the shared layout escapes them) — the substance is
// the per-repo one-liner the monitor already computed (e.g. "B→C · +2
// critical · Security regressed"), so there's nothing fancy to format.

import {
  renderEmailLayout,
  renderEmailText,
  type EmailLayoutOptions,
} from "./_shared";
import type { WatchAlert } from "@/lib/watchMonitor";

export function watchAlertEmail(input: {
  alerts: WatchAlert[];
  siteUrl: string;
}): { subject: string; html: string; text: string } {
  const { alerts, siteUrl } = input;
  const n = alerts.length;
  const one = alerts[0];

  const subject =
    n === 1
      ? one.gradeFrom && one.gradeTo
        ? `CodeTrawl: ${one.repoFullName} dropped to ${one.gradeTo}`
        : `CodeTrawl: ${one.repoFullName} regressed`
      : `CodeTrawl: ${n} watched repos regressed`;

  const heading =
    n === 1 ? "A repo you're watching regressed" : `${n} repos you're watching regressed`;

  const paragraphs = [
    n === 1
      ? "Since the last sweep, a repo you put on Watch got worse:"
      : "Since the last sweep, some repos you put on Watch got worse:",
    ...alerts.map((a) => `${a.repoFullName} — ${a.summary}`),
  ];

  // One regression → straight to its grade; several → the workspace list.
  const cta: EmailLayoutOptions["cta"] =
    n === 1
      ? { label: "Open the survey", href: `${siteUrl}/session/${one.sessionId}/verdict` }
      : { label: "Open your surveys", href: `${siteUrl}/cases` };

  const opts: EmailLayoutOptions = {
    brand: "CodeTrawl",
    heading,
    paragraphs,
    cta,
    footnote:
      "You're getting this because you put these repos on Watch. Stop watching them any time from your CodeTrawl workspace.",
  };

  return {
    subject,
    html: renderEmailLayout(opts),
    text: renderEmailText(opts),
  };
}
