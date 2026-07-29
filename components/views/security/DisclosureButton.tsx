"use client";

// The action that turns a reachable finding into a responsible-disclosure
// report. One button per reachable sink row; on click it asks the server to
// have the AI translate THAT finding — the deterministic engine already found
// it and proved it reachable, the model only writes it up.
//
// The report is disclosure-calibrated: it names the vulnerability class and how
// to disclose it, never a copy-paste payload. That calibration is fixed on the
// server (see the disclose route) — this component cannot ask for the concrete
// "owned" sketch, which is the point.
//
// For a private repo, the one-line sink snippet is still private source leaving
// the machine, so the same one-time consent the Source explainer uses gates the
// first call.

import { useState } from "react";
import { ShieldAlert, Loader2, ArrowUpRight } from "lucide-react";
import { TOK } from "@/lib/sessionTheme";
import {
  needsPrivateExplainConsent,
  hasPrivateExplainConsent,
  grantPrivateExplainConsent,
} from "@/lib/explainConsent";

interface DisclosureReport {
  title: string;
  howReached: string;
  impact: string;
  trigger: string;
  fix: string;
  disclosure?: string;
}

export function DisclosureButton({
  sessionId,
  findingKey,
  repoPrivate,
}: {
  sessionId: string;
  findingKey: string;
  repoPrivate: boolean;
}) {
  const [state, setState] = useState<"idle" | "consent" | "loading" | "done" | "error">("idle");
  const [report, setReport] = useState<DisclosureReport | null>(null);
  const [error, setError] = useState<string>("");

  async function run() {
    setState("loading");
    setError("");
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/security/disclose`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ findingKey }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setState("error");
        return;
      }
      setReport(data.report);
      setState("done");
    } catch {
      setError("Network error — try again.");
      setState("error");
    }
  }

  function onClick() {
    // Private repo, first time: show the one-time consent before transmitting.
    if (needsPrivateExplainConsent(repoPrivate) && !hasPrivateExplainConsent()) {
      setState("consent");
      return;
    }
    void run();
  }

  if (state === "done" && report) {
    return <ReportCard report={report} />;
  }

  if (state === "consent") {
    return (
      <div
        className="mt-2 flex flex-col gap-2 rounded-md p-3"
        style={{ background: TOK.surfaceElevated, border: `1px solid ${TOK.border}` }}
      >
        <p className="text-xs" style={{ color: TOK.textSecondary }}>
          This sends the one flagged line of source to Anthropic to write the
          report. It is never stored. Continue?
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              grantPrivateExplainConsent();
              void run();
            }}
            className="text-xs font-medium px-2.5 py-1 rounded"
            style={{ background: TOK.textPrimary, color: TOK.bg }}
          >
            Send &amp; generate
          </button>
          <button
            onClick={() => setState("idle")}
            className="text-xs px-2.5 py-1 rounded"
            style={{ color: TOK.textMuted, border: `1px solid ${TOK.border}` }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1.5">
      <button
        onClick={onClick}
        disabled={state === "loading"}
        className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded transition disabled:opacity-60"
        style={{ color: TOK.accent, border: `1px solid ${TOK.border}` }}
      >
        {state === "loading" ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            Writing report…
          </>
        ) : (
          <>
            <ShieldAlert size={12} />
            Disclosure report
          </>
        )}
      </button>
      {state === "error" && (
        <p className="text-xs mt-1" style={{ color: TOK.rose }}>
          {error}
        </p>
      )}
    </div>
  );
}

function ReportCard({ report }: { report: DisclosureReport }) {
  return (
    <div
      className="mt-2 flex flex-col gap-2.5 rounded-md p-3.5"
      style={{ background: TOK.surfaceElevated, border: `1px solid ${TOK.border}` }}
    >
      <div className="flex items-center gap-1.5">
        <ShieldAlert size={13} style={{ color: TOK.accent }} />
        <span className="text-sm font-semibold" style={{ color: TOK.textPrimary }}>
          {report.title}
        </span>
      </div>
      <Field label="How it's reached" value={report.howReached} />
      <Field label="Impact" value={report.impact} />
      <Field label="Attack class" value={report.trigger} />
      <Field label="Fix" value={report.fix} />
      {report.disclosure && (
        <div
          className="flex items-start gap-1.5 rounded p-2 mt-0.5"
          style={{ background: TOK.surface, border: `1px solid ${TOK.border}` }}
        >
          <ArrowUpRight size={12} className="flex-shrink-0 mt-0.5" style={{ color: TOK.textMuted }} />
          <span className="text-xs" style={{ color: TOK.textSecondary }}>
            {report.disclosure}
          </span>
        </div>
      )}
      <p className="text-[10px] mt-0.5" style={{ color: TOK.textMuted }}>
        AI-written from the deterministic finding. Verify before acting; not stored.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span
        className="text-[9px] uppercase tracking-[0.14em] font-semibold"
        style={{ color: TOK.textMuted }}
      >
        {label}
      </span>
      <span className="text-xs leading-relaxed" style={{ color: TOK.textSecondary }}>
        {value}
      </span>
    </div>
  );
}
