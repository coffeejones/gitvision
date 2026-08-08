// /session/[id]/brief/[subject] — one question, answered across the tabs.
//
// The workspace has sixteen destinations and the visitor has to know which
// instrument answers their question. This route inverts that: pick the
// question, get the answer, with every line deep-linked back to the surface
// that owns it.
//
// DETERMINISTIC AND STANDALONE. No AI, no key required — lib/healthAnalysis.ts
// returns null without ANTHROPIC_API_KEY, so a brief whose value depended on a
// narrative would be empty for self-hosters and demos. The reading comes later
// and sits on top of this, never underneath it.
//
// Server-rendered, and the subject lives in the path rather than in state: the
// result is shareable, the back button removes it, and nothing has to be
// stored or cleaned up when a session is deleted.

import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  Compass,
  LayoutDashboard,
  ShieldCheck,
} from "lucide-react";

import { getSessionCached } from "@/lib/sessionCache";
import { TOK } from "@/lib/sessionTheme";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { buildBrief, SUBJECTS, isSubjectId } from "@/lib/brief";
import { withBriefContext } from "@/lib/brief/goals";
import { BriefReadingPanel } from "@/components/views/BriefReadingPanel";
import { GuidedProgress } from "@/components/views/GuidedProgress";
import { isDemoSession } from "@/lib/demoSessions";

export const dynamic = "force-dynamic";

export default async function BriefRoute({
  params,
}: {
  params: Promise<{ id: string; subject: string }>;
}) {
  const { id, subject } = await params;

  // Session first, so a bad id 404s for the reason a reader would expect.
  //
  // Both of these render the 404 page, but neither sets a 404 STATUS: the
  // session layout has already awaited its own read and streamed, so the
  // response is committed at 200 before a child page can object. Verified
  // against the shipped /session/[id]/merge route, which behaves identically —
  // this is how every child under this layout works, not something new here.
  // A human sees the right page; an uptime check would see a 200.
  const session = await getSessionCached(id);
  if (!session) notFound();
  if (!isSubjectId(subject)) notFound();
  const current = session.snapshots[session.snapshots.length - 1];
  if (!current) notFound();

  const base = `/session/${id}`;
  const brief = buildBrief(subject, current, id);
  const nextItem = brief.sections[0]?.items[0] ?? null;

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-5xl mx-auto w-full">
      {/* Guided mode is a context inside the workspace, never a replacement
          for it. The persistent sidebar stays visible; these two exits make
          the relationship explicit for readers who entered through a goal. */}
      <div
        className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 rounded-lg px-4 py-3"
        style={{ border: `1px solid ${TOK.border}`, background: TOK.surface }}
      >
        <span className="flex items-center gap-3 min-w-0">
          <Compass size={15} style={{ color: TOK.accent, flexShrink: 0 }} />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span
              className="text-xs font-medium"
              style={{ color: TOK.textPrimary }}
            >
              Guided analysis
            </span>
            <span
              className="text-[10px] truncate"
              style={{ color: TOK.textMuted }}
            >
              {SUBJECTS[subject].title} · focused answer
            </span>
          </span>
        </span>
        <GuidedProgress current={1} />
        <span className="flex items-center gap-2 flex-wrap shrink-0">
          <Link
            href={`${base}/brief`}
            className="rounded-md px-2.5 py-1.5 text-[11px] transition"
            style={{
              color: TOK.textSecondary,
              border: `1px solid ${TOK.border}`,
            }}
          >
            Change goal
          </Link>
          <Link
            href={base}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition"
            style={{ color: TOK.textMuted }}
          >
            <LayoutDashboard size={12} />
            Exit guided mode
          </Link>
        </span>
      </div>

      {/* THE ANSWER IS THE HEADING. It used to be the question, with an intro
          about which of OUR tabs the data came from — so the first screen said
          nothing at all about the reader's repo and they had to scroll and
          synthesise. The brief already knew the answer; it just never said it. */}
      <OrientationStrip
        eyebrow={brief.question}
        title={brief.answer}
        line={brief.howToRead}
      />

      {nextItem && (
        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-xl px-5 py-4"
          style={{ border: `1px solid ${TOK.border}`, background: TOK.surface }}
        >
          <span className="flex flex-col gap-1 min-w-0">
            <span
              className="text-[9px] uppercase tracking-[0.13em]"
              style={{ color: TOK.textMuted }}
            >
              Next · inspect the evidence
            </span>
            <strong
              className="text-sm font-medium"
              style={{ color: TOK.textPrimary }}
            >
              Open the highest-ranked finding in its owning workspace view.
            </strong>
            <span
              className="text-[11px] font-mono truncate"
              style={{ color: TOK.textMuted }}
            >
              {nextItem.title}
            </span>
          </span>
          <Link
            href={withBriefContext(nextItem.href, subject)}
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-[11px] shrink-0 transition"
            style={{
              border: `1px solid ${TOK.borderStrong}`,
              color: TOK.textPrimary,
              background: TOK.surfaceElevated,
            }}
          >
            Inspect evidence <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
      )}

      {/* Above the findings, never instead of them. Everything it says is
          visible underneath in evidenced form — that arrangement is the only
          reason a generated paragraph belongs on this product at all. */}
      <BriefReadingPanel
        sessionId={id}
        subject={subject}
        initial={current.briefReadings?.[subject] ?? null}
        available={Boolean(process.env.ANTHROPIC_API_KEY)}
        readOnly={isDemoSession(id)}
      />

      {/* The honest empty state. `clean` is false whenever a blocking gap is
          present, so a repo we could not check never reads as one we did. */}
      {brief.clean && (
        <div
          className="flex items-start gap-3 rounded-xl px-5 py-4"
          style={{ border: `1px solid ${TOK.border}`, background: TOK.surface }}
        >
          <ShieldCheck size={18} style={{ color: TOK.accent, flexShrink: 0 }} />
          <div className="flex flex-col gap-1">
            <p
              className="text-sm font-semibold"
              style={{ color: TOK.textPrimary }}
            >
              {brief.emptyHeadline}
            </p>
            <p className="text-xs" style={{ color: TOK.textMuted }}>
              {brief.emptyDetail}
            </p>
          </div>
        </div>
      )}

      {brief.sections.map((section) => {
        const items = section.items;
        // When every item in a section means the same thing — three vulnerable
        // packages all mean "update it" — repeating the sentence per row turns
        // the page into a chant and pushes the thing that actually differs (the
        // package name) into small print. Say it once, above them.
        const shared =
          items.length > 1 && items.every((i) => i.soWhat === items[0].soWhat)
            ? items[0].soWhat
            : null;
        return (
          <section key={section.id} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2
                className="text-lg font-semibold"
                style={{ color: TOK.textPrimary }}
              >
                {section.label}
                <span
                  className="ml-2 text-sm font-normal"
                  style={{ color: TOK.textMuted }}
                >
                  {items.length}
                </span>
              </h2>
              <p className="text-sm" style={{ color: TOK.textSecondary }}>
                {shared ?? section.note}
              </p>
              {shared && (
                <p className="text-xs" style={{ color: TOK.textMuted }}>
                  {section.note}
                </p>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={withBriefContext(item.href, subject)}
                    className="flex items-start justify-between gap-4 rounded-xl px-5 py-4 transition"
                    style={{
                      border: `1px solid ${TOK.border}`,
                      background: TOK.surface,
                    }}
                  >
                    {/* Consequence, then subject, then measurement. Someone
                        who does not have the vocabulary reads line one and
                        stops; someone who does skips to line three. Neither is
                        talked down to. */}
                    <span className="flex flex-col gap-1.5">
                      {!shared && (
                        <span
                          className="text-sm font-medium"
                          style={{ color: TOK.textPrimary }}
                        >
                          {item.soWhat}
                        </span>
                      )}
                      <span
                        className={
                          shared
                            ? "text-sm font-medium font-mono"
                            : "text-xs font-mono"
                        }
                        style={{
                          color: shared ? TOK.textPrimary : TOK.textSecondary,
                        }}
                      >
                        {item.title}
                      </span>
                      <span
                        className="text-xs leading-relaxed"
                        style={{ color: TOK.textMuted }}
                      >
                        {item.evidence}
                      </span>
                    </span>
                    <ArrowRight
                      size={15}
                      style={{
                        color: TOK.textMuted,
                        flexShrink: 0,
                        marginTop: 2,
                      }}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {/* Not a disclaimer block. On a Go or Java repo these ARE the answer:
          the zeroes above are the silence of scanners that never ran. */}
      {brief.gaps.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2
              className="text-lg font-semibold"
              style={{ color: TOK.textPrimary }}
            >
              What CodeTrawl could not check
              <span
                className="ml-2 text-sm font-normal"
                style={{ color: TOK.textMuted }}
              >
                {brief.gaps.length}
              </span>
            </h2>
            <p className="text-xs" style={{ color: TOK.textMuted }}>
              Measured limits of this analysis, not a general disclaimer. Each
              one changes what a zero above is worth.
            </p>
          </div>
          <ul className="flex flex-col gap-2">
            {brief.gaps.map((gap) => (
              <li
                key={gap.id}
                className="flex flex-col gap-1 rounded-xl px-5 py-4"
                style={{
                  border: `1px solid ${gap.kind === "blocking" ? TOK.amber : TOK.border}`,
                  background: TOK.surface,
                }}
              >
                <span
                  className="text-sm font-medium"
                  style={{ color: TOK.textPrimary }}
                >
                  {gap.headline}
                </span>
                {gap.detail && (
                  <span
                    className="text-xs leading-relaxed"
                    style={{ color: TOK.textSecondary }}
                  >
                    {gap.detail}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
