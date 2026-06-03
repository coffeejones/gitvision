// How it works — an in-workspace explainer (inside the Chambers shell):
// the process arc, the four departments, and the determinism promise. Deep
// mental-model docs still live at /help; this is the orientation. CH-themed,
// content-only.

import Link from "next/link";
import {
  ArrowUpRight,
  Stethoscope,
  Fingerprint,
  Microscope,
  Truck,
} from "lucide-react";
import { CH, CH_FOCUS } from "./theme";

const STEPS: { n: number; title: string; body: string }[] = [
  {
    n: 1,
    title: "Bring a repo before the bench",
    body: "Paste any public GitHub URL — or pick a private repo once you've connected GitHub. We fetch its history, manifests and code, no clone on your side.",
  },
  {
    n: 2,
    title: "Four departments examine it",
    body: "Health, Security, Forensics and Supply each vote on the repo using ~20 deterministic signals drawn from git history, dependency manifests and the parsed code graph.",
  },
  {
    n: 3,
    title: "They return one verdict",
    body: "Cleared, Conditional, or Returned — with a letter grade and the exact signals behind every claim. The grade can't outrank the ruling: a returned repo never reads as a B+.",
  },
  {
    n: 4,
    title: "Track it over time",
    body: "Refresh to re-examine. Each case shows how its verdict moved since you last looked, and flags when a repo has new commits worth re-checking.",
  },
];

const DEPARTMENTS: {
  icon: React.ReactNode;
  name: string;
  body: string;
}[] = [
  {
    icon: <Stethoscope size={14} />,
    name: "Health Department",
    body: "Vital signs — commit activity & cadence, team spread & bus-factor, repo hygiene, and whether tests are present.",
  },
  {
    icon: <Fingerprint size={14} />,
    name: "Security Bureau",
    body: "Safety decisions — vulnerable runtime dependencies (CVEs), leaked secrets, and risky dynamic-execution patterns.",
  },
  {
    icon: <Microscope size={14} />,
    name: "Forensics Lab",
    body: "Structure — untested hot files, cross-boundary coupling, deep import chains, and near-duplicate code.",
  },
  {
    icon: <Truck size={14} />,
    name: "Supply Office",
    body: "Supply chain — outdated & deprecated runtime packages, plus PR throughput and cycle-time as a delivery signal.",
  },
];

export function HowItWorksView() {
  return (
    <div>
      <header className="mb-7">
        <h1
          className="flex items-center gap-2.5 text-[28px] font-semibold tracking-tight"
          style={{ color: CH.text, letterSpacing: "-0.02em" }}
        >
          <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>
            📖
          </span>
          How it works
        </h1>
        <p className="mt-1 text-[14px]" style={{ color: CH.textDim }}>
          Every repo gets a verdict you can defend — here&apos;s how it&apos;s reached.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        {/* The process arc */}
        <section
          className="flex flex-col gap-5 rounded-xl p-6"
          style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
        >
          {STEPS.map((s) => (
            <div key={s.n} className="flex gap-4">
              <span
                className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-[13px] font-semibold"
                style={{ background: CH.accentSoft, color: CH.accent, border: `1px solid ${CH.accentBorder}` }}
              >
                {s.n}
              </span>
              <div className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold" style={{ color: CH.text }}>
                  {s.title}
                </span>
                <span className="text-[13px] leading-relaxed" style={{ color: CH.textDim }}>
                  {s.body}
                </span>
              </div>
            </div>
          ))}
        </section>

        {/* The four departments */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DEPARTMENTS.map((d) => (
            <section
              key={d.name}
              className="flex flex-col gap-2 rounded-xl p-5"
              style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: CH.brassLight }}>{d.icon}</span>
                <span className="text-[14px] font-semibold" style={{ color: CH.text }}>
                  {d.name}
                </span>
              </div>
              <p className="text-[12.5px] leading-relaxed" style={{ color: CH.textDim }}>
                {d.body}
              </p>
            </section>
          ))}
        </div>

        {/* Determinism note + deep docs link */}
        <section
          className="flex flex-col gap-2 rounded-xl p-5"
          style={{ background: CH.panel, border: `1px solid ${CH.border}` }}
        >
          <span className="text-[14px] font-semibold" style={{ color: CH.text }}>
            How we keep it honest
          </span>
          <p className="text-[13px] leading-relaxed" style={{ color: CH.textDim }}>
            Every signal is rule-based: same input, same verdict — no AI guessing.
            An optional AI layer only narrates the computed signals; it never
            invents a claim. Every sentence in a verdict maps back to a signal
            you can drill into.
          </p>
          <Link
            href="/help"
            className={`mt-1 inline-flex w-fit items-center gap-1.5 rounded text-[13px] font-medium transition hover:underline ${CH_FOCUS}`}
            style={{ color: CH.accent }}
          >
            Read the full docs — the mental models behind each panel
            <ArrowUpRight size={13} />
          </Link>
        </section>
      </div>
    </div>
  );
}
