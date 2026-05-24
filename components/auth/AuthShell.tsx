// Shared shell for auth surfaces (v0.76 / D4).
//
// Wraps /login, /signup, /forgot-password, /reset-password with a
// split-panel layout: branded marketing tease on the left, the
// actual form on the right. Mobile collapses to a single column
// with just the form + a small wordmark above.
//
// Pattern from Linear / Stripe / Vercel auth pages: the left side
// gives the visitor a reason to be here ("Know your code…") and
// reinforces brand presence; the right side is the focused action.
//
// Server Component — no client state lives here. Pages pass their
// form component as children. Auth-page-specific microcopy variations
// (login vs signup wording) live inside the individual form
// components, not here.

import Link from "next/link";
import { TOK } from "@/lib/theme";
import { Logo } from "@/components/Logo";

interface Props {
  /** The form (AuthForm, ForgotPasswordForm, etc.) plus any inline
   *  banners the page wants to render above it. */
  children: React.ReactNode;
}

export function AuthShell({ children }: Props) {
  return (
    <main
      className="min-h-screen grid grid-cols-1 md:grid-cols-[5fr_6fr]"
      style={{ background: TOK.bg }}
    >
      <BrandPanel />
      <FormPanel>{children}</FormPanel>
    </main>
  );
}

// ─── Left: branded marketing panel (desktop only) ─────────────────────

function BrandPanel() {
  return (
    <aside
      // Hidden on mobile to keep focus on the form. On desktop takes
      // ~45% width with the same ambient gradient as MarketingHome so
      // the auth surface reads as part of the product, not as a
      // standalone vendor page.
      className="hidden md:flex flex-col justify-between p-12 lg:p-16 relative"
      style={{
        // Gradients-only ambient depth (same recipe as MarketingHome
        // and WorkspaceHome). Dot-grid was dropped in v0.76 polish so
        // marketing → auth → workspace transitions feel like one
        // continuous surface, not three different templates.
        backgroundColor: TOK.bg,
        backgroundImage: `
          linear-gradient(225deg, rgba(255,255,255,0.08) 0%, transparent 55%),
          linear-gradient(45deg, rgba(0,0,0,0.4) 0%, transparent 55%)
        `,
        borderRight: `1px solid ${TOK.border}`,
      }}
    >
      {/* Top: logo as clickable home-link */}
      <Link
        href="/"
        className="self-start opacity-90 hover:opacity-100 transition"
      >
        <Logo size={40} wordmark />
      </Link>

      {/* Middle: brand-promise + feature bullets. Constrained to
       *  max-w-md so wide screens don't stretch the line lengths
       *  past comfortable reading width. Title sits tight (no
       *  gradient-clipped text — reads ChatGPT-y); single solid
       *  color matches the rest of the brand-vocabulary. */}
      <div className="flex flex-col gap-5 max-w-md">
        <h2
          className="text-2xl lg:text-3xl font-semibold leading-tight"
          style={{ color: TOK.textPrimary, letterSpacing: "-0.02em" }}
        >
          Know your code before you touch it.
        </h2>
        <p
          className="text-sm leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          RepoBaron maps any GitHub repo in 20 seconds — blast radius,
          untested hotspots, structural duplicates, dependency health.
          Across 7 languages.
        </p>
        <ul
          className="flex flex-col gap-3 text-sm"
          style={{ color: TOK.textSecondary }}
        >
          <BrandBullet>
            One workspace for analyzing any public repo
          </BrandBullet>
          <BrandBullet>One grounded review comment on every PR</BrandBullet>
          <BrandBullet>
            Deterministic signals — no AI hallucinations
          </BrandBullet>
        </ul>
      </div>

      {/* Bottom: subtle attribution. Anchors the panel so the brand
       *  promise floats in the middle rather than tying it visually
       *  to the top. */}
      <p className="text-xs" style={{ color: TOK.textMuted }}>
        RepoBaron &middot; made by coffeejones
      </p>
    </aside>
  );
}

function BrandBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ background: TOK.accent }}
      />
      <span>{children}</span>
    </li>
  );
}

// ─── Right: focused form column ───────────────────────────────────────

function FormPanel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col items-center justify-center px-6 py-12 sm:py-16"
      style={{ background: TOK.bg }}
    >
      {/* Mobile-only logo above the form — replaces the BrandPanel
       *  that's hidden under md. Desktop visitors see the logo on the
       *  left panel instead. */}
      <Link
        href="/"
        className="md:hidden mb-8 opacity-90 hover:opacity-100 transition"
      >
        <Logo size={36} wordmark />
      </Link>
      <div className="w-full max-w-md flex flex-col gap-4">{children}</div>
    </div>
  );
}
