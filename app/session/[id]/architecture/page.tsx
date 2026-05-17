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
import {
  computeScopeOptions,
  generateClassDiagram,
} from "@/lib/intelligence/classDiagram";
import { TOK } from "@/lib/theme";
import { ArchitecturePanel } from "@/components/views/ArchitecturePanel";

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
    <main className="px-8 py-8 flex flex-col gap-4 max-w-7xl mx-auto w-full">
      <div id="screenshot-target" className="flex flex-col gap-4">
        <ArchitecturePanel
          diagram={diagram}
          codeGraph={codeGraph}
          codeGraphSkipReason={current.codeGraphSkipReason}
          scopeOptions={scopeOptions}
          currentScope={currentScope}
        />
        <p className="text-xs" style={{ color: TOK.textMuted }}>
          Class extraction currently covers JavaScript &amp; TypeScript.
          Python, Go, Java, C#, PHP, Ruby roll out in the next phase.
          Output is Mermaid `classDiagram` syntax — paste into{" "}
          <a
            href="https://mermaid.live"
            target="_blank"
            rel="noopener"
            className="transition hover:underline"
            style={{ color: TOK.textSecondary }}
          >
            mermaid.live
          </a>
          , a README, or any Markdown viewer with Mermaid support.
        </p>
      </div>
    </main>
  );
}
