"use client";

// CTSweepTheater — the hero artifact, staged. Replaces the static sample
// panel with a choreographed sweep that auto-plays once when scrolled into
// view: the repo types itself into the header → four channels scan → the
// findings stream in stdout-style → the grade STAMPS in and the lens bars
// draw. A replay control re-runs it.
//
// Honesty guard carried over from the audit: the data is clearly a demo
// (small "demo" chip in the head, fictional fallback repo, no fabricated
// advisory ids) — the theatrical framing itself also reads as a demo, which
// is the point. Every detector name, scoping nuance, and signal id still
// maps to the real product. prefers-reduced-motion renders the finished
// state with no animation.
//
// The header live-mirrors the intake field above (normalized), so typing a
// repo fuses the core interaction and the artifact into one narrative.

import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeRepo } from "./CTIntake";

const DEMO_REPO = "acme/checkout-api";

interface Row {
  k: string;
  v: string;
  sig: string;
  burn?: boolean;
}

const ROWS: Row[] = [
  { k: "resolve", v: "origin ok · default branch main · blobless clone 2.1s", sig: "" },
  { k: "history", v: "58,712 commits · 3,104 authors · cadence steady", sig: "sig:history.cadence" },
  // orange slot 3 — the one burning finding on the page
  { k: "hotspots", v: "churn×complexity → src/server/render.tsx · 94th pct", sig: "sig:hotspot.churn_complexity", burn: true },
  { k: "bus-factor", v: "3 paths >80% single-author — flagged", sig: "sig:history.bus_factor" },
  { k: "structure", v: "tree-sitter: 2,148 files · 3 languages · call graph 41,330 edges", sig: "sig:structure.call_graph" },
  { k: "imports", v: "1,284 modules · max depth 7 · 2 cycles", sig: "sig:structure.import_cycles" },
  { k: "supply", v: "1,204 deps resolved · 1 high advisory (dev-only)", sig: "sig:deps.advisory" },
  { k: "freshness", v: "4 deprecated · 19 outdated majors (runtime: 6)", sig: "sig:deps.freshness" },
  { k: "secrets", v: "0 found · 2 test-fixture matches (downscored)", sig: "sig:security.secrets" },
  { k: "dyn-exec", v: "1 pattern · eval in build script (reviewed)", sig: "sig:security.dynamic_exec" },
];

const CHANNELS = ["history", "structure", "security", "supply"];

const LENSES: { name: string; score: number }[] = [
  { name: "history", score: 78 },
  { name: "structure", score: 84 },
  { name: "security", score: 91 },
  { name: "supply chain", score: 75 },
];
// 78+84+91+75 = 328 / 4 = 82.0 — the foot's 82/100 must reconcile.

type Phase = "idle" | "typing" | "scan" | "log" | "verdict";

export function CTSweepTheater({ repo }: { repo: string }) {
  const userRepo = normalizeRepo(repo);
  const [phase, setPhase] = useState<Phase>("idle");
  const [typed, setTyped] = useState("");
  const started = useRef(false);
  const timers = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  }, []);

  const play = useCallback(() => {
    clearTimers();
    setTyped("");
    setPhase("typing");
    for (let i = 1; i <= DEMO_REPO.length; i++) {
      timers.current.push(
        window.setTimeout(() => setTyped(DEMO_REPO.slice(0, i)), 38 * i)
      );
    }
    const tTyped = 38 * DEMO_REPO.length + 320;
    timers.current.push(window.setTimeout(() => setPhase("scan"), tTyped));
    timers.current.push(window.setTimeout(() => setPhase("log"), tTyped + 1250));
    timers.current.push(
      window.setTimeout(
        () => setPhase("verdict"),
        tTyped + 1250 + ROWS.length * 90 + 420
      )
    );
  }, [clearTimers]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      started.current = true;
      setTyped(DEMO_REPO);
      setPhase("verdict");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !started.current) {
          started.current = true;
          io.disconnect();
          play();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimers();
    };
  }, [play, clearTimers]);

  const shownRepo = userRepo || typed;
  const scanOn = phase === "scan" || phase === "log" || phase === "verdict";
  const showLog = phase === "log" || phase === "verdict";
  const verdictOn = phase === "verdict";

  return (
    <div
      ref={rootRef}
      className={`survey${scanOn ? " on-scan" : ""}${verdictOn ? " on-verdict" : ""}`}
      role="group"
      aria-label="Demo: a sweep running on a sample repository"
    >
      <div className="survey-head">
        <span className="repo">
          sweep — github.com/{shownRepo}
          {phase === "typing" && <span className="th-caret" aria-hidden />}
          {scanOn && " @ 8f3c21d"}
        </span>
        <span className="th-right">
          <span className="th-chip">demo</span>
          <button type="button" className="th-replay" onClick={play}>
            replay
          </button>
        </span>
      </div>

      <div className="channels" aria-hidden>
        {CHANNELS.map((c, i) => (
          <span className="channel" key={c} style={{ "--ci": i } as React.CSSProperties}>
            {c}
            <span className="track">
              <span className="fill" />
            </span>
          </span>
        ))}
      </div>

      <div className="survey-body" tabIndex={0} role="region" aria-label="Sweep log">
        {showLog && (
          <ol className="log" role="list">
            {ROWS.map((r, i) => (
              <li
                key={r.k}
                className={r.burn ? "log-row burn" : "log-row"}
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className="k">{r.k}</span>
                <span className="v">{r.v}</span>
                <span className="sig">{r.sig}</span>
              </li>
            ))}
          </ol>
        )}
        <hr className="log-rule" />
        <div className="grade">
          <span className="grade-mark">B+</span>
          <div className="grade-bars">
            {LENSES.map((l) => (
              <div className="grade-bar" key={l.name}>
                <span>{l.name}</span>
                <span className="track">
                  <span
                    className="fill"
                    style={{ width: verdictOn ? `${l.score}%` : 0 }}
                  />
                </span>
                <span className="num">{verdictOn ? l.score : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="survey-foot">
        surface grade B+ · 82/100 · full survey ready — 41.3s · deterministic:
        same input, same survey
      </div>
    </div>
  );
}
