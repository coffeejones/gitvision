// Shared shell for auth surfaces (v0.76; restyled to forensic-dossier
// in Phase M).
//
// Wraps /login, /signup, /forgot-password, /reset-password with a
// split-panel layout inside the RJSurface (the shared records-office
// shell used by the landing + /pricing). Left: a brand tease with the
// brass crest + case-flavored copy. Right: the focused form column.
// Mobile collapses to the form alone with a small wordmark above.
//
// Server Component — no client state lives here. Pages pass their
// form component as children. Auth-page-specific microcopy variations
// (login vs signup wording) live inside the individual form
// components, not here.
//
// The aesthetic boundary: this is the last forensic-dossier surface
// before the user "steps inside" the tool. After login they land on
// the TOK-dark workspace — the seam is deliberate.

import Link from "next/link";
import { Check } from "lucide-react";
import { RJSurface } from "@/components/landing/repojury/RJSurface";
import { CrestSeal } from "@/components/landing/repojury/seals";

interface Props {
  /** The form (AuthForm, ForgotPasswordForm, etc.) plus any inline
   *  banners the page wants to render above it. */
  children: React.ReactNode;
}

export function AuthShell({ children }: Props) {
  return (
    <RJSurface>
      <div className="auth-wrap">
        <BrandPanel />
        <div className="auth-col">
          {/* Mobile-only wordmark above the form — the brand panel is
              hidden under 861px. */}
          <Link href="/" className="brand-mobile">
            <CrestSeal size={24} />
            <span>
              <b style={{ fontWeight: 700 }}>Repo</b>Jury
            </span>
          </Link>
          {children}
        </div>
      </div>
    </RJSurface>
  );
}

// ─── Left: branded case-intake tease (desktop only) ───────────────────

function BrandPanel() {
  return (
    <aside className="auth-brand">
      <Link href="/" className="brand">
        <CrestSeal size={26} />
        <span>
          <b style={{ fontWeight: 700 }}>Repo</b>Jury
        </span>
      </Link>

      <div className="auth-tease">
        <h2>Step inside the Chambers.</h2>
        <p>
          Past the seal, the Chambers holds every repo you&rsquo;ve put
          on trial — each verdict, and the evidence behind every
          finding. Re-run anytime; &ldquo;since your last visit&rdquo;
          shows exactly what moved.
        </p>
        <ul className="auth-points">
          <li>
            <Check size={15} />
            Open any case file — verdict, signals, and the evidence
            behind them
          </li>
          <li>
            <Check size={15} />
            Re-run anytime — see exactly what moved since your last visit
          </li>
          <li>
            <Check size={15} />
            Deterministic signals — no AI hallucinations
          </li>
        </ul>
      </div>

      <p className="auth-foot">RepoJury · made by coffeejones</p>
    </aside>
  );
}
