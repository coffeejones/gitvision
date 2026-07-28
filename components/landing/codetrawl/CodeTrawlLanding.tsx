// CodeTrawl landing — "READ THE REPO" composition (2026-07 redesign).
//
// Message (the founder's framing): a manual for any repo — what every part
// does, how it all connects, what works, and what breaks if you touch it.
// Structure adapted from Raycast's layout grammar (pill nav · huge sentence
// hero · alternating feature sections with edge bleeds · a hairline index ·
// thin trust strip · close), applied to the .ct design system: bitumen,
// Schibsted Grotesk, International Orange rationed.
//
// THE HERO CARRIES NO SHOT. It held a full Overview screen and the promise had
// to share the first screen with it; without it the sentence and the intake own
// the fold, and the first thing below is CTDemoProof — three repos already
// swept, which a visitor can open. A live report is better proof than a picture
// of one, and it was the picture that was competing.
//
// Product imagery is RENDERED, not photographed — there are no screenshots left
// in public/landing. CTCodePane and CTBlastDiagram redraw surfaces whose product
// components are client-side; CTSecurityPane mounts the product's own
// SecurityPanel outright. Source/Faultline are our own repo (dogfood), Security
// is the public flask demo, and every visible number came off a real sweep.
//
// Motion (CTMotion + the MOTION LAYER css): Lenis smooth scroll, directional
// spring reveals, index cascade, one deliberate loop (the intake's orbiting
// border light). prefers-reduced-motion renders finished. The hero parallax
// went with the hero shot.

import { CTSurface } from "./CTSurface";
import { CTNav } from "./CTNav";
import { CTDemoProof } from "./CTDemoProof";
import { CTProof } from "./CTProof";
import { CTFaq } from "./CTFaq";
import { CTCodePane } from "./CTCodePane";
import { CTBlastDiagram } from "./CTBlastDiagram";
import { CTSecurityPane } from "./CTSecurityPane";
import type { DemoHighlight } from "@/lib/demoHighlights";
import { CTScreenshot } from "./CTScreenshot";
import { CTLandingIntake } from "./CTLandingIntake";
import { CTMotion } from "./CTMotion";
import { CTFooter } from "./CTFooter";

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

const STEPS = [
  { k: "Paste a repo", v: "Any GitHub URL — public or private. Nothing to install, nothing to configure." },
  { k: "One sweep, about a minute", v: "Full git history, AST structure, security, dependencies — computed in a single pass." },
  { k: "Read the manual", v: "A grade to orient you, then the survey: source, Faultline, signals — every claim with its evidence." },
];

export function CodeTrawlLanding({ demos }: { demos: DemoHighlight[] }) {
  return (
    <CTSurface>
      <style>{CSS}</style>
      <CTMotion />

      <div className="rk">
        {/* ── NAV — shared across every public page (CTNav) ─────────────── */}
        <CTNav onLanding />

        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <header className="rk-hero" id="top">
          <h1 className="rk-h1">Get to know any codebase<span className="rk-dot">.</span></h1>
          <p className="rk-lede">
            Paste a GitHub repo and read it like a manual — what every part does,
            how it all connects, and what breaks if you touch it. One sweep, about
            a minute, nothing to install.
          </p>
          <CTLandingIntake resume />
        </header>

        {/* ── PROOF — the three open sweeps, directly after the promise ─── */}
        <CTDemoProof demos={demos} />

        {/* ── NUMBERS — and the way into the pages that prove them ──────── */}
        <CTProof />

        {/* ── HOW IT WORKS — three hairline steps ──────────────────────── */}
        <section className="rk-how" id="how">
          <div className="rk-how-grid" data-rv="cascade">
            {STEPS.map((s, i) => (
              <div className="rk-idx-row" key={s.k}>
                <span className="rk-idx-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="rk-idx-body">
                  <span className="rk-idx-k">{s.k}</span>
                  <span className="rk-idx-v">{s.v}</span>
                </span>
              </div>
            ))}
          </div>
        </section>

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
              {/* Rendered, not photographed — same frame as the screenshots
                  around it, so the chrome gives nothing away. See CTCodePane. */}
              <CTScreenshot label="codetrawl.com — source" tight>
                <CTCodePane />
              </CTScreenshot>
            </div>
          </div>
        </section>

        {/* ── FEATURE · FAULTLINE — shot bleeds off the left edge ──────── */}
        <section className="rk-bleed" id="faultline">
          <div className="rk-bleed-grid">
            <div className="rk-bleed-shot" data-rv="left">
              {/* Rendered, not photographed. This is the shot that carried the
                  unstyled React Flow panel for weeks and had to be patched by
                  hand — there is nothing left to photograph or patch. */}
              <CTScreenshot label="codetrawl.com — faultline" tight bleed="left" fade="right">
                <CTBlastDiagram />
              </CTScreenshot>
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
                to the exact line, or the exact package. Matched against the
                record, never a guessed CVE.
              </p>
            </div>
            <div className="rk-bleed-shot" data-rv="right">
              {/* Not a rebuild — the product's own SecurityPanel, rendered on a
                  pinned sweep. See CTSecurityPane. */}
              <CTScreenshot label="codetrawl.com — security" tight bleed="right" fade="left">
                <CTSecurityPane />
              </CTScreenshot>
            </div>
          </div>
        </section>

        {/* ── INDEX — everything one sweep reads ───────────────────────── */}
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

        {/* ── FAQ — the objections, answered before the last ask ───────── */}
        <CTFaq />

        {/* ── CLOSE ────────────────────────────────────────────────────── */}
        <section className="rk-close" data-rv>
          <h2 className="rk-h2 rk-close-h">Read your first repo now.</h2>
          <p className="rk-close-sub">Free on one repo — private repos included. Nothing to install.</p>
          <CTLandingIntake />
        </section>
      </div>

      <CTFooter />
    </CTSurface>
  );
}

const CSS = `
/* --edge is the landing's local alias for the shared gutter. It must stay
   equal to --ct-edge or the landing's sections stop lining up with the nav and
   the footer, so it defers rather than restating the clamp. */
.rk { overflow-x: clip; --edge: var(--ct-edge); }

/* ── SECTION CADENCE ──────────────────────────────────────────────────────
   Section gaps mark where an ARGUMENT ends, not a fixed tick. Four sections in
   a row used to open with the same 168px and the page read as evenly-spaced
   slabs; a gap that never varies stops carrying information.
   Desktop maxima, and the reason for each:

     hero    120   the promise
     proof    92   its evidence — same beat as the hero, so: tighter
     stats    64   still that beat, tighter again
     how     160   NEW ARGUMENT (how it works) — the page's widest break
     split   144   the feature group opens
     bleed   112   inside the group
     bleed   112   inside the group
     caps    144   the group's summary
     trust   160   (margin) the turn
     faq     128   objections
     close   176   the ask, and it needs the air

   If a section is added, decide which beat it belongs to and match that beat's
   value — do not average it into the middle. */

/* The nav lives in codetrawl.css as .ct-nav* — it is shared with every other
   public page now (CTNav), so it can't stay in this page's private stylesheet. */

/* ── HERO ────────────────────────────────────────────────────────────── */
.rk .rk-hero { max-width: 1180px; margin: 0 auto; padding: clamp(56px, 9vw, 120px) var(--edge) clamp(28px, 5vw, 64px); text-align: center; }
/* 92, down from 104. The "huge sentence hero" is deliberate — it is the
   Raycast grammar this page is built on — so this is a trim, not a retreat to
   the 56-64px the SaaS default lands at. What 104 cost was the relationship to
   everything under it: against a 54px h2 it read 1.93:1, close enough to two
   full steps that the h2 stopped registering as a heading at all. 92:54 is
   1.7 — still emphatic, and the rest of the page can be heard. */
.rk .rk-h1 {
  margin: 0 auto 26px; max-width: 14ch;
  font-size: clamp(46px, 7.2vw, 92px); font-weight: 600;
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
  transition: border-color 0.25s ease;
}
.rk .rk-intake input:focus { border-color: color-mix(in srgb, var(--ct-ember) 55%, transparent); }
.rk .rk-intake input::placeholder { color: var(--ct-ghost); }
.rk .rk-intake input:disabled { opacity: 0.6; }
.rk .rk-intake button {
  font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
  background: var(--ct-orange); color: #140a02; border: 0; border-radius: 12px; padding: 15px 22px; white-space: nowrap;
}
.rk .rk-intake button:hover { background: var(--ct-ember); }
.rk .rk-intake button:disabled { opacity: 0.7; cursor: default; }
.rk .rk-intake-err {
  min-height: 20px; margin: 10px 0 0;
  font-family: var(--ct-mono); font-size: 12px; color: var(--ct-ember);
}
/* The note under the intake. 14px on --ct-dim (6.7:1), not 12.5px on
   --ct-ghost (3.2:1, below AA) — it is load-bearing information about what the
   button is about to do, and the old line put exactly that on the token
   reserved for ink that conveys nothing. */
.rk .rk-intake-note {
  margin: 10px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ct-dim);
}
.rk .rk-intake-note a {
  color: var(--ct-text);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: text-underline-offset 0.15s ease;
}
.rk .rk-intake-note a:hover { text-underline-offset: 5px; }

/* ── PROOF — the three open sweeps ───────────────────────────────────────
   Denser than the sections around it on purpose. Everything else on this page
   is a claim with air around it; this is the one place a visitor can check the
   claims themselves, so it reads as a set of results rather than a pitch. */
.rk .rk-proof { max-width: 1180px; margin: 0 auto; padding: clamp(52px, 6vw, 92px) var(--edge) 0; }
.rk .rk-proof-head { max-width: 640px; margin: 0 0 clamp(28px, 3.5vw, 40px); }
.rk .rk-proof-head .rk-h2 { font-size: clamp(27px, 3.3vw, 40px); }
.rk .rk-proof-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: clamp(14px, 1.6vw, 20px);
}
.rk .rk-proof-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-height: 178px;
  padding: 20px;
  border: 1px solid var(--ct-line);
  border-radius: 14px;
  background: color-mix(in srgb, var(--ct-surface) 60%, transparent);
  text-decoration: none;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}
.rk .rk-proof-card--bare { min-height: 0; }
.rk .rk-proof-card:hover {
  border-color: color-mix(in srgb, var(--ct-ember) 40%, transparent);
  background: var(--ct-surface);
  transform: translateY(-2px);
}
.rk .rk-proof-repo {
  font-family: var(--ct-mono);
  font-size: 13px;
  color: var(--ct-text);
}
.rk .rk-proof-meta {
  font-family: var(--ct-mono);
  font-size: 12px;
  color: var(--ct-faint);
}
/* The computed finding is the reason the card exists, so it is the largest
   thing on it. */
.rk .rk-proof-finding {
  margin-top: 4px;
  font-size: 16px;
  line-height: 1.42;
  letter-spacing: -0.005em;
  color: var(--ct-text);
  text-wrap: pretty;
}
.rk .rk-proof-cta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ct-ember);
}
.rk .rk-proof-card:hover .rk-proof-cta { color: var(--ct-orange); }

/* ── NUMBERS — four figures, each a door ─────────────────────────────────
   Tighter than the sections around it. A stat that has to be scrolled past
   isn't a stat, it's a paragraph with a big number in it. */
.rk .rk-stats { max-width: 1180px; margin: 0 auto; padding: clamp(40px, 4.5vw, 64px) var(--edge) 0; }
.rk .rk-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  background: var(--ct-line);
  border: 1px solid var(--ct-line);
  border-radius: 14px;
  overflow: hidden;
}
/* The 1px grid gap IS the rule between cells — cheaper than per-cell borders
   and it never doubles up at the seams. */
.rk .rk-stat {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 22px 20px 20px;
  background: var(--ct-bg);
  text-decoration: none;
  transition: background 0.2s ease;
}
.rk .rk-stat:hover { background: var(--ct-surface); }
.rk .rk-stat-figure {
  font-size: 38px;
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1;
  color: var(--ct-text);
}
.rk .rk-stat-label {
  display: flex;
  align-items: baseline;
  gap: 5px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ct-text);
}
.rk .rk-stat-arrow { flex: none; color: var(--ct-ghost); transition: color 0.2s ease, transform 0.2s ease; }
.rk .rk-stat:hover .rk-stat-arrow { color: var(--ct-ember); transform: translate(1px, -1px); }
.rk .rk-stat-detail { font-size: 13px; line-height: 1.5; color: var(--ct-dim); }

/* ── FAQ — native <details>, no accordion machinery ──────────────────── */
.rk .rk-faq { max-width: 820px; margin: 0 auto; padding: clamp(72px, 9vw, 128px) var(--edge) 0; }
.rk .rk-faq-head { margin: 0 0 clamp(20px, 2.5vw, 30px); }
.rk .rk-faq-head .rk-h2 { font-size: clamp(27px, 3.3vw, 40px); margin: 0; }
.rk .rk-faq-list { border-top: 1px solid var(--ct-line); }
.rk .rk-faq-item { border-bottom: 1px solid var(--ct-line); }
.rk .rk-faq-q {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 20px 2px;
  font-size: 16.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ct-text);
  cursor: pointer;
  list-style: none;
  transition: color 0.15s ease;
}
.rk .rk-faq-q::-webkit-details-marker { display: none; }
.rk .rk-faq-q:hover { color: var(--ct-ember); }
.rk .rk-faq-icon { flex: none; color: var(--ct-ghost); transition: transform 0.2s ease, color 0.2s ease; }
.rk .rk-faq-item[open] .rk-faq-icon { transform: rotate(45deg); color: var(--ct-ember); }
.rk .rk-faq-a {
  padding: 0 2px 22px;
  max-width: 68ch;
  font-size: 15px;
  line-height: 1.65;
  color: var(--ct-dim);
}
.rk .rk-faq-a a {
  color: var(--ct-text);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: text-underline-offset 0.15s ease;
}
.rk .rk-faq-a a:hover { text-underline-offset: 5px; }

/* ── HOW IT WORKS — three hairline steps ─────────────────────────────── */
.rk .rk-how { max-width: 1180px; margin: 0 auto; padding: clamp(88px, 11vw, 160px) var(--edge) 0; }
.rk .rk-how-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  column-gap: clamp(36px, 5vw, 80px);
  border-top: 1px solid var(--ct-line);
}

/* ── SECTION HEADS ───────────────────────────────────────────────────── */
.rk .rk-feat-head { max-width: 720px; margin: 0 auto clamp(40px, 5vw, 64px); text-align: center; }
.rk .rk-h2 { margin: 0 0 18px; font-size: clamp(30px, 4.2vw, 54px); font-weight: 600; letter-spacing: -0.035em; line-height: 1.05; text-wrap: balance; }
.rk .rk-h2--left { text-wrap: pretty; }
.rk .rk-feat-sub { margin: 0; color: var(--ct-dim); font-size: clamp(16px, 1.6vw, 19px); line-height: 1.55; }

/* ── SPLIT FEATURE — asymmetric 2-col ────────────────────────────────── */
/* Wider than the 1180 the text sections use — the same move the hero shot
   makes. Taking the width out of the copy column instead starved it to 38
   characters a line, which reads as fragments rather than prose. */
.rk .rk-split { max-width: 1400px; margin: 0 auto; padding: clamp(80px, 10vw, 144px) var(--edge) 0; }
/* The shot column is deliberately dominant. It holds a rendered code pane, and
   a wider pane is also a SHORTER one — the reading's prose wraps into fewer
   lines — so widening fixes the proportion from both directions at once. The
   copy beside it stays above 44 characters a line, which is the floor before a
   narrow column starts reading as a list of fragments. */
.rk .rk-split-grid { display: grid; grid-template-columns: 0.84fr 1.46fr; gap: clamp(28px, 4vw, 64px); align-items: center; }
.rk .rk-split-copy { max-width: 440px; }
.rk .rk-split-sub { margin: 0; color: var(--ct-dim); font-size: clamp(16px, 1.6vw, 18px); line-height: 1.55; }
.rk .rk-split-shot { min-width: 0; }

/* ── BLEED FEATURE — shot runs flush off a viewport edge ─────────────── */
.rk .rk-bleed { padding: clamp(64px, 8vw, 112px) 0 0; }
.rk .rk-bleed-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) min(380px, 34vw);
  gap: clamp(28px, 4vw, 64px);
  align-items: center;
  padding-right: max(var(--edge), calc((100vw - 1180px) / 2 + var(--edge)));
}
.rk .rk-bleed-shot { min-width: 0; }
.rk .rk-bleed-copy { max-width: 380px; }
/* The blast shot has two shapes: the graph on wide screens, a list on narrow
   ones. Exactly one is ever displayed — see the 900px query below. */
.rk .ct-blast-list { display: none; }
.rk .rk-bleed--right .rk-bleed-grid {
  grid-template-columns: min(380px, 34vw) minmax(0, 1fr);
  padding-right: 0;
  padding-left: max(var(--edge), calc((100vw - 1180px) / 2 + var(--edge)));
}

/* ── INDEX — hairline rows, mono numbers, no cards ───────────────────── */
.rk .rk-caps { max-width: 1180px; margin: 0 auto; padding: clamp(80px, 10vw, 144px) var(--edge) 0; }
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
.rk .rk-idx-k { font-size: 16px; font-weight: 600; letter-spacing: -0.01em; }
.rk .rk-idx-v { color: var(--ct-dim); font-size: 14px; line-height: 1.5; }

/* ── TRUST STRIP ─────────────────────────────────────────────────────── */
.rk .rk-trust { max-width: 820px; margin: clamp(88px, 12vw, 160px) auto 0; padding: 0 var(--edge); }
.rk .rk-trust-line { margin: 0; padding: clamp(32px, 4vw, 44px) 0; border-top: 1px solid var(--ct-line); border-bottom: 1px solid var(--ct-line); text-align: center; font-size: clamp(17px, 1.8vw, 21px); line-height: 1.55; color: var(--ct-dim); }
.rk .rk-trust-line b { color: var(--ct-text); }

/* ── CLOSE ───────────────────────────────────────────────────────────── */
.rk .rk-close { max-width: 720px; margin: 0 auto; padding: clamp(96px, 12vw, 176px) var(--edge) clamp(56px, 8vw, 96px); text-align: center; }
.rk .rk-close-h { margin: 0 0 16px; }
/* The same clamp as .rk-lede: both are the sentence under a big heading,
   so they are one role and should be one size. A flat 18 sat half a step
   from the lede's 17-20 range and read as a third body size for no reason. */
.rk .rk-close-sub { margin: 0 0 34px; color: var(--ct-dim); font-size: clamp(17px, 1.7vw, 20px); }
.rk .rk-close .rk-demos { text-align: center; }

@media (max-width: 900px) {
  .rk .rk-intake form { flex-direction: column; }
  .rk .rk-proof-grid { grid-template-columns: 1fr; }
  .rk .rk-proof-card { min-height: 0; }
  .rk .rk-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rk .rk-how-grid { grid-template-columns: 1fr; }
  .rk .rk-split-grid { grid-template-columns: 1fr; gap: clamp(20px, 4vw, 36px); }
  .rk .rk-split-copy { max-width: 560px; }
  .rk .rk-bleed { padding-left: 0; padding-right: 0; }
  .rk .rk-bleed-grid,
  .rk .rk-bleed--right .rk-bleed-grid { grid-template-columns: 1fr; gap: clamp(20px, 4vw, 36px); padding-right: 0; padding-left: 0; }
  .rk .rk-bleed-copy { order: 1; max-width: 560px; padding: 0 var(--edge); }
  .rk .rk-bleed-shot { order: 2; }
  /* Below this width the bleed grid stacks and the shot column collapses to
     roughly the viewport, which scales the blast graph's 1020-unit viewBox to
     about a third and its smallest label to 4px. Swap in the list — see
     CTBlastDiagram. */
  .rk .ct-blast-graph { display: none; }
  .rk .ct-blast-list { display: block; }
}
@media (max-width: 640px) {
  .rk .rk-index { grid-auto-flow: row; grid-template-rows: none; grid-template-columns: 1fr; }
  .rk .rk-stats-grid { grid-template-columns: 1fr; }
  .rk .rk-faq-q { font-size: 15px; padding: 18px 2px; }
}

/* ═══ MOTION LAYER ═══════════════════════════════════════════════════════
   Restraint-first: small distances, spring physics, directional, one-shot.
   Nothing loops except the intake beam; reduced-motion renders finished. */

/* lenis base (smooth scroll) */
html.lenis, html.lenis body { height: auto; }
.lenis.lenis-smooth { scroll-behavior: auto !important; }

/* ── reveals — CSS owns the transition; JS only adds .in ─────────────── */
.rk [data-rv] {
  opacity: 0;
  transform: translateY(18px);
  transition: opacity 0.65s ease, transform 0.9s cubic-bezier(0.22, 1, 0.36, 1);
  /* damped spring — peaks at ~3.5% overshoot */
  transition-timing-function: ease, linear(0, 0.0059 0.9%, 0.0234 1.9%, 0.0894 4%, 0.2005 6.5%, 0.4084 10.4%, 0.7233 16.4%, 0.8221 19%, 0.9022 21.7%, 0.9634 24.6%, 1.0064 27.7%, 1.0294 31%, 1.0355 34.6%, 1.0327 39.1%, 1.0221 46.4%, 1.0056 58.7%, 0.9992 69.8%, 0.9998 92%, 1);
  will-change: opacity, transform;
}
.rk [data-rv="left"] { transform: translateX(-32px); }
.rk [data-rv="right"] { transform: translateX(32px); }
.rk [data-rv].in { opacity: 1; transform: none; }

/* cascade: the container is static; its rows stagger (child n and n+4 share
   a delay so the index's two columns cascade together; the 3-step
   how-it-works simply staggers 1-2-3) */
.rk [data-rv="cascade"] { opacity: 1; transform: none; }
.rk [data-rv="cascade"] .rk-idx-row,
.rk [data-rv="cascade"] .rk-proof-card {
  opacity: 0;
  transform: translateY(14px);
  transition: opacity 0.55s ease, transform 0.75s cubic-bezier(0.22, 1, 0.36, 1);
}
.rk [data-rv="cascade"].in .rk-idx-row,
.rk [data-rv="cascade"].in .rk-proof-card { opacity: 1; transform: none; }
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(2),
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(6),
.rk [data-rv="cascade"].in .rk-proof-card:nth-child(2) { transition-delay: 70ms; }
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(3),
.rk [data-rv="cascade"].in .rk-idx-row:nth-child(7),
.rk [data-rv="cascade"].in .rk-proof-card:nth-child(3) { transition-delay: 140ms; }
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


/* the nav's scrolled state and its hover transitions moved to codetrawl.css
   with the rest of .ct-nav* — CTMotion still toggles .scrolled on .ct-navwrap */

/* ── hover micro-interactions ────────────────────────────────────────── */
.rk .rk-intake button {
  transition: background 0.16s ease, transform 0.16s ease;
}
.rk .rk-intake button:hover { transform: translateY(-1px); }
.rk .rk-intake button:active { transform: translateY(0) scale(0.985); }
.rk .rk-demos a {
  transition: color 0.15s ease, text-underline-offset 0.15s ease;
}
.rk .rk-demos a:hover { text-underline-offset: 5px; }
.rk .rk-idx-row { transition: background 0.2s ease; }
.rk .rk-idx-row:hover { background: color-mix(in srgb, var(--ct-surface) 55%, transparent); }
.rk .rk-idx-n { transition: color 0.2s ease; }
.rk .rk-idx-row:hover .rk-idx-n { color: var(--ct-ember); }

/* ── reduced motion: render finished, no choreography ────────────────── */
@media (prefers-reduced-motion: reduce) {
  .rk [data-rv],
  .rk [data-rv="cascade"] .rk-idx-row,
  .rk [data-rv="cascade"] .rk-proof-card { opacity: 1; transform: none; transition: none; }
  .rk .rk-h1, .rk .rk-lede, .rk .rk-hero .rk-intake { animation: none; }
}
`;
