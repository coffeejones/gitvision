// News view — what shipped + what's coming, inside the Chambers shell.
// CH-themed twin of the marketing Roadmap. Content-only.

import { Sparkles, Calendar } from "lucide-react";
import { CH } from "./theme";

interface Item {
  tag: string;
  title: string;
  description: string;
}

const SHIPPED: Item[] = [
  {
    tag: "Jun 2026",
    title: "Trustworthy dependency grades",
    description:
      "Security & Supply now grade only your shipped/runtime deps — example apps, docs and CI pins no longer fail a repo. Modern pyproject configs parse, CVE checks resolve version ranges, and a repo is never its own dependency.",
  },
  {
    tag: "Jun 2026",
    title: "“Since last visit” on every survey",
    description:
      "Each survey shows how its grade moved since you last looked — grade, lens scores, and new criticals — plus a “New changes” nudge when a repo has new commits to re-sweep.",
  },
  {
    tag: "Jun 2026",
    title: "Surveys workspace",
    description:
      "A home for your surveys: worst-first ranking, a four-lens breakdown per repo, and public/private tabs.",
  },
  {
    tag: "May 2026",
    title: "CodeTrawl PR-bot",
    description:
      "One grounded review comment on every PR — the same deterministic signal layer as the workspace, zero LLM cost.",
  },
];

const COMING: Item[] = [
  {
    tag: "Next",
    title: "Auto-refresh on open",
    description:
      "A cheap upstream check when you open the workspace, so “since last visit” reflects what actually changed — without you clicking refresh.",
  },
  {
    tag: "Soon",
    title: "Per-lens policy",
    description:
      "Tune which lenses block vs. warn (e.g. Security gates a merge, Forensics only advises) so the grade fits your bar.",
  },
  {
    tag: "Planned",
    title: "Team & org workspace",
    description:
      "Shared surveys across a team, who-ran-what, and an org-wide worst-first board — not one account bought many times.",
  },
];

export function NewsView() {
  return (
    <div>
      <header className="mb-7">
        <h1
          className="text-[28px] font-semibold tracking-tight"
          style={{ color: CH.text, letterSpacing: "-0.025em" }}
        >
          News
        </h1>
        <p className="mt-1.5 text-[14px]" style={{ color: CH.textDim }}>
          What we shipped, and what&apos;s coming next.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Column
          icon={<Sparkles size={14} style={{ color: CH.accent }} />}
          label="What's new"
          labelColor={CH.accent}
          items={SHIPPED}
          tagShipped
        />
        <Column
          icon={<Calendar size={14} style={{ color: CH.textDim }} />}
          label="What's coming"
          labelColor={CH.textDim}
          items={COMING}
        />
      </div>
    </div>
  );
}

function Column({
  icon,
  label,
  labelColor,
  items,
  tagShipped,
}: {
  icon: React.ReactNode;
  label: string;
  labelColor: string;
  items: Item[];
  tagShipped?: boolean;
}) {
  return (
    <section
      className="flex flex-col gap-4 rounded-xl p-6"
      style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: labelColor }}
        >
          {label}
        </span>
      </div>
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.title} className="flex items-start gap-3">
            <span
              className="mt-0.5 min-w-[4.5rem] shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-[10px]"
              style={{
                color: tagShipped ? CH.accent : CH.textMuted,
                background: tagShipped ? CH.accentSoft : CH.elevated,
                border: `1px solid ${tagShipped ? CH.accentBorder : CH.border}`,
              }}
            >
              {item.tag}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[14px] font-medium" style={{ color: CH.text }}>
                {item.title}
              </span>
              <span className="text-[12.5px] leading-relaxed" style={{ color: CH.textDim }}>
                {item.description}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
