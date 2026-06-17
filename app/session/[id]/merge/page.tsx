// /session/[id]/merge — The Read, Merge Confidence (Mode B).
//
// The PR-scoped twin of the adoption read on /verdict. Reachable from the
// PR-bot comment's "Merge confidence" deep link: the head session carries
// prMetadata.baseSessionId (set by the pipeline), so we fetch both sister
// sessions, recompute the base->head diff, and render the SAFE TO MERGE /
// REVIEW CLOSELY / HIGH BLAST card.
//
// Free for everyone — pure deterministic compute over two stored codeGraphs,
// no AI / token cost. Renders inside the [id] layout (the session sidebar).
// Recomputing the diff on render is cheap (tens of ms) and avoids persisting a
// redundant diff blob; the two codeGraphs are already on disk.

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/lib/storage";
import { computeMergeConfidenceRead } from "@/lib/intelligence/mergeConfidenceRead";
import { TOK } from "@/lib/sessionTheme";
import { MergeConfidenceReadCard } from "@/components/views/verdict/MergeConfidenceRead";

export const dynamic = "force-dynamic";

/** Calm centered message for the states where a merge read can't be built. */
function Explain({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="rounded-xl p-8 flex flex-col gap-2 text-center"
      style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
    >
      <span className="text-base font-medium" style={{ color: TOK.textPrimary }}>
        {title}
      </span>
      <span className="text-sm leading-relaxed" style={{ color: TOK.textSecondary }}>
        {body}
      </span>
    </div>
  );
}

export default async function MergeConfidenceRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();

  const sessionBase = `/session/${session.id}`;

  const header = (
    <header className="flex flex-col gap-4">
      <Link
        href={sessionBase}
        className="inline-flex items-center gap-1.5 text-[12.5px] w-fit transition hover:underline"
        style={{ color: TOK.textMuted }}
      >
        <ArrowLeft size={13} />
        Back to the session
      </Link>
      <span
        className="text-[10px] uppercase tracking-[0.18em] font-medium"
        style={{ color: TOK.textMuted }}
      >
        Merge confidence · would this change be safe to merge?
      </span>
      <h1
        className="text-3xl sm:text-4xl font-semibold tracking-tight"
        style={{ color: TOK.textPrimary, letterSpacing: "-0.025em", lineHeight: 1.1 }}
      >
        How far does this PR ripple?
      </h1>
      <p
        className="text-sm sm:text-base max-w-2xl leading-relaxed"
        style={{ color: TOK.textSecondary }}
      >
        The same blast-radius and test-coverage signals from the workspace,
        scoped to one pull request: which touched functions are depended on,
        which are untested, and where the risk concentrates. Every line is
        computed from the diff — no AI.
      </p>
    </header>
  );

  const shell = (body: React.ReactNode) => (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-5xl mx-auto w-full">
      {header}
      {body}
    </main>
  );

  // Mode B needs a PR's base ref. Only PR-bot head sessions carry prMetadata.
  const baseId = session.prMetadata?.baseSessionId;
  if (!baseId) {
    return shell(
      <Explain
        title="This view is for pull requests."
        body="Merge confidence compares a PR's base and head. Open it from a CodeTrawl PR-bot comment, where both refs are analyzed."
      />
    );
  }

  const baseSession = await getSession(baseId);
  const headSnap = session.snapshots[session.snapshots.length - 1];
  const baseSnap = baseSession?.snapshots[baseSession.snapshots.length - 1];

  if (!baseSession || !baseSnap || !headSnap) {
    return shell(
      <Explain
        title="The base snapshot is no longer available."
        body="This PR's base ref was analyzed alongside the head, but that session can't be found — it may have been cleaned up when the app was uninstalled."
      />
    );
  }

  if (!headSnap?.codeGraph || !baseSnap.codeGraph) {
    return shell(
      <Explain
        title="Code analysis isn't available for this diff."
        body="One of the two refs has no code graph (an unsupported language, an empty repo, or an analysis that timed out), so the function-level diff can't be measured."
      />
    );
  }

  const read = computeMergeConfidenceRead(baseSnap.codeGraph, headSnap.codeGraph);
  return shell(<MergeConfidenceReadCard read={read} />);
}
