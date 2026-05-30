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

/** Pre-launch notice shared by every document. RepoJury is an early
 *  proof of concept with no registered business behind it yet, so we
 *  say so plainly here rather than naming an operator/address/
 *  jurisdiction we don't have. When it launches commercially, a
 *  registered entity + lawyer-reviewed policy replaces all of this. */
export function DraftNotice() {
  return (
    <div className="legal-note">
      <b>Pre-launch notice.</b> RepoJury is an early proof of concept, not yet
      a registered business. This page describes honestly how the service
      handles data today — but there&rsquo;s no named operator, registered
      address, or chosen jurisdiction yet, and it hasn&rsquo;t been reviewed by
      a lawyer. Once RepoJury launches commercially, a registered entity and a
      proper policy will replace this. Questions:{" "}
      <a href="mailto:support@repojury.com">support@repojury.com</a>.
    </div>
  );
}

export function LegalShell({ title, updated, toc, children }: ShellProps) {
  return (
    <RJSurface>
      <div className="legal-shell">
        <main className="legal-main">
          <Link href="/" className="legal-back">
            <ArrowLeft size={13} />
            Back to RepoJury
          </Link>

          <header className="legal-head">
            <h1>{title}</h1>
          </header>
          <div className="legal-meta">Last updated: {updated}</div>

          {children}

          <footer
            className="legal-meta"
            style={{ marginTop: 48, marginBottom: 0, borderBottom: "none" }}
          >
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <CrestSeal size={16} />
              RepoJury · pre-launch proof of concept
            </span>
          </footer>
        </main>

        {toc && (
          <aside className="legal-toc-rail" aria-label="On this page">
            <span className="legal-toc-title">On this page</span>
            <div className="legal-toc-links">
              {toc.map(([id, label]) => (
                <a key={id} href={`#${id}`}>
                  {label}
                </a>
              ))}
            </div>
          </aside>
        )}
      </div>
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
