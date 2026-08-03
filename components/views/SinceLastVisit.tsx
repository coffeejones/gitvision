// "Since your last visit" hero banner. Story-led layout: one leading
// headline picked by lib/diff.ts's pickHeadline, plus a row of supporting
// chips with the secondary signals. Designed to be screenshot-worthy on
// its own — branded footer + accent gradient + concrete examples
// (file paths, contributor handles) instead of flat numbers.
//
// When pickHeadline returns null, we degrade to the minimal "nothing
// new" ribbon — same as before. The hero only renders when there's an
// actual story to tell.

import {
  Code as CodeIcon,
  CircleDot,
  Flame,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Star,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import type { SnapshotDiff, Headline } from "@/lib/diff";
import { pickHeadline } from "@/lib/diff";
import { STYLE, TOK } from "@/lib/sessionTheme";
import { HelpHint } from "@/components/HelpHint";
import { formatDateTimeAbs } from "@/lib/formatLocale";

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = 60_000,
    hr = 60 * min,
    day = 24 * hr;
  if (diff < min) return "moments";
  if (diff < hr) return `${Math.floor(diff / min)}m`;
  if (diff < day) return `${Math.floor(diff / hr)}h ${Math.floor((diff % hr) / min)}m`;
  const days = Math.floor(diff / day);
  if (days < 30) return `${days}d`;
  // Stay relative beyond a month — both call sites append " ago", so an
  // absolute date here produced "29.4.2026 ago". Mirror CaseRow's mo/y units.
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(months / 12)}y`;
}

/** Format a path for display: take the basename for breathing room, full
 *  path on hover via title. */
function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

/** Decide which icon goes with which headline. Returned as a render-prop
 *  so the caller controls sizing + color. */
function HeadlineIcon({
  headline,
  size = 18,
}: {
  headline: Headline;
  size?: number;
}) {
  switch (headline.kind) {
    case "contributors":
      return <UserPlus size={size} />;
    case "hotspot-rise":
      return <Flame size={size} />;
    case "complexity-spike":
      return headline.delta >= 0 ? (
        <TrendingUp size={size} />
      ) : (
        <TrendingDown size={size} />
      );
    case "commits":
      return <GitCommit size={size} />;
    case "stars":
      return <Star size={size} />;
  }
}

/** Render the leading sentence(s) for a headline kind. Top line is the
 *  primary statement; second line is optional context. */
function HeadlineCopy({ headline }: { headline: Headline }) {
  switch (headline.kind) {
    case "contributors": {
      const word =
        headline.count === 1 ? "new contributor" : "new contributors";
      return (
        <>
          <div className="text-xl font-semibold leading-tight tracking-tight">
            <span style={{ color: TOK.accent }}>{headline.count}</span>{" "}
            {word} joined
          </div>
          {headline.lead && (
            <div
              className="text-sm mt-1"
              style={{ color: TOK.textSecondary }}
            >
              <span className="font-mono" style={{ color: TOK.textPrimary }}>
                {headline.lead.login}
              </span>{" "}
              led with {headline.lead.count}{" "}
              {headline.lead.count === 1 ? "commit" : "commits"}
            </div>
          )}
        </>
      );
    }
    case "hotspot-rise":
      return (
        <>
          <div
            className="text-lg font-semibold leading-tight font-mono break-all"
            title={headline.path}
          >
            {basename(headline.path)}{" "}
            <span style={{ color: TOK.textSecondary, fontWeight: 400 }}>
              is now your{" "}
              {headline.toRank === 1
                ? "biggest"
                : headline.toRank === 2
                  ? "second biggest"
                  : "third biggest"}{" "}
              hotspot
            </span>
          </div>
          <div
            className="text-sm mt-1"
            style={{ color: TOK.textSecondary }}
          >
            Up from{" "}
            <span style={{ color: TOK.accent, fontWeight: 600 }}>
              #{headline.fromRank}
            </span>{" "}
            last visit
          </div>
        </>
      );
    case "complexity-spike": {
      const positive = headline.delta >= 0;
      const verb = positive ? "grew" : "shrank";
      const abs = Math.abs(headline.delta);
      return (
        <>
          <div className="text-xl font-semibold leading-tight tracking-tight">
            Code complexity{" "}
            <span style={{ color: positive ? TOK.amber : TOK.accent }}>
              {verb} by {abs}
            </span>
          </div>
          <div
            className="text-sm mt-1"
            style={{ color: TOK.textSecondary }}
          >
            {positive
              ? "New branching logic added across the codebase"
              : "Refactors and removals netted lower complexity"}
          </div>
        </>
      );
    }
    case "commits": {
      const word = headline.count === 1 ? "new commit" : "new commits";
      return (
        <>
          <div className="text-xl font-semibold leading-tight tracking-tight">
            <span style={{ color: TOK.accent }}>{headline.count}</span>{" "}
            {word} since last visit
          </div>
          {headline.lead && (
            <div
              className="text-sm mt-1"
              style={{ color: TOK.textSecondary }}
            >
              <span className="font-mono" style={{ color: TOK.textPrimary }}>
                {headline.lead.login}
              </span>{" "}
              committed {headline.lead.count} of them
            </div>
          )}
        </>
      );
    }
    case "stars":
      return (
        <div className="text-lg font-semibold leading-tight">
          <span style={{ color: TOK.accent }}>+{headline.delta}</span> stars
          since last visit
        </div>
      );
  }
}

/** A single supporting-chip. Compact, icon-led.
 *
 *  `emphasis` distinguishes "primary momentum" chips (commits, PRs —
 *  the heart of the activity story) from "secondary" stats (stars,
 *  issues, complexity). Primary chips get a stronger background tint;
 *  secondary stays neutral. Same chip size + spacing for both — the
 *  visual hierarchy is in fill, not dimensions. */
function Chip({
  icon,
  label,
  tone = "default",
  emphasis = "secondary",
  title,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  tone?: "default" | "positive" | "warning";
  emphasis?: "primary" | "secondary";
  title?: string;
}) {
  const color =
    tone === "positive"
      ? TOK.accent
      : tone === "warning"
        ? TOK.amber
        : TOK.textSecondary;
  const background =
    emphasis === "primary" ? TOK.accentSoft : TOK.surfaceElevated;
  const borderColor =
    emphasis === "primary" ? `${TOK.accent}33` : TOK.border;
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded"
      style={{
        background,
        border: `1px solid ${borderColor}`,
        color,
      }}
      title={title}
    >
      <span style={{ color }} aria-hidden>
        {icon}
      </span>
      {label}
    </span>
  );
}

/** Build the array of supporting chips, omitting any signal that's
 *  already represented by the headline (so the chips don't repeat the
 *  lead). */
function buildSupportingChips(
  diff: SnapshotDiff,
  headline: Headline
): React.ReactElement[] {
  const out: React.ReactElement[] = [];

  // Stars — show whenever there's a change AND it's not the headline
  if (diff.starsDelta !== 0 && headline.kind !== "stars") {
    const positive = diff.starsDelta > 0;
    out.push(
      <Chip
        key="stars"
        icon={<Star size={11} />}
        label={
          <>
            <span
              style={{
                color: positive ? TOK.accent : TOK.rose,
                fontWeight: 600,
              }}
            >
              {positive ? "+" : ""}
              {diff.starsDelta}
            </span>{" "}
            stars
          </>
        }
        tone={positive ? "positive" : "default"}
      />
    );
  }

  // PRs merged — primary activity signal, gets emphasis
  if (diff.newPRsMerged > 0) {
    out.push(
      <Chip
        key="prs"
        icon={<GitPullRequest size={11} />}
        label={
          <>
            <span style={{ color: TOK.accent, fontWeight: 600 }}>
              {diff.newPRsMerged}
            </span>{" "}
            PR{diff.newPRsMerged === 1 ? "" : "s"} merged
          </>
        }
        tone="positive"
        emphasis="primary"
      />
    );
  }

  // Open issues — phrase positively so the minus sign + green color
  // doesn't read as "this is bad". Closing issues is good news; we say
  // so directly instead of leaving the reader to infer it from a sign.
  if (diff.openIssuesDelta !== 0) {
    const opened = diff.openIssuesDelta > 0;
    const abs = Math.abs(diff.openIssuesDelta);
    out.push(
      <Chip
        key="issues"
        icon={<CircleDot size={11} />}
        label={
          opened ? (
            <>
              <span style={{ color: TOK.amber, fontWeight: 600 }}>
                +{abs}
              </span>{" "}
              new issue{abs === 1 ? "" : "s"}
            </>
          ) : (
            <>
              <span style={{ color: TOK.accent, fontWeight: 600 }}>
                {abs}
              </span>{" "}
              issue{abs === 1 ? "" : "s"} closed
            </>
          )
        }
        tone={opened ? "warning" : "positive"}
      />
    );
  }

  // Commits — only as a chip when not in the headline; primary activity
  if (diff.newCommits > 0 && headline.kind !== "commits") {
    out.push(
      <Chip
        key="commits"
        icon={<GitCommit size={11} />}
        label={
          <>
            <span style={{ color: TOK.accent, fontWeight: 600 }}>
              +{diff.newCommits}
            </span>{" "}
            commits
          </>
        }
        tone="positive"
        emphasis="primary"
      />
    );
  }

  // Contributors — only as a chip when not in the headline
  if (
    diff.newContributors.length > 0 &&
    headline.kind !== "contributors"
  ) {
    out.push(
      <Chip
        key="contributors"
        icon={<Users size={11} />}
        label={
          <>
            <span style={{ color: TOK.accent, fontWeight: 600 }}>
              +{diff.newContributors.length}
            </span>{" "}
            contributor{diff.newContributors.length === 1 ? "" : "s"}
          </>
        }
        tone="positive"
        title={diff.newContributors.join(", ")}
      />
    );
  }

  // Functions delta — interesting for codebases under active development
  if (
    diff.functionsDelta !== null &&
    Math.abs(diff.functionsDelta) > 0
  ) {
    const positive = diff.functionsDelta > 0;
    out.push(
      <Chip
        key="functions"
        icon={<CodeIcon size={11} />}
        label={
          <>
            <span
              style={{
                color: positive ? TOK.accent : TOK.rose,
                fontWeight: 600,
              }}
            >
              {positive ? "+" : ""}
              {diff.functionsDelta}
            </span>{" "}
            functions
          </>
        }
        tone={positive ? "positive" : "default"}
      />
    );
  }

  // Complexity — only as a chip when not in the headline; also only show
  // when the delta is meaningful (the headline already filtered for >=20,
  // so chip uses lower threshold to surface smaller refactors)
  if (
    diff.complexityDelta !== null &&
    Math.abs(diff.complexityDelta) >= 5 &&
    headline.kind !== "complexity-spike"
  ) {
    const positive = diff.complexityDelta > 0;
    out.push(
      <Chip
        key="complexity"
        icon={positive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        label={
          <>
            <span
              style={{
                color: positive ? TOK.amber : TOK.accent,
                fontWeight: 600,
              }}
            >
              {positive ? "+" : ""}
              {diff.complexityDelta}
            </span>{" "}
            complexity
          </>
        }
        tone={positive ? "warning" : "positive"}
      />
    );
  }

  return out;
}

interface Props {
  diff: SnapshotDiff;
  /** Repo full name (owner/repo) — shown in the brand-line footer so
   *  screenshots are auto-credited. */
  repoFullName: string;
}

export function SinceLastVisit({ diff, repoFullName }: Props) {
  const headline = pickHeadline(diff);

  if (!headline) {
    return (
      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3 text-sm"
        style={{
          background: TOK.surface,
          border: `1px solid ${TOK.border}`,
          color: TOK.textSecondary,
        }}
      >
        <span
          className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: `1px solid ${TOK.border}`,
            color: TOK.textMuted,
          }}
        >
          <RefreshCw size={13} />
        </span>
        <span>Nothing new since your last visit.</span>
        <span className="ml-auto text-xs" style={{ color: TOK.textMuted }}>
          {formatRel(diff.from)} ago
        </span>
      </div>
    );
  }

  const chips = buildSupportingChips(diff, headline);

  return (
    // The "what changed since last time" block is the product's update story —
    // it must NOT blend into the neighbouring panels. CodeTrawl rations orange
    // to criticals, so this stands out by TONE, not colour: the brightest
    // surface on the page (elevated), a crisp border, and a bone "live edge"
    // left rule (the same active-marker device the workspace nav uses).
    <div
      className="rounded-xl p-6 flex flex-col gap-5"
      style={{
        background: `linear-gradient(135deg, ${TOK.accentSoft} 0%, ${TOK.surfaceElevated} 70%)`,
        border: `1px solid ${TOK.borderStrong}`,
        borderLeft: `3px solid ${TOK.accent}`,
      }}
    >
      {/* Header strip: refresh icon + "Since your last visit" on left,
       *  time-gap on the right. Putting the time on the right separates
       *  it from the title — it reads as a meta-label, not as part of
       *  the title phrase. */}
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span
            className="h-6 w-6 rounded-lg flex items-center justify-center"
            style={{
              background: TOK.accentSoft,
              color: TOK.accent,
              border: `1px solid ${TOK.accent}44`,
            }}
          >
            <RefreshCw size={11} />
          </span>
          <span
            className={`${STYLE.eyebrow} inline-flex items-center gap-1.5`}
            style={{ color: TOK.textMuted }}
          >
            Since your last visit
            <HelpHint
              anchor="sessions-snapshots"
              label="How sessions, snapshots, and refresh diffs work"
            />
          </span>
        </div>
        <span
          className="font-mono"
          style={{ color: TOK.textMuted }}
          title={`Previous snapshot taken ${formatDateTimeAbs(diff.from)}`}
        >
          {formatRel(diff.from)} ago
        </span>
      </div>

      {/* Headline: bigger icon block + leading copy with breathing room */}
      <div className="flex items-start gap-4">
        <span
          className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: TOK.accentSoft,
            color: TOK.accent,
            border: `1px solid ${TOK.accent}44`,
          }}
        >
          <HeadlineIcon headline={headline} size={22} />
        </span>
        <div
          className="flex-1 min-w-0 pt-1"
          style={{ color: TOK.textPrimary }}
        >
          <HeadlineCopy headline={headline} />
        </div>
      </div>

      {/* Supporting chips — wrap to multiple lines on narrow screens */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">{chips}</div>
      )}

      {/* Brand line — subtle, keeps screenshots self-attributing without
       *  being visually heavy. */}
      <div
        className="text-[11px] flex items-center gap-1.5 pt-2"
        style={{
          color: TOK.textMuted,
          borderTop: `1px solid ${TOK.border}`,
        }}
      >
        <span style={{ color: TOK.textSecondary }}>CodeTrawl</span>
        <span>·</span>
        <span className="font-mono">{repoFullName}</span>
      </div>
    </div>
  );
}
