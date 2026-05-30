// Shared shell + building blocks for the legal documents (Phase P):
// /privacy, /terms, /cookies, /refunds.
//
// Wraps each document in the RJSurface (forensic-dossier shell) so the
// legal pages read as part of the same brand as the landing, auth, and
// pricing. Provides a constrained-measure container with readable
// long-form typography (.legal-* classes in repojury.css) plus a back
// link, a "not legal advice / draft" notice, and a footer.
//
// The exported sub-components (Section, P, UL, Placeholder, etc.) keep
// the four document files declarative — they describe content, not
// layout. Placeholder renders a visually obvious [TOKEN] so unfilled
// contact/jurisdiction details can't ship silently.

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RJSurface } from "@/components/landing/repojury/RJSurface";
import { CrestSeal } from "@/components/landing/repojury/seals";

interface ShellProps {
  /** Document title, e.g. "Privacy Policy". */
  title: string;
  /** Last-updated date string shown in the meta line. */
  updated: string;
  /** Optional table-of-contents entries: [anchorId, label]. */
  toc?: [string, string][];
  children: ReactNode;
}

/** Standard draft/advice notice shared by every document. The product
 *  is pre-launch and these are templates, not lawyer-reviewed text —
 *  say so plainly. */
export function DraftNotice() {
  return (
    <div className="legal-note">
      <b>Draft notice.</b> RepoJury is preparing for launch. These terms are
      written to reflect how the service actually works, but they have not yet
      been reviewed by a lawyer. If anything here is unclear, contact us before
      relying on it.
    </div>
  );
}

export function LegalShell({ title, updated, toc, children }: ShellProps) {
  return (
    <RJSurface>
      <main className="legal-page">
        <Link href="/" className="legal-back">
          <ArrowLeft size={13} />
          Back to RepoJury
        </Link>

        <header className="legal-head">
          <h1>{title}</h1>
        </header>
        <div className="legal-meta">Last updated: {updated}</div>

        {toc && (
          <nav className="legal-toc">
            <span className="legal-toc-title">Contents</span>
            {toc.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
        )}

        {children}

        <footer
          className="legal-meta"
          style={{ marginTop: 48, marginBottom: 0, borderBottom: "none" }}
        >
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            <CrestSeal size={16} />
            RepoJury · <Placeholder>CONTROLLER_NAME</Placeholder>
          </span>
        </footer>
      </main>
    </RJSurface>
  );
}

// ── Content building blocks ───────────────────────────────────────────

export function Section({
  id,
  num,
  title,
  children,
}: {
  id: string;
  num: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="legal-section">
      <h2>
        <span className="num">{num}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>;
}

export function H3({ children }: { children: ReactNode }) {
  return <h3>{children}</h3>;
}

export function UL({ children }: { children: ReactNode }) {
  return <ul>{children}</ul>;
}

export function LI({ children }: { children: ReactNode }) {
  return <li>{children}</li>;
}

export function Intro({ children }: { children: ReactNode }) {
  return <p className="legal-intro">{children}</p>;
}

/** Visually-loud placeholder for unfilled details. Renders [TOKEN] in
 *  a rose pill so it's impossible to miss in review — these must be
 *  replaced before the docs are relied upon. */
export function Placeholder({ children }: { children: ReactNode }) {
  return <span className="legal-ph">[{children}]</span>;
}
