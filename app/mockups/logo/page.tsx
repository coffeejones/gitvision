// Logo mockup gallery — 6 concept directions for RepoJury's visual
// identity (v0.74-polish). Each concept is rendered as inline SVG so
// you can see them at multiple sizes (favicon, small, large) and on
// both dark + light backgrounds in one scroll.
//
// How to use:
//   - Pick the concept that feels closest to RepoJury's voice
//   - Open the SVG source in this file, copy it into Figma to refine
//   - Tweak proportions, color, or replace strokes with your own
//     once you've picked a direction
//
// All concepts use TOK.accent (emerald #10b981) by default so they
// match the in-app theme. Several work equally well in monochrome —
// the SVGs use currentColor where it makes sense, so you can re-tint
// in Figma without rewriting the path.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { TOK } from "@/lib/theme";

export const metadata = {
  title: "Logo mockups — RepoJury",
};

const ACCENT = "#10b981";

export default function LogoMockupsPage() {
  return (
    <main className="max-w-6xl mx-auto px-8 pt-12 pb-20 flex flex-col gap-10">
      <div>
        <Link
          href="/mockups"
          className="text-xs inline-flex items-center gap-1.5 transition hover:underline"
          style={{ color: TOK.textSecondary }}
        >
          <ArrowLeft size={12} />
          Back to mockups
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <h1
          className="text-3xl font-semibold tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          Logo concepts.
        </h1>
        <p
          className="text-sm leading-relaxed max-w-2xl"
          style={{ color: TOK.textSecondary }}
        >
          Six directions for RepoJury&apos;s visual identity. Each shows the
          icon at three sizes plus an icon-with-wordmark lockup, on both
          dark and light backgrounds. Pick the one that lands closest, then
          take it into Figma to refine.
        </p>
      </header>

      <ConceptCard
        index="A"
        name="Concentric blast radius"
        rationale="Three concentric rings with a centred dot — visually echoes our blast-radius / impact-analysis core feature. Geometric, abstract, scales beautifully to favicon size."
        Icon={IconA}
      />

      <ConceptCard
        index="B"
        name="Branch-G monogram"
        rationale="The letter G constructed from a git branch-merge motif. Domain-specific (looks like a git graph), still readable as a typographic mark."
        Icon={IconB}
      />

      <ConceptCard
        index="C"
        name="Hex node + outgoing edges"
        rationale="A hexagonal graph node with three edges pointing outward — references our class-diagram canvas and dependency graphs. Modern, technical, fits the network-analysis theme."
        Icon={IconC}
      />

      <ConceptCard
        index="D"
        name="Eye + commit-dot"
        rationale="A minimalist eye where the pupil is a single git commit dot. Plays on the 'vision' part of the name without going cartoony. Riskier — eyes can feel cliché if not executed precisely."
        Icon={IconD}
      />

      <ConceptCard
        index="E"
        name="GV monogram"
        rationale="Pure typography: G and V locked together so V's left stroke doubles as G's right edge. Most enterprise-feeling. Easiest to use across formats but least distinct."
        Icon={IconE}
      />

      <ConceptCard
        index="F"
        name="Mini commit tree"
        rationale="A compact 4-commit git tree with one branch — instantly readable as 'this is about git'. Closest to literal product semantics. Trade-off: less abstract than A or C."
        Icon={IconF}
      />

      <footer
        className="pt-8 mt-4 text-xs border-t"
        style={{ borderColor: TOK.border, color: TOK.textMuted }}
      >
        Tip: right-click any SVG → &quot;Inspect&quot; in DevTools → copy the
        outerHTML to grab the raw markup. Paste into Figma (it imports SVG
        as editable vectors) to refine proportions or colors.
      </footer>
    </main>
  );
}

// ---------------- Card layout ----------------

function ConceptCard({
  index,
  name,
  rationale,
  Icon,
}: {
  index: string;
  name: string;
  rationale: string;
  Icon: React.ComponentType<{ size: number; color?: string }>;
}) {
  return (
    <section
      className="rounded-xl p-6 flex flex-col gap-5"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div className="flex items-baseline gap-3 flex-wrap">
        <span
          className="text-[11px] uppercase tracking-[0.18em] font-semibold"
          style={{ color: TOK.textMuted }}
        >
          Concept {index}
        </span>
        <h2
          className="text-lg font-semibold"
          style={{ color: TOK.textPrimary }}
        >
          {name}
        </h2>
      </div>
      <p
        className="text-sm leading-relaxed max-w-3xl"
        style={{ color: TOK.textSecondary }}
      >
        {rationale}
      </p>

      {/* Two side-by-side preview panels — dark + light */}
      <div className="grid md:grid-cols-2 gap-4">
        <PreviewPanel mode="dark" Icon={Icon} />
        <PreviewPanel mode="light" Icon={Icon} />
      </div>
    </section>
  );
}

function PreviewPanel({
  mode,
  Icon,
}: {
  mode: "dark" | "light";
  Icon: React.ComponentType<{ size: number; color?: string }>;
}) {
  const bg = mode === "dark" ? "#0a0a0c" : "#ffffff";
  const fg = mode === "dark" ? "#E8E8EE" : "#0a0a0c";
  const accent = mode === "dark" ? ACCENT : "#0e9f6e";
  const muted = mode === "dark" ? "#6E6E7E" : "#71717a";

  return (
    <div
      className="rounded-lg p-6 flex flex-col gap-5"
      style={{
        background: bg,
        border: `1px solid ${mode === "dark" ? "#23232E" : "#e4e4e7"}`,
      }}
    >
      <span
        className="text-[10px] uppercase tracking-[0.18em] font-semibold"
        style={{ color: muted }}
      >
        On {mode}
      </span>

      {/* Three sizes */}
      <div className="flex items-end gap-6">
        <SizeColumn label="64px">
          <Icon size={64} color={accent} />
        </SizeColumn>
        <SizeColumn label="32px">
          <Icon size={32} color={accent} />
        </SizeColumn>
        <SizeColumn label="16px (favicon)">
          <Icon size={16} color={accent} />
        </SizeColumn>
      </div>

      {/* Wordmark lockup — icon next to text */}
      <div className="flex items-center gap-3">
        <Icon size={28} color={accent} />
        <span
          className="text-xl font-semibold tracking-tight"
          style={{ color: fg, letterSpacing: "-0.02em" }}
        >
          RepoJury
        </span>
      </div>
    </div>
  );
}

function SizeColumn({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-end" style={{ minHeight: 64 }}>
        {children}
      </div>
      <span className="text-[10px]" style={{ color: "#71717a" }}>
        {label}
      </span>
    </div>
  );
}

// ---------------- Concept A: concentric blast radius ----------------

function IconA({ size, color = ACCENT }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer ring — most-faded */}
      <circle
        cx="32"
        cy="32"
        r="26"
        stroke={color}
        strokeWidth="2"
        opacity="0.25"
      />
      {/* Middle ring */}
      <circle
        cx="32"
        cy="32"
        r="17"
        stroke={color}
        strokeWidth="2"
        opacity="0.55"
      />
      {/* Inner ring */}
      <circle
        cx="32"
        cy="32"
        r="9"
        stroke={color}
        strokeWidth="2"
        opacity="0.85"
      />
      {/* Centre dot */}
      <circle cx="32" cy="32" r="3" fill={color} />
    </svg>
  );
}

// ---------------- Concept B: Branch-G monogram ----------------

function IconB({ size, color = ACCENT }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* The G shape: a near-circle with a horizontal bar that
          extends right (the G's "tongue"). We draw it as a thick
          stroke so it reads as a monogram, not a circle. The
          "branch" comes from a small offshoot at the top-right
          where a short line splits up — git-graph aesthetic. */}
      <path
        d="M 32 12
           A 20 20 0 1 0 32 52
           A 20 20 0 0 0 52 32
           L 38 32"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Branch offshoot — small line that suggests a git split */}
      <path
        d="M 47 18 L 54 12"
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="54" cy="12" r="2.5" fill={color} opacity="0.7" />
    </svg>
  );
}

// ---------------- Concept C: Hex node + outgoing edges ----------------

function IconC({ size, color = ACCENT }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outgoing edges — drawn behind the hex so it overlaps cleanly */}
      <line
        x1="32"
        y1="32"
        x2="56"
        y2="14"
        stroke={color}
        strokeWidth="2"
        opacity="0.5"
      />
      <line
        x1="32"
        y1="32"
        x2="56"
        y2="50"
        stroke={color}
        strokeWidth="2"
        opacity="0.5"
      />
      <line
        x1="32"
        y1="32"
        x2="8"
        y2="50"
        stroke={color}
        strokeWidth="2"
        opacity="0.5"
      />
      {/* Three small endpoint nodes — the dependencies */}
      <circle cx="56" cy="14" r="3" fill={color} opacity="0.5" />
      <circle cx="56" cy="50" r="3" fill={color} opacity="0.5" />
      <circle cx="8" cy="50" r="3" fill={color} opacity="0.5" />
      {/* Centre hex — the focal node */}
      <path
        d="M 32 14 L 48 23 L 48 41 L 32 50 L 16 41 L 16 23 Z"
        fill={color}
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------- Concept D: Eye + commit-dot ----------------

function IconD({ size, color = ACCENT }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Eye outline — almond shape via two arcs */}
      <path
        d="M 6 32 Q 32 12 58 32 Q 32 52 6 32 Z"
        stroke={color}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      {/* Commit-dot pupil + tiny line below to suggest a git node */}
      <circle cx="32" cy="32" r="6" fill={color} />
      {/* Suggestion of a tail / commit history below the eye */}
      <line
        x1="32"
        y1="38"
        x2="32"
        y2="46"
        stroke={color}
        strokeWidth="2"
        opacity="0.4"
      />
      <circle cx="32" cy="48" r="2" fill={color} opacity="0.4" />
    </svg>
  );
}

// ---------------- Concept E: GV monogram ----------------

function IconE({ size, color = ACCENT }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* The G — three-quarter circle with a horizontal tongue */}
      <path
        d="M 30 14
           A 16 16 0 1 0 30 46
           L 30 34
           L 22 34"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The V — locked into G's right edge, sharing a vertical */}
      <path
        d="M 36 18 L 46 46 L 56 18"
        stroke={color}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------- Concept F: Mini commit tree ----------------

function IconF({ size, color = ACCENT }: { size: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Main branch — vertical line, three commit dots */}
      <line
        x1="20"
        y1="12"
        x2="20"
        y2="52"
        stroke={color}
        strokeWidth="2.5"
      />
      <circle cx="20" cy="14" r="4" fill={color} />
      <circle cx="20" cy="32" r="4" fill={color} />
      <circle cx="20" cy="50" r="4" fill={color} />
      {/* Branch offshoot — curve out + back in (merge) */}
      <path
        d="M 20 22 Q 44 22 44 32 Q 44 42 20 42"
        stroke={color}
        strokeWidth="2.5"
        fill="none"
        opacity="0.7"
      />
      <circle cx="44" cy="32" r="4" fill={color} opacity="0.7" />
    </svg>
  );
}
