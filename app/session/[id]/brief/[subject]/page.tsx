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
import { ArrowRight, ShieldCheck } from "lucide-react";

import { getSessionCached } from "@/lib/sessionCache";
import { TOK } from "@/lib/sessionTheme";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { buildBrief, SUBJECTS, SUBJECT_IDS, isSubjectId } from "@/lib/brief";
import { BriefReadingPanel } from "@/components/views/BriefReadingPanel";
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

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-5xl mx-auto w-full">
      <OrientationStrip
        eyebrow="Brief"
        title={brief.question}
        line={brief.intro}
      />

      {/* The chooser. Every question is one click away, and the current one is
          marked rather than hidden — a reader has to be able to see that the
          other two exist, or this is just a security page with a long name. */}
      <div className="flex flex-wrap gap-2">
        {SUBJECT_IDS.map((sid) => {
          const active = sid === subject;
          return (
            <Link
              key={sid}
              href={`${base}/brief/${sid}`}
              className="flex flex-col gap-0.5 rounded-xl px-4 py-3 transition"
              style={{
                border: `1px solid ${active ? TOK.accent : TOK.border}`,
                background: active ? TOK.surfaceElevated : TOK.surface,
                minWidth: 200,
              }}
            >
              <span
                className="text-[13px] font-medium"
                style={{ color: active ? TOK.textPrimary : TOK.textSecondary }}
              >
                {SUBJECTS[sid].question}
              </span>
              <span className="text-[11px]" style={{ color: TOK.textMuted }}>
                {SUBJECTS[sid].blurb}
              </span>
            </Link>
          );
        })}
      </div>

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
            <p className="text-sm font-semibold" style={{ color: TOK.textPrimary }}>
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
        return (
          <section key={section.id} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold" style={{ color: TOK.textPrimary }}>
                {section.label}
                <span className="ml-2 text-sm font-normal" style={{ color: TOK.textMuted }}>
                  {items.length}
                </span>
              </h2>
              <p className="text-xs" style={{ color: TOK.textMuted }}>
                {section.note}
              </p>
            </div>
            <ul className="flex flex-col gap-2">
              {items.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="flex items-start justify-between gap-4 rounded-xl px-5 py-4 transition"
                    style={{ border: `1px solid ${TOK.border}`, background: TOK.surface }}
                  >
                    <span className="flex flex-col gap-1">
                      <span className="text-sm font-medium" style={{ color: TOK.textPrimary }}>
                        {item.title}
                      </span>
                      <span className="text-xs leading-relaxed" style={{ color: TOK.textSecondary }}>
                        {item.evidence}
                      </span>
                    </span>
                    <ArrowRight size={15} style={{ color: TOK.textMuted, flexShrink: 0, marginTop: 2 }} />
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
            <h2 className="text-lg font-semibold" style={{ color: TOK.textPrimary }}>
              What CodeTrawl could not check
              <span className="ml-2 text-sm font-normal" style={{ color: TOK.textMuted }}>
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
                <span className="text-sm font-medium" style={{ color: TOK.textPrimary }}>
                  {gap.headline}
                </span>
                {gap.detail && (
                  <span className="text-xs leading-relaxed" style={{ color: TOK.textSecondary }}>
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
