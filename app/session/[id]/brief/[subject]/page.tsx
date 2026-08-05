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
import { buildSecurityBrief, type BriefTier } from "@/lib/brief/security";

export const dynamic = "force-dynamic";

/** The subjects that exist. Kept tiny on purpose: a subject earns a slot only
 *  by composing across tabs. "Refactor" and "Tests" would each map to a single
 *  existing tab, so they would be a menu entry pointing at a menu entry. */
const SUBJECTS = { security: "Is this safe to depend on?" } as const;
type SubjectId = keyof typeof SUBJECTS;

const TIERS: { id: BriefTier; label: string; note: string }[] = [
  {
    id: "fix",
    label: "Fix first",
    note: "Each of these has a named corroborator — an advisory, an incident, or a literal match.",
  },
  {
    id: "investigate",
    label: "Worth a look",
    note: "Found, but not corroborated. A pattern match is a question, not a verdict.",
  },
  {
    id: "hygiene",
    label: "Dependency hygiene",
    note: "Real, and not a security finding.",
  },
];

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
  if (!(subject in SUBJECTS)) notFound();
  const current = session.snapshots[session.snapshots.length - 1];
  if (!current) notFound();

  const brief = buildSecurityBrief(current, id);

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-5xl mx-auto w-full">
      <OrientationStrip
        eyebrow={`Brief · ${SUBJECTS[subject as SubjectId]}`}
        title="Everything bearing on one question."
        line="Composed from the Security, Packages and Signals tabs — nothing here is computed for this page. Every line links back to the surface that owns it, and what CodeTrawl could not check is part of the answer rather than a footnote."
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
              Nothing outstanding, and nothing went unchecked.
            </p>
            <p className="text-xs" style={{ color: TOK.textMuted }}>
              Dependencies were read, dangerous-call rules ran, and no scanner
              was blocked. Refreshing the session re-runs all of them.
            </p>
          </div>
        </div>
      )}

      {TIERS.map((tier) => {
        const items = brief.items.filter((i) => i.tier === tier.id);
        if (items.length === 0) return null;
        return (
          <section key={tier.id} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold" style={{ color: TOK.textPrimary }}>
                {tier.label}
                <span className="ml-2 text-sm font-normal" style={{ color: TOK.textMuted }}>
                  {items.length}
                </span>
              </h2>
              <p className="text-xs" style={{ color: TOK.textMuted }}>
                {tier.note}
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
