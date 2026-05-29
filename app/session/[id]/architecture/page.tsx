// /session/[id]/architecture — Architecture tab as its own route
// (v0.70 / Phase 1, scope-filter added in polish round).
//
// First beboer: class diagrams. Future maybe-folder themes
// (hidden coupling, knowledge ranking, pattern detection, schema
// generation) will land here too. Giving them their own tab keeps
// the Code tab focused on day-to-day exploration and signals
// "deep architectural intelligence lives here" to power-users.
//
// Phase 1 ships JS/TS class extraction → Mermaid source. Phase 2
// will broaden language coverage; Phase 3 adds live preview + more
// interactive UI affordances.
//
// Scope filter: ?scope=lib%2Fintelligence URL param scopes the
// generated diagram to one folder. ArchitectureScope dropdown
// (client component) writes the param via router.push; server
// reads it on the next render and re-runs generateClassDiagram
// with the new scope. Empty / missing param means "all classes".

import { notFound } from "next/navigation";
import { getSession } from "@/lib/storage";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import {
  computeScopeOptions,
  generateClassDiagram,
} from "@/lib/intelligence/classDiagram";
import { TOK } from "@/lib/theme";
import { ArchitecturePanel } from "@/components/views/ArchitecturePanel";
import { UpgradePrompt } from "@/components/billing/UpgradePrompt";

export const dynamic = "force-dynamic";

export default async function ArchitectureRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await getSession(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  // Tier gate: Architecture diagrams unlock from Standing docket tier up.
  // Open case still gets the editorial hero (so the upgrade prompt has
  // context), but the actual diagram is hidden.
  const authSession = await getAuthSession();
  const hasArchitecture = authSession
    ? await canAccess(authSession.user.id, "architectureDiagrams")
    : false;

  const codeGraph = current.codeGraph;

  // Scope handling — empty / missing param falls through to "all
  // classes". Validate the folder still exists in the current
  // CodeGraph before applying — stale URLs (e.g. shared after a
  // refactor that removed the folder) gracefully fall back rather
  // than 500.
  const requestedScope = (sp.scope ?? "").trim();
  const scopeOptions = codeGraph
    ? computeScopeOptions(codeGraph)
    : [];
  const scopeIsValid =
    requestedScope === "" ||
    scopeOptions.some((s) => s.folder === requestedScope);
  const currentScope = scopeIsValid ? requestedScope : "";

  const diagram = codeGraph
    ? generateClassDiagram(codeGraph, {
        scope:
          currentScope === ""
            ? { kind: "all" }
            : { kind: "folder", folder: currentScope },
      })
    : null;

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-7xl mx-auto w-full">
      <header className="flex flex-col gap-3">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          Architecture
        </span>
        <h1
          className="text-2xl sm:text-3xl font-semibold tracking-tight"
          style={{
            color: TOK.textPrimary,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          Auto-extracted class diagrams.
        </h1>
        <p
          className="text-sm max-w-2xl leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          Classes, interfaces, and method relationships pulled from
          your repo&apos;s AST. JavaScript &amp; TypeScript today;
          Python, Go, Java, C#, PHP, Ruby roll out in the next phase.
          Mermaid output pastes into{" "}
          <a
            href="https://mermaid.live"
            target="_blank"
            rel="noopener"
            className="transition hover:underline"
            style={{ color: TOK.textPrimary }}
          >
            mermaid.live
          </a>
          , any README, or any Markdown viewer with Mermaid support.
        </p>
      </header>
      <div id="screenshot-target" className="flex flex-col gap-4">
        {hasArchitecture ? (
          <ArchitecturePanel
            diagram={diagram}
            codeGraph={codeGraph}
            codeGraphSkipReason={current.codeGraphSkipReason}
            scopeOptions={scopeOptions}
            currentScope={currentScope}
          />
        ) : (
          <UpgradePrompt
            featureName="Architecture diagrams"
            requiredTier="standing-docket"
            context="Auto-extracted class diagrams from your codebase's AST — classes, interfaces, method relationships, ready to paste into mermaid.live or your README."
            unlockedFeatures={[
              "Class diagrams rendered automatically from your codebase",
              "Scope-filter to focus on one folder at a time",
              "Copy as Mermaid source — paste anywhere",
              "AI Briefing + Health Check verdict",
              "Unlimited saved sessions + private repos",
            ]}
          />
        )}
      </div>
    </main>
  );
}
