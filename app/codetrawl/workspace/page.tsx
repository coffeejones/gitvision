// /codetrawl/workspace — a no-login MOCK of the post-login Chambers workspace,
// so the CodeTrawl Stage-1 re-skin (re-colour + re-type) can be previewed
// without OAuth. noindex. Renders the real ChambersShell + CasesView with
// mock CaseItem data, wrapped so the CodeTrawl fonts (Schibsted Grotesk +
// Fragment Mono) reach them. No auth, no data fetch — purely visual.
//
// Stage 1 = colour + type only; the courtroom lexicon ("Cases", "before the
// bench", the 🗂️ header) and the card/dog-ear/ring shapes are intentionally
// untouched here — those are Stage 2/3.

import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { ChambersShell } from "@/components/chambers/ChambersShell";
import { CasesView } from "@/components/chambers/CasesView";
import type { CaseItem } from "@/components/chambers/CaseRow";
import { ctDisplay, ctMono } from "@/components/landing/codetrawl/ctFonts";

export const metadata: Metadata = {
  title: "Workspace mock — CodeTrawl",
  robots: { index: false, follow: false },
};

const MOCK_USER = {
  name: "Jonas",
  username: "coffeejones",
  tierName: "Open case",
  paid: false,
};

const PUBLIC_CASES: CaseItem[] = [
  {
    id: "m1",
    caseNo: "2026-0492",
    name: "legacy-api",
    repoFullName: "acme/legacy-api",
    isPrivate: false,
    grade: "D",
    score: 45,
    ruling: "Returned",
    criticalCount: 3,
    snapshotCount: 6,
    updatedAt: "2026-06-12T09:00:00Z",
    hasNewChanges: true,
    headline: "3 packages with critical CVEs; a secret was flagged in config.",
    departments: [
      { key: "Health", status: "warning" },
      { key: "Security", status: "critical" },
      { key: "Forensics", status: "warning" },
      { key: "Supply", status: "critical" },
    ],
    delta: {
      direction: "regressed",
      grade: { from: "C", to: "D" },
      scoreDelta: -15,
      criticalDelta: 2,
      departments: [{ key: "Security", from: "warning", to: "critical" }],
    },
  },
  {
    id: "m2",
    caseNo: "2026-0481",
    name: "flask",
    repoFullName: "pallets/flask",
    isPrivate: false,
    grade: "B+",
    score: 80,
    ruling: "Conditional",
    criticalCount: 0,
    snapshotCount: 3,
    updatedAt: "2026-06-11T14:30:00Z",
    headline: "flask/app.py concentrates churn across few authors.",
    departments: [
      { key: "Health", status: "ok" },
      { key: "Security", status: "ok" },
      { key: "Forensics", status: "warning" },
      { key: "Supply", status: "warning" },
    ],
  },
  {
    id: "m3",
    caseNo: "2026-0455",
    name: "zod",
    repoFullName: "colinhacks/zod",
    isPrivate: false,
    grade: "B",
    score: 75,
    ruling: "Conditional",
    criticalCount: 1,
    snapshotCount: 5,
    updatedAt: "2026-06-09T08:15:00Z",
    hasNewChanges: true,
    headline: "src/types.ts — 391 commits, one author. Bus-factor risk.",
    departments: [
      { key: "Health", status: "ok" },
      { key: "Security", status: "warning" },
      { key: "Forensics", status: "warning" },
      { key: "Supply", status: "ok" },
    ],
    delta: {
      direction: "regressed",
      grade: { from: "B+", to: "B" },
      scoreDelta: -5,
      criticalDelta: 1,
      departments: [{ key: "Security", from: "ok", to: "warning" }],
    },
  },
  {
    id: "m4",
    caseNo: "2026-0312",
    name: "gin",
    repoFullName: "gin-gonic/gin",
    isPrivate: false,
    grade: "A",
    score: 100,
    ruling: "Cleared",
    criticalCount: 0,
    snapshotCount: 2,
    updatedAt: "2026-05-28T17:45:00Z",
    headline: "All four departments cleared this codebase.",
    departments: [
      { key: "Health", status: "ok" },
      { key: "Security", status: "ok" },
      { key: "Forensics", status: "ok" },
      { key: "Supply", status: "ok" },
    ],
  },
];

const PRIVATE_CASES: CaseItem[] = [
  {
    id: "m5",
    caseNo: "2026-0467",
    name: "revise",
    repoFullName: "coffeejones/revise",
    isPrivate: true,
    grade: "C",
    score: 60,
    ruling: "Conditional",
    criticalCount: 0,
    snapshotCount: 4,
    updatedAt: "2026-06-10T11:00:00Z",
    headline: "Two dependencies are a major version behind.",
    departments: [
      { key: "Health", status: "ok" },
      { key: "Security", status: "ok" },
      { key: "Forensics", status: "ok" },
      { key: "Supply", status: "warning" },
    ],
  },
];

// Repoint Tailwind's font vars to the CodeTrawl families for this subtree, so
// the Chambers components (which use the default sans + `font-mono`) render in
// Schibsted Grotesk + Fragment Mono.
const FONT_VARS = {
  "--font-sans": "var(--font-ct-display)",
  "--font-mono": "var(--font-ct-mono)",
  fontFamily: "var(--font-ct-display)",
} as CSSProperties;

export default function WorkspaceMockPage() {
  return (
    <div className={`${ctDisplay.variable} ${ctMono.variable}`} style={FONT_VARS}>
      <ChambersShell active="cases" user={MOCK_USER}>
        <CasesView publicCases={PUBLIC_CASES} privateCases={PRIVATE_CASES} />
      </ChambersShell>
    </div>
  );
}
