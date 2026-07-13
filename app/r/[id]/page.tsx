// /r/[id] — the public, permalinked Merge Receipt. A verifiable certificate that
// CodeTrawl's deterministic Gate ran on an exact commit: repo, PR, head SHA, the
// blast verdict + numbers, issued-at, and a re-verified signature seal. No auth —
// the whole point is that anyone can open + trust it.

import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getReceipt } from "@/lib/receiptStore";
import { verifyReceipt, type ReceiptVerdict } from "@/lib/receipt";

export const dynamic = "force-dynamic";

const BG = "#0c0b0b";
const PANEL = "#141312";
const BORDER = "rgba(255,255,255,0.10)";
const TEXT = "#eceae8";
const DIM = "#8a8783";
const MONO = "var(--font-geist-mono, ui-monospace, SFMono-Regular, monospace)";

const VERDICT: Record<ReceiptVerdict, { label: string; color: string }> = {
  clear: { label: "Clear", color: "#7fc7a1" },
  review: { label: "Review closely", color: "#d8b04a" },
  "high-risk": { label: "High blast", color: "#ff4f00" },
};

export const metadata: Metadata = {
  title: "Merge Receipt · CodeTrawl",
  robots: { index: false },
};

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const signed = await getReceipt(id);
  if (!signed) notFound();

  const verified = verifyReceipt(signed);
  const r = signed.receipt;
  // Fallback so a corrupted/hand-crafted verdict renders instead of 500-ing a
  // public page (issued receipts only ever carry the three known verdicts).
  const v = VERDICT[r.verdict] ?? { label: String(r.verdict), color: DIM };
  const issued = new Date(r.issuedAt);
  const base = (process.env.REPOBARON_PUBLIC_URL ?? "").replace(/\/+$/, "");
  const analysisUrl = `${base}/session/${r.headSessionId}`;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: TEXT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: PANEL,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 20px 60px -24px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: `1px solid ${BORDER}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: DIM,
            }}
          >
            CodeTrawl · Merge Receipt
          </span>
          <SealBadge verified={verified} />
        </div>

        {/* Verdict */}
        <div style={{ padding: "28px 24px 8px" }}>
          <div
            style={{
              display: "inline-block",
              fontSize: 13,
              fontWeight: 700,
              color: v.color,
              background: `${v.color}1a`,
              border: `1px solid ${v.color}55`,
              borderRadius: 9,
              padding: "5px 14px",
            }}
          >
            {v.label}
          </div>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              margin: "16px 0 4px",
            }}
          >
            {r.repo}{" "}
            <span style={{ color: DIM }}>#{r.prNumber}</span>
          </h1>
          <div style={{ fontSize: 13, color: DIM }}>
            commit{" "}
            <span style={{ fontFamily: MONO, color: TEXT }}>
              {r.headSha.slice(0, 12)}
            </span>
          </div>
        </div>

        {/* Facts */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 1,
            background: BORDER,
            margin: "20px 0 0",
          }}
        >
          <Fact label="Load-bearing walls" value={r.loadBearingWalls} />
          <Fact label="Files reached" value={r.filesReached} />
          <Fact
            label="Guarding tests updated"
            value={`${r.guardingTestsUpdated} / ${r.guardingTestsTotal}`}
          />
          <Fact
            label="Issued"
            value={issued.toISOString().replace("T", " ").slice(0, 16) + " UTC"}
          />
        </div>

        {/* Footer */}
        <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 12.5, color: DIM, lineHeight: 1.6, margin: 0 }}>
            Deterministic — the verdict was computed from the repo&rsquo;s import +
            call graph at this commit, cited to real edges. Signed with HMAC-SHA256;
            verify it yourself by POSTing this receipt&rsquo;s JSON to{" "}
            <span style={{ fontFamily: MONO, color: TEXT }}>/api/receipts/verify</span>.
          </p>
          {base && (
            <a
              href={`${analysisUrl}/merge`}
              style={{
                fontSize: 13,
                color: TEXT,
                textDecoration: "none",
                borderTop: `1px solid ${BORDER}`,
                paddingTop: 12,
              }}
            >
              Open the full merge-confidence analysis ↗
            </a>
          )}
        </div>
      </div>
    </main>
  );
}

function SealBadge({ verified }: { verified: boolean }) {
  const color = verified ? "#7fc7a1" : "#ff4f00";
  return (
    <span
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        color,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
        }}
      />
      {verified ? "Signed by CodeTrawl" : "Signature invalid"}
    </span>
  );
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: PANEL, padding: "14px 24px" }}>
      <div
        style={{
          fontSize: 10.5,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: DIM,
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: TEXT }}>{value}</div>
    </div>
  );
}
