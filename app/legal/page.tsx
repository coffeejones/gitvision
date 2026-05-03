// /legal — single combined page covering Privacy + Terms for the alpha
// deploy. Plain language, no fluff. Linked from the landing-page footer.
//
// Why one page: at alpha scale we don't have separate teams, separate
// jurisdictions, or different legal structures for different documents.
// Splitting Privacy and Terms across two pages doubles the reading
// burden without adding clarity. Combine, label clearly, ship.
//
// If we ever need real legal documents (because we monetize, hire,
// expand to EU compliance audits, etc.) this page gets retired in
// favor of proper boilerplate from a service like Termly.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { STYLE, TOK } from "@/lib/theme";

export const metadata = {
  title: "Privacy & Terms — GitVision",
  description:
    "What GitVision stores, what it doesn't, and the terms you accept by using it.",
};

export default function LegalPage() {
  return (
    <main className="max-w-2xl w-full mx-auto px-8 pt-16 pb-20 flex flex-col gap-10">
      <div>
        <Link
          href="/"
          className="text-xs inline-flex items-center gap-1.5 transition hover:underline"
          style={{ color: TOK.textSecondary }}
        >
          <ArrowLeft size={12} />
          Back to GitVision
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <span
          className={STYLE.eyebrow}
          style={{ color: TOK.textSecondary }}
        >
          Privacy &amp; Terms
        </span>
        <h1
          className="text-4xl font-semibold tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          What we store, and what you accept by using GitVision.
        </h1>
        <p
          className="text-base leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          GitVision is in alpha. This page is short on purpose — we want
          you to actually read it. If anything is unclear, open an issue
          on{" "}
          <a
            href="https://github.com/coffeejones/gitvision/issues"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2"
          >
            GitHub
          </a>
          .
        </p>
      </header>

      <Section title="Privacy">
        <P>
          <strong>No accounts.</strong> GitVision has no sign-up, no
          login, no password, no email collection. You don&apos;t create
          a profile to use it.
        </P>
        <P>
          <strong>Anonymous owner-id.</strong> When you first visit, your
          browser generates a random UUID stored in{" "}
          <code style={{ color: TOK.textSecondary }}>localStorage</code>.
          That&apos;s how the landing page filters &quot;your sessions&quot;
          from sessions other visitors created. The UUID is not linked to
          any personal information — we don&apos;t know who you are, and
          we don&apos;t want to.
        </P>
        <P>
          <strong>Sessions you create are accessible by URL.</strong>{" "}
          Anyone with a session URL can open it. The owner-id only
          controls what shows up on the landing page list — it&apos;s
          soft isolation, not access control. Don&apos;t paste session
          URLs publicly if the analyzed repo is sensitive.
        </P>
        <P>
          <strong>What we store on the server.</strong> The session JSON
          (analysis results) and a job-status file. Both are file-based,
          stored on Railway&apos;s persistent volume. We don&apos;t store
          IP addresses, cookies, or browser fingerprints.
        </P>
        <P>
          <strong>What we send to third parties.</strong> Public-repo
          metadata via the GitHub REST + GraphQL APIs (read-only, no
          tokens of yours). Vulnerability lookups via{" "}
          <a
            href="https://osv.dev"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2"
            style={{ color: TOK.textSecondary }}
          >
            OSV.dev
          </a>
          . AI summary + health verdict via Anthropic&apos;s Claude API
          (the analyzed snapshot is sent — package names, contributor
          logins, file paths from the public repo). No personal data
          about you is forwarded.
        </P>
        <P>
          <strong>Analytics.</strong> If we add web analytics (we&apos;re
          considering Plausible, which is privacy-friendly and IP-
          anonymized), this page will be updated. We will never use ad
          networks, fingerprinting, or session-replay tools.
        </P>
      </Section>

      <Section title="Terms">
        <P>
          <strong>Alpha software, no warranty.</strong> GitVision is
          provided as-is. Analysis results may be incomplete, wrong, or
          out of date — verify anything important against the source.
        </P>
        <P>
          <strong>Be reasonable.</strong> The public deploy enforces
          per-IP rate limits (5 session-creates / 10 refreshes / 20 AI
          calls per hour) plus a daily Anthropic-call budget. If you hit
          429 or 503, slow down. Persistent abuse may result in your IP
          being blocked at the Railway edge.
        </P>
        <P>
          <strong>License.</strong> The GitVision source code is{" "}
          <a
            href="https://github.com/coffeejones/gitvision/blob/main/LICENSE"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2"
            style={{ color: TOK.textSecondary }}
          >
            PolyForm Noncommercial 1.0.0
          </a>
          . You may use, modify, and self-host for personal,
          educational, or nonprofit purposes — but not for commercial
          gain without a separate license. Get in touch if you want
          commercial use.
        </P>
        <P>
          <strong>Service availability.</strong> We may pause or shut
          down the public deploy at any time, with or without notice.
          Sessions on the public deploy are not guaranteed durable — for
          anything you actually care about, run GitVision locally and
          keep your own session files.
        </P>
        <P>
          <strong>Changes to this page.</strong> If terms change, the
          updated version replaces this one. The git history of this
          file is the source of truth — see{" "}
          <a
            href="https://github.com/coffeejones/gitvision/commits/main/app/legal/page.tsx"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2"
            style={{ color: TOK.textSecondary }}
          >
            commits to app/legal/page.tsx
          </a>
          .
        </P>
      </Section>

      <footer
        className="pt-8 text-xs border-t"
        style={{ borderColor: TOK.border, color: TOK.textMuted }}
      >
        Last updated: 2026-04-29 · GitVision is made by{" "}
        <a
          href="https://github.com/coffeejones"
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2"
        >
          coffeejones
        </a>
        .
      </footer>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2
        className="text-xl font-semibold"
        style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
      >
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-sm leading-relaxed"
      style={{ color: TOK.textSecondary }}
    >
      {children}
    </p>
  );
}
