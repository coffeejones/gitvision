// THROWAWAY landing DRAFT v5 — NOT the real landing. Delete before commit.
// Structure adapted from Raycast's layout patterns (pill nav · huge sentence
// hero + one big product shot · stacked big-shot feature sections · a
// capabilities grid · restraint, one accent, generous space) — applied to
// CodeTrawl's own brand, copy, and full screenshots. NO crops, no wireframes.
// Message (founder's framing): a manual for any repo — understand what does
// what, how it connects, what works, what needs fixing.

import { CTSurface } from "@/components/landing/codetrawl/CTSurface";
import { CTScreenshot } from "@/components/landing/codetrawl/CTScreenshot";
import { DraftMotion } from "./DraftMotion";

export const metadata = { title: "CodeTrawl — draft" };

const DEMOS = [
  { label: "zod", href: "https://codetrawl.com/session/qRUWdkTNh-" },
  { label: "flask", href: "https://codetrawl.com/session/2W8VJwPfzl" },
  { label: "gin", href: "https://codetrawl.com/session/zHpVZ1Ybto" },
];

const CAPS = [
  { k: "Git history", v: "Who really owns each corner — and where change keeps piling up." },
  { k: "Structure", v: "How the pieces connect: call graphs, import chains, dead ends." },
  { k: "Source", v: "The code with every finding drawn on it, function by function." },
  { k: "Faultline", v: "What breaks if you change a file — before you change it." },
  { k: "Security", v: "Secrets, risky eval, known incidents — matched to a line, not guessed." },
  { k: "Dependencies", v: "Which packages carry CVEs or have drifted out of date." },
  { k: "Duplicates", v: "The same function body, copy-pasted where it shouldn't be." },
  { k: "Diagrams", v: "The type graph and architecture, drawn from the code itself." },
];

function Intake({ id }: { id?: string }) {
  return (
    <div className="rk-intake" id={id}>
      <form action="https://codetrawl.com/" method="get">
        <span className="rk-field">
          <span className="rk-field-glow" aria-hidden />
          <span className="rk-field-beam" aria-hidden />
          <input type="text" placeholder="github.com/pallets/flask" aria-label="Repository URL" />
        </span>
        <button type="submit">Read the repo</button>
      </form>
      <p className="rk-demos">
        or open one that&apos;s already done —{" "}
        {DEMOS.map((d, i) => (
          <span key={d.label}>
            <a href={d.href}>{d.label}</a>
            {i < DEMOS.length - 1 ? " · " : ""}
          </span>
        ))}
        <span className="rk-demos-tail"> · no sign-up</span>
      </p>
    </div>
  );
}

export default function LandingDraftPage() {
  return (
    <CTSurface>
      <style>{CSS}</style>
      <DraftMotion />

      <div className="rk">
        {/* ── NAV — pill ───────────────────────────────────────────────── */}
        <div className="rk-navwrap">
          <nav className="rk-nav">
            <span className="rk-logo">CodeTrawl</span>
            <span className="rk-nav-links">
              <a href="#read">Source</a>
              <a href="#faultline">Faultline</a>
              <a href="#caps">Everything else</a>
              <a href="#">Pricing</a>
            </span>
            <span className="rk-nav-right">
              <a href="#" className="rk-nav-login">Log in</a>
              <a href="#top" className="rk-nav-cta">Analyze a repo</a>
            </span>
          </nav>
        </div>

        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <header className="rk-hero" id="top">
          <h1 className="rk-h1">Get to know any codebase<span className="rk-dot">.</span></h1>
          <p className="rk-lede">
            Paste a GitHub repo and read it like a manual — what every part does,
            how it all connects, and what breaks if you touch it. One sweep, about
            a minute, nothing to install.
          </p>
          <Intake />
          <div className="rk-hero-shot">
            <CTScreenshot
              src="/_landingdemo/CT_Overview.png?v=2"
              alt="CodeTrawl reading pallets/flask — overview with lenses and findings"
              label="codetrawl.com — pallets/flask"
              wide
            />
          </div>
        </header>

        {/* ── FEATURE · SOURCE — text left, shot right ─────────────────── */}
        <section className="rk-split" id="read">
          <div className="rk-split-grid">
            <div className="rk-split-copy" data-rv>
              <h2 className="rk-h2 rk-h2--left">Read the code, with the map drawn on it.</h2>
              <p className="rk-split-sub">
                Every function carries its computed complexity, its callers, and
                its risk. Click one and the AI explains what it does in plain
                language — sent on your click, never stored.
              </p>
            </div>
            <div className="rk-split-shot" data-rv="right">
              <CTScreenshot
                src="/_landingdemo/CT_SourceExplainer.png?v=2"
                alt="Source view: a function explained, anchored to computed complexity and callers"
                label="codetrawl.com — source"
                tight
              />
            </div>
          </div>
        </section>

        {/* ── FEATURE · FAULTLINE — shot bleeds off the left edge ──────── */}
        <section className="rk-bleed" id="faultline">
          <div className="rk-bleed-grid">
            <div className="rk-bleed-shot" data-rv="left">
              <CTScreenshot
                src="/_landingdemo/CT_Faultline.png?v=2"
                alt="Faultline: deleting index.ts breaks 15 files, 11 with no test"
                label="codetrawl.com — faultline"
                tight
                bleed="left"
                fade="right"
              />
            </div>
            <div className="rk-bleed-copy" data-rv>
              <h2 className="rk-h2 rk-h2--left">Know what a change breaks — before you make it.</h2>
              <p className="rk-split-sub">
                Pick a file and simulate deleting or changing it. The call graph
                shows exactly which files break, and which ones have no test to
                catch it. Understanding how a repo holds together, made literal.
              </p>
            </div>
          </div>
        </section>

        {/* ── FEATURE · SECURITY — shot bleeds off the right edge ──────── */}
        <section className="rk-bleed rk-bleed--right" id="security">
          <div className="rk-bleed-grid">
            <div className="rk-bleed-copy" data-rv>
              <h2 className="rk-h2 rk-h2--left">The dangerous code, matched to the line.</h2>
              <p className="rk-split-sub">
                Three deterministic scanners — secrets, dynamic-execution
                patterns, and known supply-chain incidents. Every hit is pinned
                to a file and a line you can open. Matched against the record,
                never a guessed CVE.
              </p>
            </div>
            <div className="rk-bleed-shot" data-rv="right">
              <CTScreenshot
                src="/_landingdemo/CT_SecurityReview.png?v=2"
                alt="Security review of flask: eval and exec patterns found in cli.py and config.py, with file and line"
                label="codetrawl.com — security"
                tight
                bleed="right"
                fade="left"
              />
            </div>
          </div>
        </section>

        {/* ── CAPABILITIES GRID ────────────────────────────────────────── */}
        <section className="rk-caps" id="caps">
          <div className="rk-feat-head" data-rv>
            <h2 className="rk-h2">Everything one sweep reads.</h2>
            <p className="rk-feat-sub">
              Eight ways of reading a codebase, computed in a single pass and
              cross-linked — follow any thread to the evidence it came from.
            </p>
          </div>
          <div className="rk-index" data-rv="cascade">
            {CAPS.map((c, i) => (
              <div className="rk-idx-row" key={c.k}>
                <span className="rk-idx-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="rk-idx-body">
                  <span className="rk-idx-k">{c.k}</span>
                  <span className="rk-idx-v">{c.v}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── TRUST STRIP ──────────────────────────────────────────────── */}
        <section className="rk-trust">
          <p className="rk-trust-line" data-rv>
            <b>Computed, never generated.</b> Every finding is measured from the
            real code — tree-sitter ASTs, full git history, resolved dependency
            graphs. The AI narrates what was found; it never invents it.
          </p>
        </section>

        {/* ── CLOSE ────────────────────────────────────────────────────── */}
        <section className="rk-close" data-rv>
          <h2 className="rk-h2 rk-close-h">Read your first repo now.</h2>
          <p className="rk-close-sub">Free on one repo — private repos included. Nothing to install.</p>
          <Intake id="intake" />
          <p className="rk-footer">CodeTrawl · computed, never generated</p>
        </section>
      </div>
    </CTSurface>
  );
}

const CSS = `
.rk { overflow-x: clip; --edge: clamp(20px, 5vw, 40px); }

/* ── NAV — floating pill ─────────────────────────────────────────────── */
.rk .rk-navwrap { position: sticky; top: 0; z-index: 50; padding: 14px var(--edge) 0; }
.rk .rk-nav {
  display: flex; align-items: center; gap: 24px;
  max-width: 1180px; margin: 0 auto; height: 56px; padding: 0 10px 0 22px;
  border: 1px solid var(--ct-line); border-radius: 16px;
  background: color-mix(in srgb, var(--ct-bg) 72%, transparent);
  backdrop-filter: blur(16px);
}
.rk .rk-logo { font-weight: 600; letter-spacing: -0.02em; font-size: 16px; }
.rk .rk-nav-links { display: flex; gap: 24px; margin: 0 auto 0 18px; }
.rk .rk-nav-links a { color: var(--ct-dim); font-size: 14px; text-decoration: none; }
.rk .rk-nav-links a:hover { color: var(--ct-text); }
.rk .rk-nav-right { display: flex; align-items: center; gap: 16px; }
.rk .rk-nav-login { color: var(--ct-dim); font-size: 14px; text-decoration: none; }
.rk .rk-nav-login:hover { color: var(--ct-text); }
.rk .rk-nav-cta {
  font-size: 14px; font-weight: 600; text-decoration: none;
  color: #140a02; background: var(--ct-orange);
  border-radius: 11px; padding: 10px 16px;
}
.rk .rk-nav-cta:hover { background: var(--ct-ember); }

/* ── HERO ────────────────────────────────────────────────────────────── */
.rk .rk-hero { max-width: 1180px; margin: 0 auto; padding: clamp(56px, 9vw, 120px) var(--edge) 0; text-align: center; }
.rk .rk-h1 {
  margin: 0 auto 26px; max-width: 14ch;
  font-size: clamp(46px, 8vw, 104px); font-weight: 600;
  letter-spacing: -0.045em; line-height: 0.98; text-wrap: balance;
}
.rk .rk-dot { color: var(--ct-orange); }
.rk .rk-lede {
  max-width: 600px; margin: 0 auto 36px;
  color: var(--ct-dim); font-size: clamp(17px, 1.7vw, 20px); line-height: 1.5;
}

/* intake */
.rk .rk-intake { max-width: 560px; margin: 0 auto; }
.rk .rk-intake form { display: flex; gap: 10px; }
/* the field wraps the input: a soft ambient halo behind it + a light that
   orbits the outline clockwise (rotating conic arc; the input's opaque body
   covers the middle, so only the rim shows) */
.rk .rk-field { position: relative; flex: 1; min-width: 0; display: flex; }
.rk .rk-field-glow {
  position: absolute; inset: -10px;
  border-radius: 16px;
  background: radial-gradient(ellipse 70% 90% at 50% 50%,
    color-mix(in srgb, var(--ct-orange) 26%, transparent), transparent 72%);
  filter: blur(14px);
  opacity: 0.28;
  pointer-events: none;
}
/* the beam: a clipped rim whose gradient is painted ONCE and rotated with
   transform (composited — animating the gradient angle itself leaves stale
   paint-tile streaks in Chromium when combined with blur) */
.rk .rk-field-beam {
  position: absolute; inset: -1.5px;
  border-radius: 12px;
  overflow: hidden;
  opacity: 0.8;
  pointer-events: none;
}
.rk .rk-field-beam::before {
  content: "";
  position: absolute; left: 50%; top: 50%;
  width: 150%; aspect-ratio: 1;
  background: conic-gradient(
    transparent 0%, transparent 78%,
    color-mix(in srgb, var(--ct-ember) 70%, transparent) 89%,
    var(--ct-orange) 95%,
    transparent 100%);
  filter: blur(1.5px);
  transform: translate(-50%, -50%) rotate(0deg);
  animation: rk-orbit 5.5s linear infinite;
}
@keyframes rk-orbit { to { transform: translate(-50%, -50%) rotate(360deg); } }
/* focus: the halo holds brighter; the beam keeps orbiting */
.rk .rk-field:focus-within .rk-field-glow { opacity: 0.6; }
@media (prefers-reduced-motion: reduce) {
  .rk .rk-field-beam { display: none; }
  .rk .rk-field-glow { opacity: 0.3; }
}
.rk .rk-intake input {
  position: relative; z-index: 1;
  width: 100%; min-width: 0; font-family: var(--ct-mono); font-size: 14px;
  color: var(--ct-text); background: var(--ct-surface);
  border: 1px solid var(--ct-line); border-radius: 12px; padding: 15px 18px; outline: none;
}
.rk .rk-intake input { transition: border-color 0.25s ease; }
.rk .rk-intake input:focus { border-color: color-mix(in srgb, var(--ct-ember) 55%, transparent); }
.rk .rk-intake input::placeholder { color: var(--ct-ghost); }
.rk .rk-intake button {
  font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
  background: var(--ct-orange); color: #140a02; border: 0; border-radius: 12px; padding: 15px 22px; white-space: nowrap;
}
.rk .rk-intake button:hover { background: var(--ct-ember); }
.rk .rk-demos { margin: 15px 0 0; font-family: var(--ct-mono); font-size: 12.5px; color: var(--ct-faint); }
.rk .rk-demos a { color: var(--ct-dim); text-decoration: underline; text-underline-offset: 3px; }
.rk .rk-demos a:hover { color: var(--ct-text); }
.rk .rk-demos-tail { color: var(--ct-ghost); }

/* the hero shot goes wider than the text column — a big establishing shot,
   centred in the viewport, bleeding a little past the 1180 content edge */
.rk .rk-hero-shot {
  margin-top: clamp(52px, 7vw, 92px);
  width: min(1320px, calc(100vw - 2 * var(--edge)));
  margin-left: 50%;
  transform: translateX(-50%);
}

/* ── FEATURE SECTIONS (centered head, for reference) ─────────────────── */
.rk .rk-feat { max-width: 1180px; margin: 0 auto; padding: clamp(88px, 12vw, 168px) var(--edge) 0; }
.rk .rk-feat-head { max-width: 720px; margin: 0 auto clamp(40px, 5vw, 64px); text-align: center; }
.rk .rk-h2 { margin: 0 0 18px; font-size: clamp(30px, 4.2vw, 54px); font-weight: 600; letter-spacing: -0.035em; line-height: 1.05; text-wrap: balance; }
.rk .rk-h2--left { text-wrap: pretty; }
.rk .rk-feat-sub { margin: 0; color: var(--ct-dim); font-size: clamp(16px, 1.6vw, 19px); line-height: 1.55; }

/* ── SPLIT FEATURE — asymmetric 2-col, alternating sides ─────────────── */
.rk .rk-split { max-width: 1180px; margin: 0 auto; padding: clamp(88px, 12vw, 168px) var(--edge) 0; }
.rk .rk-split-grid { display: grid; grid-template-columns: 0.92fr 1.28fr; gap: clamp(32px, 5vw, 80px); align-items: center; }
.rk .rk-split--flip .rk-split-grid { grid-template-columns: 1.28fr 0.92fr; }
.rk .rk-split--flip .rk-split-copy { order: 2; }
.rk .rk-split--flip .rk-split-shot { order: 1; }
.rk .rk-split-copy { max-width: 440px; }
.rk .rk-split--flip .rk-split-copy { margin-left: auto; }
.rk .rk-split-sub { margin: 0; color: var(--ct-dim); font-size: clamp(16px, 1.6vw, 18px); line-height: 1.55; }
.rk .rk-split-shot { min-width: 0; }

/* ── BLEED FEATURE — shot runs flush off the left viewport edge ───────── */
.rk .rk-bleed { padding: clamp(88px, 12vw, 168px) 0 0; }
.rk .rk-bleed-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) min(380px, 34vw);
  gap: clamp(28px, 4vw, 64px);
  align-items: center;
  /* right column aligns to the 1180 content edge; left column reaches x=0 */
  padding-right: max(var(--edge), calc((100vw - 1180px) / 2 + var(--edge)));
}
.rk .rk-bleed-shot { min-width: 0; }
.rk .rk-bleed-copy { max-width: 380px; }

/* mirror: copy left (in the left gutter), shot bleeds off the right edge */
.rk .rk-bleed--right .rk-bleed-grid {
  grid-template-columns: min(380px, 34vw) minmax(0, 1fr);
  padding-right: 0;
  padding-left: max(var(--edge), calc((100vw - 1180px) / 2 + var(--edge)));
}

/* ── CAPABILITIES GRID ───────────────────────────────────────────────── */
.rk .rk-caps { max-width: 1180px; margin: 0 auto; padding: clamp(88px, 12vw, 168px) var(--edge) 0; }
/* the survey's table of contents — hairline rows, mono index, no cards */
.rk .rk-index {
  display: grid;
  grid-auto-flow: column;
  grid-template-rows: repeat(4, 1fr);
  column-gap: clamp(36px, 5vw, 80px);
  border-top: 1px solid var(--ct-line);
}
.rk .rk-idx-row {
  display: flex; gap: 16px; align-items: baseline;
  padding: clamp(18px, 2vw, 24px) 2px;
  border-bottom: 1px solid var(--ct-line);
}
.rk .rk-idx-n { flex: none; min-width: 22px; font-family: var(--ct-mono); font-size: 12px; color: var(--ct-ghost); }
.rk .rk-idx-body { display: flex; flex-direction: column; gap: 5px; }
.rk .rk-idx-k { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
.rk .rk-idx-v { color: var(--ct-dim); font-size: 14px; line-height: 1.5; }

/* ── TRUST STRIP ─────────────────────────────────────────────────────── */
.rk .rk-trust { max-width: 820px; margin: clamp(88px, 12vw, 160px) auto 0; padding: 0 var(--edge); }
.rk .rk-trust-line { margin: 0; padding: clamp(32px, 4vw, 44px) 0; border-top: 1px solid var(--ct-line); border-bottom: 1px solid var(--ct-line); text-align: center; font-size: clamp(17px, 1.8vw, 21px); line-height: 1.55; color: var(--ct-dim); }
.rk .rk-trust-line b { color: var(--ct-text); }

/* ── CLOSE ───────────────────────────────────────────────────────────── */
.rk .rk-close { max-width: 720px; margin: 0 auto; padding: clamp(96px, 13vw, 180px) var(--edge) 80px; text-align: center; }
.rk .rk-close-h { margin: 0 0 16px; }
.rk .rk-close-sub { margin: 0 0 34px; color: var(--ct-dim); font-size: 18px; }
.rk .rk-close .rk-demos { text-align: center; }
.rk .rk-footer { margin: clamp(64px, 9vw, 104px) 0 0; font-family: var(--ct-mono); font-size: 12px; color: var(--ct-faint); }

@media (max-width: 900px) {
  .rk .rk-nav-links { display: none; }
  .rk .rk-intake form { flex-direction: column; }
  .rk .rk-split-grid, .rk .rk-split--flip .rk-split-grid { grid-template-columns: 1fr; gap: clamp(20px, 4vw, 36px); }
  .rk .rk-split--flip .rk-split-copy { order: 1; margin-left: 0; }
  .rk .rk-split--flip .rk-split-shot { order: 2; }
  .rk .rk-split-copy { max-width: 560px; }
  .rk .rk-bleed { padding-left: 0; padding-right: 0; }
  .rk .rk-bleed-grid,
  .rk .rk-bleed--right .rk-bleed-grid { grid-template-columns: 1fr; gap: clamp(20px, 4vw, 36px); padding-right: 0; padding-left: 0; }
  .rk .rk-bleed-copy { order: 1; max-width: 560px; padding: 0 var(--edge); }
  .rk .rk-bleed-shot { order: 2; }
}
@media (max-width: 640px) {
  .rk .rk-index { grid-auto-flow: row; grid-template-rows: none; grid-template-columns: 1fr; }
}

/* ═══ MOTION LAYER ═══════════════════════════════════════════════════════
   Restraint-first: small distances, spring physics, directional, one-shot.
   Nothing loops; reduced-motion renders everything finished. */

/* lenis base (smooth scroll) */
html.lenis, html.lenis body { height: auto; }
.lenis.lenis-smooth { scroll-behavior: auto !important; }

/* ── reveals — CSS owns the transition; JS only adds .in ─────────────── */
.rk [data-rv] {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 0.65s ease, transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
  /* damped spring — peaks at ~3.5% overshoot (was ~9%) */
  transition-timing-function: ease, linear(0, 0.0059 0.9%, 0.0234 1.9%, 0.0894 4%, 0.2005 6.5%, 0.4084 10.4%, 0.7233 16.4%, 0.8221 19%, 0.9022 21.7%, 0.9634 24.6%, 1.0064 27.7%, 1.0294 31%, 1.0355 34.6%, 1.0327 39.1%, 1.0221 46.4%, 1.0056 58.7%, 0.9992 69.8%, 0.9998 92%, 1);
  will-change: opacity, transform;
}
.rk [data-rv="left"] { transform: translateX(-32px); }
.rk [data-rv="right"] { transform: translateX(32px); }
.rk [data-rv].in { opacity: 1; transform: none; }

/* cascade: the index container is static; its rows stagger row-by-row
   (child n and n+4 share a delay so both columns cascade together) */
.rk [data-rv="cascade"] { opacity: 1; transform: none; }
.rk [data-rv="cascade"] .rk-idx-row {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 0.55s ease, transform 0.75s cubic-bezier(0.22, 1, 0.36, 1);
}
.rk [data-rv="cascade"].in .rk-idx-row { opacity: 1; transform: none; }
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(2),
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(6) { transition-delay: 70ms; }
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(3),
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(7) { transition-delay: 140ms; }
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(4),
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(8) { transition-delay: 210ms; }

/* ── hero load choreography — animates children, never the parallax el ── */
@keyframes rk-rise {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: none; }
}
@keyframes rk-surface {
  from { opacity: 0; transform: translateY(30px) scale(0.988); }
  to { opacity: 1; transform: none; }
}
.rk .rk-h1 { animation: rk-rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.05s backwards; }
.rk .rk-lede { animation: rk-rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.14s backwards; }
.rk .rk-hero .rk-intake { animation: rk-rise 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.23s backwards; }
.rk .rk-hero-shot figure { animation: rk-surface 1.1s cubic-bezier(0.22, 1, 0.36, 1) 0.34s backwards; }

/* parallax transform lives inline on .rk-hero-shot (JS); keep it smooth */
.rk .rk-hero-shot { will-change: transform; }

/* ── nav scrolled state ──────────────────────────────────────────────── */
.rk .rk-nav { transition: background 0.25s ease, border-color 0.25s ease; }
.rk .rk-navwrap.scrolled .rk-nav {
  background: color-mix(in srgb, var(--ct-bg) 88%, transparent);
  border-color: color-mix(in srgb, var(--ct-line) 100%, rgba(242, 239, 234, 0.06));
}

/* ── hover micro-interactions ────────────────────────────────────────── */
.rk .rk-intake button, .rk .rk-nav-cta {
  transition: background 0.16s ease, transform 0.16s ease;
}
.rk .rk-intake button:hover, .rk .rk-nav-cta:hover { transform: translateY(-1px); }
.rk .rk-intake button:active, .rk .rk-nav-cta:active { transform: translateY(0) scale(0.985); }
.rk .rk-demos a, .rk .rk-nav-links a, .rk .rk-nav-login {
  transition: color 0.15s ease, text-underline-offset 0.15s ease;
}
.rk .rk-demos a:hover { text-underline-offset: 5px; }
.rk .rk-idx-row { transition: background 0.2s ease; }
.rk .rk-idx-row:hover { background: color-mix(in srgb, var(--ct-surface) 55%, transparent); }
.rk .rk-idx-n { transition: color 0.2s ease; }
.rk .rk-idx-row:hover .rk-idx-n { color: var(--ct-ember); }

/* ── reduced motion: render finished, no choreography ────────────────── */
@media (prefers-reduced-motion: reduce) {
  .rk [data-rv], .rk [data-rv="cascade"] .rk-idx-row { opacity: 1; transform: none; transition: none; }
  .rk .rk-h1, .rk .rk-lede, .rk .rk-hero .rk-intake, .rk .rk-hero-shot figure { animation: none; }
}
`;
