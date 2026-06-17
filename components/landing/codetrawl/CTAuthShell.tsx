// CTAuthShell — CodeTrawl-themed split shell for the auth surfaces (/login,
// /signup, /forgot-password, /reset-password): a brand tease on the left, the
// form column on the right, in the "SURFACE & DEPTH" design system (bitumen,
// Schibsted Grotesk + Fragment Mono, hairlines).
//
// The form components reuse the same `.auth-*` class names, scoped here under
// CTSurface's `.ct`, so codetrawl.css styles them. Mobile (<861px) collapses
// to the form alone with a small wordmark above.

import Link from "next/link";
import { CTSurface } from "./CTSurface";

export function CTAuthShell({ children }: { children: React.ReactNode }) {
  return (
    <CTSurface>
      <div className="auth-wrap">
        <aside className="auth-brand">
          <Link href="/" className="auth-brandmark">CodeTrawl</Link>

          <div className="auth-tease">
            <h2>See to the bottom of any codebase.</h2>
            <p>
              Every repo you&rsquo;ve swept is saved here — the full survey,
              refreshable. &ldquo;Since your last visit&rdquo; shows exactly
              what moved.
            </p>
            <ul className="auth-points">
              <li>Open any survey — grade, signals, and the evidence behind them</li>
              <li>Re-run anytime — see what moved since your last sweep</li>
              <li>Computed, never generated — deterministic, no AI guesses</li>
            </ul>
          </div>

          <p className="auth-foot">© 2026 CodeTrawl</p>
        </aside>

        <div className="auth-col">
          <Link href="/" className="brand-mobile">CodeTrawl</Link>
          {children}
        </div>
      </div>
    </CTSurface>
  );
}
