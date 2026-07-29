// /session/[id]/testquality — Weak-Suite, "coverage that means nothing" (Arc 1).
//
// The report is computed server-side (pure over the code graph's per-test-file
// assertion metadata). The whole surface is Plus: the aggregate hook is shown to
// everyone, but the per-file / per-case detail is only computed — and therefore
// only shipped — when entitled, so it never leaks to free clients.

import { notFound } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { getSessionCached } from "@/lib/sessionCache";
import { getAuthSession } from "@/lib/authSession";
import { canAccess } from "@/lib/billing/gates";
import { isDemoSession } from "@/lib/demoSessions";
import { TOK } from "@/lib/sessionTheme";
import { computeWeakSuite } from "@/lib/weakSuite";
import { WeakSuitePanel } from "@/components/views/WeakSuitePanel";
import { HelpHint } from "@/components/HelpHint";
import { EmptyPanel } from "@/components/EmptyPanel";
import { OrientationStrip } from "@/components/views/OrientationStrip";
import { RollupBar } from "@/components/views/RollupBar";

export const dynamic = "force-dynamic";

export default async function TestQualityPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSessionCached(id);
  if (!session) notFound();
  const current = session.snapshots[session.snapshots.length - 1];

  // The whole feature is Plus. Demo sessions show it ungated; otherwise the
  // per-case drill-down is only computed (withDetail) when entitled, so the
  // file list never ships to a free client.
  const isDemo = isDemoSession(id);
  const authSession = await getAuthSession();
  const entitled =
    isDemo ||
    (authSession ? await canAccess(authSession.user.id, "testQuality") : false);

  const report = current.codeGraph
    ? computeWeakSuite(current.codeGraph, { withDetail: entitled })
    : null;

  return (
    <main className="px-8 pt-12 pb-16 flex flex-col gap-8 max-w-6xl mx-auto w-full">
      <OrientationStrip
        eyebrow="Test quality"
        title="Coverage that means nothing"
        line={
          <>
            Coverage says which lines ran; it doesn&rsquo;t say whether the tests
            would notice if the result were wrong. Ranks JS/TS test files by how
            many cases run code but assert nothing meaningful. Start with the
            hollow ones up top.{" "}
            <HelpHint
              anchor="testquality"
              label="How assertion quality is measured"
            />
          </>
        }
        rollup={
          report ? (
            <RollupBar
              segments={[
                {
                  count: report.counts.hollow,
                  color: TOK.rose,
                  label: "hollow",
                },
                { count: report.counts.thin, color: TOK.amber, label: "thin" },
                {
                  count: report.counts.solid,
                  color: TOK.accent,
                  label: "solid",
                },
              ]}
              total={report.totals.testFiles}
              emptyLabel="No JS/TS test files found"
              trailing={`${report.totals.testCases.toLocaleString()} cases`}
            />
          ) : undefined
        }
      />

      {report ? (
        <WeakSuitePanel
          summary={{ counts: report.counts, totals: report.totals }}
          files={entitled ? report.files : undefined}
          entitled={entitled}
        />
      ) : (
        <EmptyPanel
          icon={<FlaskConical size={22} />}
          title="No JS/TS test suite to analyze yet"
          body={
            <>
              Assertion quality is measured from the code graph&rsquo;s per-test
              metadata, which the JS/TS analyzer emits for <code>.test.</code> /{" "}
              <code>.spec.</code> files. Repos with no recognised test cases,
              non-JS suites, or snapshots created before this shipped will land
              here.
            </>
          }
          hint={
            <>
              Click <strong>Refresh</strong> in the topbar to regenerate.
            </>
          }
        />
      )}
    </main>
  );
}
