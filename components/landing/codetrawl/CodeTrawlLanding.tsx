// CodeTrawl landing — product-led enterprise narrative.
//
// The page moves from promise to proof to a guided product tour, then explains
// the deterministic engine and lets visitors inspect open reports themselves.

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CTSurface } from "./CTSurface";
import { CTNav } from "./CTNav";
import { CTFaq } from "./CTFaq";
import { CTProductTour } from "./CTProductTour";
import type { DemoHighlight } from "@/lib/demoHighlights";
import { formatStars } from "@/lib/demoHighlights";
import { CTLandingIntake } from "./CTLandingIntake";
import { CTMotion } from "./CTMotion";
import { CTFooter } from "./CTFooter";
import { HEALTH_SIGNAL_COUNT } from "@/lib/intelligence/healthSummary";

// COUNTS ARE DERIVED, NEVER TYPED. This strip said "20" and the product
// computed 34 — a re-introduction of the exact defect lib/__tests__/
// signalCount.test.ts was written to stop, which it missed because its
// surface list covered in-app pages and not the landing. This file is a
// SERVER component, so importing the real constant costs the client nothing.
const PROOF = [
  ["7", "languages parsed"],
  [String(HEALTH_SIGNAL_COUNT), "computed signals"],
  ["File → line", "traceable evidence"],
  ["No AI", "required for the read"],
] as const;

const METHOD = [
  ["01", "Parse", "AST structure across seven languages"],
  ["02", "Connect", "Calls, imports, history and ownership"],
  ["03", "Test", `${HEALTH_SIGNAL_COUNT} deterministic repository signals`],
  ["04", "Prove", "Evidence at file, function, line or package"],
] as const;

const TRUST = [
  ["Rules before prose", "Repository facts are computed before anything is explained."],
  ["Evidence stays attached", "Every material finding points back to a file, function, line or package."],
  ["AI never decides truth", "Narration can clarify a result. It cannot create or upgrade one."],
] as const;

export function CodeTrawlLanding({ demos }: { demos: DemoHighlight[] }) {
  const demoHref = demos.length > 0 ? "#demos" : undefined;

  return (
    <CTSurface>
      <style>{CSS}</style>
      <CTMotion />

      <div className="rk rv">
        <CTNav onLanding />

        <main>
          <section className="rv-hero" id="top" data-rv-depth>
            <div className="rv-hero-atmosphere" aria-hidden />

            <div className="rv-hero-content">
              <p className="rv-eyebrow">Deterministic codebase intelligence</p>
              <h1>
                Understand the system.
                <span>Change it with confidence.</span>
              </h1>
              <p className="rv-hero-lede">
                CodeTrawl turns structure, history, security and change impact
                into traceable evidence before your next decision.
              </p>
              <div className="rv-hero-intake">
                <CTLandingIntake resume demoHref={demoHref} />
              </div>
            </div>

            <div className="rv-hero-product" data-rv-depth>
              <div className="rv-product-frame">
                <div className="rv-product-bar">
                  <span>CODETRAWL / PALLETS-FLASK</span>
                  <span>ANALYSIS READY</span>
                </div>
                <Image
                  src="/CT_UpdatedImages/CT_Overview.png"
                  alt="CodeTrawl repository overview for pallets/flask"
                  width={2940}
                  height={1508}
                  priority
                />
              </div>
              <div className="rv-product-shadow" aria-hidden />
            </div>
          </section>

          <section className="rv-proof" aria-label="CodeTrawl product facts" data-rv="cascade" data-rv-depth>
            {PROOF.map(([value, label]) => (
              <div key={label}>
                <strong><em>{value}</em></strong>
                <span>{label}</span>
              </div>
            ))}
          </section>

          <section className="rv-tour-section" id="how" data-rv-depth>
            <div className="rv-tour-head" data-rv>
              <p className="rv-kicker">GUIDED PRODUCT TOUR</p>
              <h2>One repository. Four decisions.</h2>
              <p>
                Stay in context as CodeTrawl moves from orientation to change
                impact, security and supply-chain health.
              </p>
            </div>
            <div id="faultline">
              <CTProductTour />
            </div>
          </section>

          <section className="rv-method" id="method" data-rv-depth>
            <div className="rv-method-head" data-rv>
              <p className="rv-kicker">HOW THE READ IS BUILT</p>
              <h2>How CodeTrawl builds the read.</h2>
              <p>
                Narration is optional. The analysis remains useful with every
                AI feature switched off.
              </p>
            </div>
            <div className="rv-method-track" data-rv="cascade">
              {METHOD.map(([number, title, detail]) => (
                <article key={number}>
                  <span>{number}</span>
                  <h3>{title}</h3>
                  <p>{detail}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="rv-assurance" data-rv-depth>
            <div className="rv-assurance-head" data-rv>
              <p className="rv-kicker">TRUST MODEL</p>
              <h2>The evidence layer stands on its own.</h2>
              <p>
                AI can explain a result. It cannot create one, strengthen one
                or decide what is true.
              </p>
              <Link href="/security" className="rv-text-link">
                Read the security model <ArrowUpRight size={14} aria-hidden />
              </Link>
            </div>
            <div className="rv-assurance-list" data-rv="cascade">
              {TRUST.map(([title, detail], index) => (
                <article key={title}>
                  <span>0{index + 1}</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          {demos.length > 0 && (
            <section className="rv-demos" id="demos" data-rv-depth>
              <div className="rv-demos-head" data-rv>
                <p className="rv-kicker">OPEN REPORTS</p>
                <h2>Don&apos;t watch a demo. Open the product.</h2>
                <p>Real repositories and computed findings. No account required.</p>
              </div>
              <div className="rv-demo-list" data-rv="cascade">
                {demos.map((demo, index) => (
                  <Link
                    className="rv-demo"
                    href={"/session/" + demo.sessionId}
                    key={demo.sessionId}
                  >
                    <span className="rv-demo-index">0{index + 1}</span>
                    <span className="rv-demo-repo">
                      <strong>{demo.repo}</strong>
                      <span>
                        {demo.language ?? "Repository"}
                        {demo.stars !== null ? " · " + formatStars(demo.stars) + " stars" : ""}
                      </span>
                    </span>
                    <span className="rv-demo-finding">
                      {demo.finding ?? "Open the computed report"}
                    </span>
                    <ArrowUpRight size={16} aria-hidden />
                  </Link>
                ))}
              </div>
            </section>
          )}

          <CTFaq />

          <section className="rv-close" data-rv data-rv-depth>
            <div className="rv-close-inner">
              <p className="rv-kicker">START WITH THE CODE</p>
              <h2>Know what your next change can touch.</h2>
              <p>Analyze one repository free. Private repositories included.</p>
              <CTLandingIntake demoHref={demoHref} />
              <div className="rv-close-proof" aria-label="Analysis assurances">
                <span>Traceable evidence</span>
                <span>No installation</span>
                <span>AI optional</span>
              </div>
            </div>
          </section>
        </main>
      </div>

      <CTFooter />
    </CTSurface>
  );
}

const CSS = `
.rv { --rv-max: 1180px; --rv-edge: var(--ct-edge); overflow: clip; }
.rv [data-rv-depth] { --rv-depth-sm: 0px; --rv-depth-md: 0px; --rv-depth-lg: 0px; }
.rv :is(#how, #faultline, #method, #demos) { scroll-margin-top: 96px; }
.rv :is(h1, h2, h3, p) { text-wrap: balance; }
.rv a { text-decoration: none; }
.rv :is(.rv-eyebrow, .rv-kicker, .rv-product-bar, .rv-demo-index, .ct-tour-chrome, .ct-tour-step > p:first-child) { font-family: var(--ct-mono); text-transform: uppercase; letter-spacing: .13em; }

/* Compact hero: promise, action and a real product surface in the first act. */
.rv .rv-hero { position: relative; height: 1080px; margin-top: -70px; padding: 150px var(--rv-edge) 0; overflow: hidden; isolation: isolate; }
.rv .rv-hero-atmosphere { position: absolute; inset: 0; z-index: -2; pointer-events: none; background: radial-gradient(ellipse 70% 38% at 50% 75%, rgba(255,79,0,.13), rgba(255,79,0,.022) 48%, transparent 74%), radial-gradient(ellipse 44% 26% at 50% 18%, rgba(242,239,234,.035), transparent 74%), linear-gradient(180deg, #0d0c0b 0%, var(--ct-bg) 78%); }
.rv .rv-hero-atmosphere::before { content: ""; position: absolute; left: 50%; bottom: 80px; width: min(1060px,78vw); height: 430px; border: 1px solid rgba(242,239,234,.035); border-radius: 46%; background: rgba(255,255,255,.008); box-shadow: 0 -1px 0 rgba(255,255,255,.02) inset, 0 80px 130px rgba(0,0,0,.36); transform: translate3d(-50%,var(--rv-depth-lg),0) perspective(900px) rotateX(67deg); transform-origin: center bottom; }
.rv .rv-hero-atmosphere::after { content: ""; position: absolute; left: 50%; bottom: 55px; width: min(920px,68vw); height: 90px; border-radius: 50%; background: rgba(0,0,0,.62); filter: blur(38px); transform: translate3d(-50%,var(--rv-depth-md),0); }
.rv .rv-hero-content { position: relative; z-index: 2; max-width: 1050px; margin: 0 auto; text-align: center; }
.rv .rv-eyebrow, .rv .rv-kicker { margin: 0 0 22px; color: var(--ct-ember); font-size: 10px; line-height: 1.35; }
.rv .rv-hero h1 { margin: 0 auto 24px; color: var(--ct-text); font-size: clamp(56px,6.5vw,90px); font-weight: 520; letter-spacing: -.06em; line-height: .92; }
.rv .rv-hero h1 span { display: block; color: color-mix(in srgb, var(--ct-text) 72%, transparent); }
.rv .rv-hero-lede { max-width: 680px; margin: 0 auto; color: var(--ct-dim); font-size: clamp(18px,1.7vw,21px); line-height: 1.55; }
.rv .rv-hero-intake { max-width: 610px; margin: 32px auto 0; text-align: left; }
.rv .rv-hero-intake .rk-intake { max-width: none; margin: 0; }
.rv .rv-hero-intake .rk-field-glow, .rv .rv-hero-intake .rk-field-beam { display: none; }
.rv .rk-intake form { display: flex; gap: 9px; }
.rv .rk-intake .rk-field { display: flex; position: relative; min-width: 0; flex: 1; }
.rv .rk-intake input { position: relative; z-index: 1; width: 100%; min-width: 0; padding: 15px 17px; border: 1px solid rgba(242,239,234,.16); border-radius: 10px; outline: none; color: var(--ct-text); background: rgba(17,16,15,.86); backdrop-filter: blur(14px); font-family: var(--ct-mono); font-size: 13px; transition: border-color .2s ease, background .2s ease; }
.rv .rk-intake input:focus { border-color: var(--ct-ember); background: rgba(22,20,18,.96); }
.rv .rk-intake input::placeholder { color: var(--ct-ghost); }
.rv .rk-intake button { padding: 15px 20px; border: 0; border-radius: 10px; color: #140a02; background: var(--ct-orange); cursor: pointer; font: 600 14px var(--ct-display); white-space: nowrap; transition: background .16s ease, transform .16s ease; }
.rv .rk-intake button:hover:not(:disabled) { background: var(--ct-ember); transform: translateY(-1px); }
.rv .rk-intake button:disabled { cursor: default; opacity: .65; }
.rv .rk-intake-err { min-height: 20px; margin: 9px 0 0; color: var(--ct-ember); font: 12px var(--ct-mono); }
.rv .rk-intake-note { margin: 9px 0 0; color: var(--ct-faint); font-size: 13px; line-height: 1.45; }
.rv .rk-intake-note a { color: var(--ct-text); text-decoration: underline; text-underline-offset: 3px; }
.rv .rv-hero-product { --rv-tilt-x: 0deg; --rv-tilt-y: 0deg; position: relative; z-index: 1; width: min(1120px,calc(100vw - 48px)); margin: 48px auto 0; perspective: 1500px; isolation: isolate; animation: rv-product-arrive 1.05s cubic-bezier(.22,1,.36,1) .12s both; }
.rv .rv-hero-product::before, .rv .rv-hero-product::after { content: ""; position: absolute; pointer-events: none; border: 1px solid rgba(242,239,234,.085); border-radius: 16px; background: #0b0a09; transform-origin: center top; }
.rv .rv-hero-product::before { z-index: -1; inset: 10px 22px -14px; opacity: .78; box-shadow: 0 26px 55px rgba(0,0,0,.36); transform: translate3d(0,calc(8px + var(--rv-depth-md)),-20px) scale(.982); }
.rv .rv-hero-product::after { z-index: -2; inset: 18px 45px -26px; opacity: .42; transform: translate3d(0,calc(14px + var(--rv-depth-lg)),-40px) scale(.958); }
@keyframes rv-product-arrive { from { opacity: 0; transform: translateY(24px) scale(.985); } to { opacity: 1; transform: none; } }
.rv .rv-product-frame { position: relative; overflow: hidden; border: 1px solid rgba(242,239,234,.17); border-radius: 16px; background: #0b0a09; box-shadow: 0 1px 0 rgba(255,255,255,.045) inset, 0 38px 100px rgba(0,0,0,.54), 0 0 80px rgba(255,79,0,.03); transform: translateZ(28px) rotateX(var(--rv-tilt-x)) rotateY(var(--rv-tilt-y)); transform-style: preserve-3d; transition: transform .22s ease-out, border-color .22s ease, box-shadow .22s ease; }
.rv .rv-hero-product:hover .rv-product-frame { border-color: rgba(242,239,234,.23); box-shadow: 0 1px 0 rgba(255,255,255,.05) inset, 0 42px 110px rgba(0,0,0,.55), 0 0 92px rgba(255,79,0,.055); }
.rv .rv-product-frame::before { content: ""; position: absolute; z-index: 3; top: 0; left: 12%; width: 76%; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,138,80,.58), transparent); opacity: .72; }
.rv .rv-product-frame::after { content: ""; position: absolute; z-index: 4; top: -28%; bottom: -28%; left: -30%; width: 17%; pointer-events: none; background: linear-gradient(90deg, transparent, rgba(255,239,225,.13), transparent); filter: blur(5px); opacity: 0; transform: skewX(-16deg); animation: rv-product-sweep 1.8s cubic-bezier(.22,1,.36,1) .75s 1 both; }
@keyframes rv-product-sweep { 0% { opacity: 0; transform: translateX(0) skewX(-16deg); } 18% { opacity: .5; } 72% { opacity: .22; } 100% { opacity: 0; transform: translateX(780%) skewX(-16deg); } }
.rv .rv-product-bar { display: flex; align-items: center; justify-content: space-between; height: 40px; padding: 0 15px; border-bottom: 1px solid var(--ct-line); color: var(--ct-ghost); background: rgba(12,11,10,.96); font-size: 9px; }
.rv .rv-product-bar span:last-child { color: var(--ct-ember); }
.rv .rv-product-frame > img { display: block; width: calc(100% + 14px); max-width: none; height: auto; }
.rv .rv-product-shadow { position: absolute; z-index: -3; inset: 18% 9% -10%; border-radius: 50%; background: rgba(255,79,0,.13); filter: blur(85px); opacity: .6; transform: translateY(var(--rv-depth-lg)); }

/* A compact proof rail bridges the promise and the walkthrough. */
.rv .rv-proof { position: relative; z-index: 3; display: grid; grid-template-columns: repeat(4,1fr); max-width: var(--rv-max); margin: -26px auto 0; overflow: hidden; border: 1px solid rgba(242,239,234,.115); border-radius: 14px; background: rgba(17,16,15,.84); box-shadow: 0 1px 0 rgba(255,255,255,.025) inset, 0 22px 62px rgba(0,0,0,.28); backdrop-filter: blur(18px); transform: translateY(var(--rv-depth-sm)); }
.rv .rv-proof > div { display: flex; min-height: 102px; flex-direction: column; justify-content: center; gap: 5px; padding: 18px 24px; border-right: 1px solid var(--ct-line); }
.rv .rv-proof > div:last-child { border-right: 0; }
.rv .rv-proof strong { display: block; overflow: hidden; color: var(--ct-text); font-size: 19px; font-weight: 520; letter-spacing: -.025em; }
.rv .rv-proof strong em { display: block; opacity: 0; font-style: normal; transform: translateY(105%); transition: opacity .5s ease, transform .7s cubic-bezier(.22,1,.36,1); }
.rv .rv-proof.in strong em { opacity: 1; transform: none; }
/* --ct-dim, not --ct-ghost: measured on the panel background, ghost lands at
   3.10:1 and this is 9px body text, where WCAG AA wants 4.5:1. --ct-dim is
   6.49:1 and already in the palette, so nothing new is invented. These labels
   carry the page's load-bearing claims ('COMPUTED SIGNALS'), which is the worst
   place to be hard to read. */
.rv .rv-proof span { color: var(--ct-dim); font: 9px var(--ct-mono); text-transform: uppercase; letter-spacing: .11em; }

/* Sticky product tour: one visual, four work questions. */
.rv .rv-tour-section { position: relative; max-width: 1320px; margin: 0 auto; padding: clamp(130px,14vw,190px) var(--rv-edge) clamp(150px,17vw,220px); isolation: isolate; }
.rv .rv-tour-section::before { content: ""; position: absolute; z-index: -2; top: 500px; right: 10px; bottom: 150px; left: 10px; border: 1px solid rgba(242,239,234,.06); border-radius: 32px; background: linear-gradient(145deg, rgba(242,239,234,.024), rgba(242,239,234,.007) 38%, rgba(0,0,0,.08)); box-shadow: 0 1px 0 rgba(255,255,255,.018) inset, 0 48px 110px rgba(0,0,0,.18); transform: translateY(var(--rv-depth-md)); }
.rv .rv-tour-section::after { content: ""; position: absolute; z-index: -1; top: 499px; left: 11%; width: 42%; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,138,80,.22), transparent); opacity: .7; transform: translateY(var(--rv-depth-md)); }
.rv .rv-tour-head { max-width: 710px; margin: 0 0 72px; }
.rv .rv-tour-head h2, .rv .rv-method-head h2, .rv .rv-assurance-head h2, .rv .rv-demos-head h2, .rv .rv-close h2 { margin: 0 0 18px; color: var(--ct-text); font-size: clamp(40px,5vw,66px); font-weight: 530; letter-spacing: -.052em; line-height: .98; }
.rv .rv-tour-head > p:last-child, .rv .rv-method-head > p:last-child, .rv .rv-demos-head > p:last-child { max-width: 610px; margin: 0; color: var(--ct-dim); font-size: 18px; line-height: 1.58; }
.rv .ct-tour { display: grid; grid-template-columns: minmax(0,1.65fr) minmax(300px,.68fr); gap: clamp(34px,5vw,72px); align-items: start; }
.rv .ct-tour-visual { position: sticky; top: 104px; min-width: 0; isolation: isolate; }
.rv .ct-tour-visual::before { content: ""; position: absolute; z-index: -1; inset: 13% 9% 9%; border-radius: 50%; background: rgba(255,79,0,.12); filter: blur(72px); opacity: .48; }
.rv .ct-tour-visual::after { content: ""; position: absolute; z-index: -1; inset: 10px 18px -15px; border: 1px solid rgba(242,239,234,.075); border-radius: 15px; background: #0a0908; box-shadow: 0 28px 54px rgba(0,0,0,.26); transform: translateY(var(--rv-depth-lg)) scale(.975); transform-origin: center top; }
.rv .ct-tour-window { position: relative; overflow: hidden; border: 1px solid rgba(242,239,234,.16); border-radius: 15px; background: #0b0a09; box-shadow: 0 1px 0 rgba(255,255,255,.04) inset, 0 30px 82px rgba(0,0,0,.42), 0 0 70px rgba(255,79,0,.022); transform: translateY(var(--rv-depth-sm)); }
.rv .ct-tour-chrome { display: flex; align-items: center; justify-content: space-between; height: 40px; padding: 0 14px; border-bottom: 1px solid var(--ct-line); color: var(--ct-ghost); font-size: 8px; }
.rv .ct-tour-chrome span:last-child { color: var(--ct-ember); }
.rv .ct-tour-images { position: relative; aspect-ratio: 2940 / 1508; overflow: hidden; }
.rv .ct-tour-image { position: absolute; top: 0; left: 0; width: calc(100% + 14px); max-width: none; height: auto; opacity: 0; transform: scale(1.02); transform-origin: left top; transition: opacity .42s ease; }
.rv .ct-tour-image.active { opacity: 1; animation: rv-tour-camera-a 4.2s cubic-bezier(.22,1,.36,1) both; }
.rv .ct-tour-image:nth-child(even).active { animation-name: rv-tour-camera-b; }
@keyframes rv-tour-camera-a { from { transform: scale(1.025) translate3d(-.35%,.15%,0); } to { transform: scale(1.008) translate3d(.12%,0,0); } }
@keyframes rv-tour-camera-b { from { transform: scale(1.025) translate3d(.35%,-.12%,0); } to { transform: scale(1.008) translate3d(-.12%,0,0); } }
.rv .ct-tour-transition-light { position: absolute; z-index: 5; inset: -22%; pointer-events: none; background: linear-gradient(108deg, transparent 35%, rgba(255,222,201,.12) 49%, rgba(255,79,0,.07) 52%, transparent 66%); mix-blend-mode: screen; transform: translateX(-72%); animation: rv-tour-light .82s cubic-bezier(.22,1,.36,1) both; }
@keyframes rv-tour-light { 0% { opacity: 0; transform: translateX(-72%); } 20% { opacity: .72; } 100% { opacity: 0; transform: translateX(72%); } }
.rv .ct-tour-progress { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; margin-top: 14px; }
.rv .ct-tour-progress span { position: relative; height: 2px; overflow: hidden; background: var(--ct-line); transition: background .25s ease; }
.rv .ct-tour-progress span::after { content: ""; position: absolute; inset: 0; background: var(--ct-ember); transform: scaleX(0); transform-origin: left; }
.rv .ct-tour-progress span.complete { background: rgba(255,138,80,.3); }
.rv .ct-tour-progress span.active::after { animation: rv-tour-progress-in .48s cubic-bezier(.22,1,.36,1) forwards; }
@keyframes rv-tour-progress-in { to { transform: scaleX(1); } }
.rv .ct-tour-steps { min-width: 0; }
.rv .ct-tour-step { position: relative; display: flex; min-height: 52vh; flex-direction: column; justify-content: center; padding: 44px 0 44px 23px; border-top: 1px solid var(--ct-line); opacity: .42; transition: opacity .32s ease; }
.rv .ct-tour-step::before { content: ""; position: absolute; left: 0; top: 44px; bottom: 44px; width: 1px; background: var(--ct-ember); transform: scaleY(0); transform-origin: top; transition: transform .32s cubic-bezier(.22,1,.36,1); }
.rv .ct-tour-step:last-child { border-bottom: 1px solid var(--ct-line); }
.rv .ct-tour-step.active { opacity: 1; }
.rv .ct-tour-step.active::before { transform: scaleY(1); }
.rv .ct-tour-step > p:first-child { margin: 0 0 20px; color: var(--ct-ember); font-size: 9px; }
.rv .ct-tour-step h3 { margin: 0 0 17px; color: var(--ct-text); font-size: clamp(29px,3vw,42px); font-weight: 520; letter-spacing: -.045em; line-height: 1; }
.rv .ct-tour-step > p:nth-of-type(2) { margin: 0; color: var(--ct-dim); font-size: 16px; line-height: 1.58; }
.rv .ct-tour-step ul { display: grid; gap: 9px; margin: 24px 0 0; padding: 0; list-style: none; }
.rv .ct-tour-step li { position: relative; padding-left: 17px; color: var(--ct-faint); font: 10px var(--ct-mono); line-height: 1.45; }
.rv .ct-tour-step li::before { content: ""; position: absolute; left: 0; top: .55em; width: 6px; height: 1px; background: var(--ct-ember); }
.rv .ct-tour-mobile-window { display: none; overflow: hidden; margin-top: 28px; border: 1px solid var(--ct-line); border-radius: 11px; }
.rv .ct-tour-mobile-window img { display: block; width: calc(100% + 10px); max-width: none; height: auto; }

/* Engine steps keep the product promise grounded. */
.rv .rv-method { position: relative; max-width: var(--rv-max); margin: 0 auto; padding: clamp(68px,7vw,88px) var(--rv-edge) clamp(100px,10vw,140px); isolation: isolate; }
.rv .rv-method::before { content: ""; position: absolute; z-index: -1; inset: 0 0 28px; border: 1px solid rgba(242,239,234,.085); border-radius: 27px; background: linear-gradient(155deg, rgba(242,239,234,.027), rgba(242,239,234,.008) 58%, rgba(255,79,0,.012)); box-shadow: 0 1px 0 rgba(255,255,255,.025) inset, 0 36px 90px rgba(0,0,0,.2); transform: translateY(var(--rv-depth-md)); }
.rv .rv-method-head { display: grid; grid-template-columns: .9fr 1.1fr; gap: 52px; align-items: end; margin-bottom: 54px; }
.rv .rv-method-head .rv-kicker { grid-column: 1/-1; margin-bottom: -28px; }
.rv .rv-method-head h2 { max-width: 540px; margin: 0; font-size: clamp(36px,4.2vw,54px); }
.rv .rv-method-head > p:last-child { margin: 0; padding-bottom: 3px; }
.rv .rv-method-track { display: grid; grid-template-columns: repeat(4,1fr); border-top: 1px solid var(--ct-line); }
.rv .rv-method-track article { position: relative; min-height: 214px; padding: 25px 20px 24px 0; border-right: 1px solid var(--ct-line); border-bottom: 1px solid var(--ct-line); background: linear-gradient(180deg, rgba(242,239,234,.012), transparent 62%); transition: background .25s ease, transform .25s cubic-bezier(.22,1,.36,1), box-shadow .25s ease; }
.rv .rv-method-track article:not(:first-child) { padding-left: 20px; }
.rv .rv-method-track article:last-child { border-right: 0; }
.rv .rv-method-track article:hover { z-index: 1; background: rgba(242,239,234,.024); box-shadow: 0 18px 36px rgba(0,0,0,.18); transform: translateY(-4px); }
.rv .rv-method-track article > span { color: var(--ct-ember); font: 9px var(--ct-mono); }
.rv .rv-method-track h3 { margin: 40px 0 10px; color: var(--ct-text); font-size: 23px; font-weight: 520; letter-spacing: -.03em; }
.rv .rv-method-track p { max-width: 210px; margin: 0; color: var(--ct-dim); font-size: 14px; line-height: 1.55; }

/* Trust comes after the mechanics, before asking for a demo click. */
.rv .rv-assurance { position: relative; display: grid; grid-template-columns: minmax(0,.92fr) minmax(0,1.08fr); gap: clamp(50px,7vw,90px); max-width: var(--rv-max); margin: 0 auto; padding: clamp(76px,8vw,104px) var(--rv-edge); isolation: isolate; }
.rv .rv-assurance::before { content: ""; position: absolute; z-index: -1; inset: 12px 0 -12px; border: 1px solid rgba(242,239,234,.075); border-radius: 27px; background: #0c0b0a; box-shadow: 0 1px 0 rgba(255,255,255,.02) inset, 0 34px 85px rgba(0,0,0,.24); transform: translateY(var(--rv-depth-md)); }
.rv .rv-assurance-head h2 { max-width: 520px; font-size: clamp(37px,4vw,51px); }
.rv .rv-assurance-head > p:not(.rv-kicker) { max-width: 480px; margin: 0 0 24px; color: var(--ct-dim); font-size: 17px; line-height: 1.58; }
.rv .rv-text-link { display: inline-flex; align-items: center; gap: 7px; color: var(--ct-text); font-size: 12px; font-weight: 600; }
.rv .rv-text-link:hover { color: var(--ct-ember); }
.rv .rv-assurance-list { border-top: 1px solid var(--ct-line); }
.rv .rv-assurance-list article { display: grid; grid-template-columns: 34px 1fr; gap: 17px; margin: 0 -15px; padding: 24px 15px; border-bottom: 1px solid var(--ct-line); transition: background .22s ease, transform .22s ease; }
.rv .rv-assurance-list article:hover { background: rgba(242,239,234,.018); transform: translateX(4px); }
.rv .rv-assurance-list article > span { padding-top: 3px; color: var(--ct-ember); font: 9px var(--ct-mono); }
.rv .rv-assurance-list h3 { margin: 0 0 7px; color: var(--ct-text); font-size: 18px; font-weight: 520; letter-spacing: -.02em; }
.rv .rv-assurance-list p { margin: 0; color: var(--ct-dim); font-size: 14px; line-height: 1.55; }

/* Open reports, objections and the final action. */
.rv .rv-demos { max-width: var(--rv-max); margin: 0 auto; padding: clamp(135px,15vw,200px) var(--rv-edge); }
.rv .rv-demos-head { max-width: 700px; margin-bottom: 48px; }
.rv .rv-demo-list { overflow: hidden; border: 1px solid rgba(242,239,234,.095); border-radius: 16px; background: rgba(242,239,234,.008); box-shadow: 0 24px 70px rgba(0,0,0,.18); transform: translateY(var(--rv-depth-sm)); }
.rv .rv-demo { position: relative; display: grid; grid-template-columns: 46px minmax(160px,.7fr) minmax(0,1.3fr) 20px; gap: 17px; align-items: center; min-height: 96px; overflow: hidden; padding: 0 18px; border-bottom: 1px solid var(--ct-line); transition: padding .22s ease, background .22s ease, transform .22s ease; }
.rv .rv-demo::before { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(90deg, rgba(255,79,0,.055), rgba(242,239,234,.018) 42%, transparent 76%); opacity: 0; transform: scaleX(.72); transform-origin: left; transition: opacity .24s ease, transform .4s cubic-bezier(.22,1,.36,1); }
.rv .rv-demo > * { position: relative; z-index: 1; }
.rv .rv-demo:last-child { border-bottom: 0; }
.rv .rv-demo:hover, .rv .rv-demo:focus-visible { padding: 0 22px; background: rgba(242,239,234,.022); transform: translateY(-1px); }
.rv .rv-demo:hover::before, .rv .rv-demo:focus-visible::before { opacity: 1; transform: scaleX(1); }
.rv .rv-demo-index { color: var(--ct-ghost); font-size: 9px; }
.rv .rv-demo-repo { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.rv .rv-demo-repo strong { overflow: hidden; color: var(--ct-text); font: 400 13px var(--ct-mono); text-overflow: ellipsis; white-space: nowrap; }
.rv .rv-demo-repo span { color: var(--ct-ghost); font: 10px var(--ct-mono); }
.rv .rv-demo-finding { overflow: hidden; color: var(--ct-dim); font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.rv .rv-demo > svg { color: var(--ct-ghost); transition: color .2s ease, transform .2s ease; }
.rv .rv-demo:hover > svg { color: var(--ct-ember); transform: translate(2px,-2px); }
.rv .rk-faq { max-width: 820px; margin: 0 auto; padding: 0 var(--rv-edge); }
.rv .rk-faq-head { margin-bottom: 34px; }
.rv .rk-faq .rk-h2 { margin: 0; color: var(--ct-text); font-size: clamp(34px,4.2vw,52px); font-weight: 530; letter-spacing: -.05em; line-height: 1; }
.rv .rk-faq-list { border-top: 1px solid var(--ct-line); }
.rv .rk-faq-item { border-bottom: 1px solid var(--ct-line); }
.rv .rk-faq-q { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 2px; color: var(--ct-text); cursor: pointer; font-size: 15px; font-weight: 540; list-style: none; }
.rv .rk-faq-q::-webkit-details-marker { display: none; }
.rv .rk-faq-q:hover { color: var(--ct-ember); }
.rv .rk-faq-icon { flex: none; color: var(--ct-ghost); transition: color .18s ease, transform .18s ease; }
.rv .rk-faq-item[open] .rk-faq-icon { color: var(--ct-ember); transform: rotate(45deg); }
.rv .rk-faq-a { max-width: 650px; padding: 0 37px 23px 2px; color: var(--ct-dim); font-size: 15px; line-height: 1.6; }
.rv .rk-faq-a a { color: var(--ct-text); text-decoration: underline; text-underline-offset: 3px; }
.rv .rv-close { max-width: var(--rv-max); margin: 0 auto; padding: clamp(125px,14vw,185px) var(--rv-edge) clamp(90px,11vw,140px); text-align: center; }
.rv .rv-close-inner { position: relative; overflow: hidden; padding: clamp(72px,8vw,100px) clamp(24px,7vw,90px); border: 1px solid rgba(242,239,234,.13); border-radius: 22px; outline: 1px solid rgba(242,239,234,.04); outline-offset: 10px; background: radial-gradient(ellipse 64% 70% at 50% 112%, rgba(255,79,0,.14), transparent 70%), rgba(242,239,234,.018); box-shadow: 0 1px 0 rgba(255,255,255,.03) inset, 0 42px 110px rgba(0,0,0,.28); transform: translateY(var(--rv-depth-sm)); transition: border-color .3s ease, box-shadow .35s ease, background-color .3s ease; }
.rv .rv-close-inner:hover { border-color: rgba(242,239,234,.19); }
.rv .rv-close-inner:focus-within { border-color: rgba(255,138,80,.34); box-shadow: 0 34px 100px rgba(255,79,0,.08); background-color: rgba(255,79,0,.012); }
.rv .rv-close-inner::before { content: ""; position: absolute; left: 14%; right: 14%; top: -1px; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,138,80,.55), transparent); }
.rv .rv-close h2 { max-width: 780px; margin-right: auto; margin-left: auto; }
.rv .rv-close-inner > p:not(.rv-kicker) { margin: 0 0 32px; color: var(--ct-dim); font-size: 18px; }
.rv .rv-close .rk-intake { max-width: 650px; margin: 0 auto; text-align: left; }
.rv .rv-close-proof { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 26px; margin-top: 26px; color: var(--ct-ghost); font: 9px var(--ct-mono); text-transform: uppercase; letter-spacing: .1em; }
.rv .rv-close-proof span { position: relative; }
.rv .rv-close-proof span:not(:first-child)::before { content: ""; position: absolute; left: -14px; top: 50%; width: 2px; height: 2px; border-radius: 50%; background: var(--ct-ember); }

/* Restrained one-shot reveals; the tour owns the continuous motion. */
.rv [data-rv] { opacity: 0; transform: translateY(18px); transition: opacity .7s ease, transform .7s cubic-bezier(.22,1,.36,1); }
.rv [data-rv].in { opacity: 1; transform: none; }
.rv [data-rv="cascade"] > * { opacity: 0; transform: translateY(14px); transition: opacity .55s ease, transform .55s ease; }
.rv [data-rv="cascade"].in > * { opacity: 1; transform: none; }
.rv [data-rv="cascade"].in > *:nth-child(2) { transition-delay: 70ms; }
.rv [data-rv="cascade"].in > *:nth-child(3) { transition-delay: 140ms; }
.rv [data-rv="cascade"].in > *:nth-child(4) { transition-delay: 210ms; }

@media (prefers-reduced-motion: reduce) {
  .rv [data-rv], .rv [data-rv="cascade"] > *, .rv .ct-tour-step, .rv .rv-product-frame, .rv .rv-hero-product, .rv .rv-proof strong em { opacity: 1; transform: none; transition: none; animation: none; }
  /* The tour images are ABSOLUTELY POSITIONED AND STACKED, so they are the one
     thing here that must NOT be blanket-revealed. '.ct-tour-image' used to sit
     in the list above, which set opacity:1 on all four — the last in DOM order
     then painted over every chapter and the tour showed one frozen, wrong
     screenshot for its whole length.
     Keep the .active gating; remove only the movement. */
  .rv .ct-tour-image { transition: none; animation: none; }
  /* And .active must be named explicitly: it carries two classes to the rule
     above's one, so its 'animation: rv-tour-camera-* 4.2s' outranked the
     blanket 'animation: none' and the Ken Burns pan kept running for anyone
     who asked for no motion. */
  .rv .ct-tour-image.active { opacity: 1; transform: none; animation: none; }
  .rv .rv-product-frame::after, .rv .ct-tour-progress span::after, .rv .ct-tour-transition-light { display: none; animation: none; }
}

@media (max-width: 1000px) {
  .rv .ct-tour { grid-template-columns: minmax(0,1.35fr) minmax(280px,.65fr); gap: 34px; }
  .rv .ct-tour-step { min-height: 48vh; }
}

@media (max-width: 800px) {
  .rv .rv-hero { height: auto; min-height: 980px; padding-bottom: 90px; }
  .rv .rv-proof { grid-template-columns: 1fr 1fr; margin-right: var(--rv-edge); margin-left: var(--rv-edge); }
  .rv .rv-proof > div:nth-child(2) { border-right: 0; }
  .rv .rv-proof > div:nth-child(-n+2) { border-bottom: 1px solid var(--ct-line); }
  .rv .ct-tour { display: block; }
  .rv .ct-tour-visual { display: none; }
  .rv .ct-tour-step { min-height: 0; padding: 65px 0; opacity: 1; }
  .rv .ct-tour-step::before { display: none; }
  .rv .ct-tour-mobile-window { display: block; }
  .rv .rv-method-head { grid-template-columns: 1fr; gap: 12px; }
  .rv .rv-method-head .rv-kicker { grid-column: auto; margin-bottom: 10px; }
  .rv .rv-method-head > p:last-child { margin: 0; }
  .rv .rv-method-track { grid-template-columns: 1fr 1fr; }
  .rv .rv-method-track article:nth-child(2) { border-right: 0; }
  .rv .rv-assurance { grid-template-columns: 1fr; }
}

@media (max-width: 640px) {
  .rk .ct-blast-list { display: none; }
  .rk .ct-blast-graph { display: none; }
  .rk .ct-blast-list { display: block; }
  .rv .rv-hero { min-height: 900px; margin-top: -70px; padding: 138px 10px 72px; }
  .rv .rv-hero-content { padding: 0 10px; }
  .rv .rv-hero h1 { font-size: clamp(49px,13.5vw,67px); }
  .rv .rv-hero-lede { font-size: 17px; }
  .rv .rk-intake form { flex-direction: column; }
  .rv .rk-intake button { width: 100%; }
  .rv .rv-hero-product { width: calc(100vw - 20px); margin-top: 40px; }
  .rv .rv-product-frame { border-radius: 12px; }
  .rv .rv-product-bar { height: 34px; padding: 0 10px; font-size: 7px; }
  .rv .rv-proof { margin-right: 10px; margin-left: 10px; }
  .rv .rv-proof > div { min-height: 88px; padding: 14px; }
  .rv .rv-proof strong { font-size: 16px; }
  .rv .rv-tour-section { padding-right: 20px; padding-left: 20px; }
  .rv .rv-tour-head { margin-bottom: 36px; }
  .rv .rv-tour-head h2, .rv .rv-method-head h2, .rv .rv-assurance-head h2, .rv .rv-demos-head h2, .rv .rv-close h2 { font-size: 40px; }
  .rv .ct-tour-step { padding: 50px 0; }
  .rv .ct-tour-step h3 { font-size: 33px; }
  .rv .rv-method-track article { min-height: 190px; padding: 22px 13px 20px 0; }
  .rv .rv-method-track article:not(:first-child) { padding-left: 13px; }
  .rv .rv-method-track h3 { margin-top: 34px; font-size: 20px; }
  .rv .rv-method-track p { font-size: 12px; }
  .rv .rv-assurance { gap: 55px; padding-right: 20px; padding-left: 20px; }
  .rv .rv-demo { grid-template-columns: 28px minmax(0,1fr) 18px; gap: 10px; padding: 16px 14px; }
  .rv .rv-demo-finding { grid-column: 2/3; grid-row: 2; white-space: normal; }
  .rv .rv-demo > svg { grid-column: 3; grid-row: 1; }
  .rv .rk-faq-q { font-size: 14px; }
  .rv .rv-close { padding-top: 120px; }
  .rv .rv-close-inner { border-radius: 16px; }
  .rv .rv-close-proof { gap: 9px 18px; }
  .rv .rv-close-proof span:not(:first-child)::before { left: -10px; }
}
`;
