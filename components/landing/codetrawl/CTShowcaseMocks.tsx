// CTShowcaseMocks — faithful, static recreations of six real CodeTrawl
// workspace views, rebuilt in the landing's design language (bitumen +
// hairlines, NO new orange — severity is encoded by TONE: brightest text =
// flagged/high, dim = neutral, faint = quiet/clean). Data is real, pulled
// from the flask survey (pallets/flask) we already have on disk; the layouts
// mirror the actual components mapped in components/views/*. The Security
// view shows a representative populated state (the agreed divergence from the
// flask spine) to demonstrate what the scanners catch.
//
// These are presentational only — no state, no hooks. The orchestrator
// (CTShowcase) owns selection and framing.

import type { ReactNode } from "react";

/* ── 1 · HEALTH SCORING ─────────────────────────────────────────────────
   Mirrors VerdictHero + DepartmentRulingCard. A representative B+ /
   Conditional (two departments clear, two attach conditions) — richer and
   more honest than an all-green brag. */

const DEPARTMENTS: {
  name: string;
  vote: "Cleared" | "Conditional";
  reason: string;
  signals: string;
}[] = [
  {
    name: "Health Department",
    vote: "Cleared",
    reason: "Test coverage and churn sit within a healthy range.",
    signals: "6 signals considered",
  },
  {
    name: "Security Bureau",
    vote: "Cleared",
    reason: "Passed all three security scanners.",
    signals: "3 signals considered",
  },
  {
    name: "Forensics Lab",
    vote: "Conditional",
    reason: "flask/app.py concentrates churn across few authors.",
    signals: "2 of 3 signals flagged",
  },
  {
    name: "Supply Office",
    vote: "Conditional",
    reason: "3 of 24 dependencies carry known CVEs.",
    signals: "3 of 7 signals flagged",
  },
];

// 2 cleared (25 each) + 2 conditional (15 each) = 80 raw, capped at 89 for a
// conditional outcome → 80. The real vote engine only emits 5-point steps, so
// 80 — not 82 — is the value computeVerdict() would return; B+ either way.
const SCORE = 80;
// Department footers above are bounded by each department's fixed signal
// mandate (health 11, security 3, forensics 3, supply 7) — never the
// dependency count. The "24 dependencies" figure lives in the reason only.
const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

export function HealthScoringMock() {
  return (
    <div className="scm scm-health" role="img" aria-label="Health scoring: surface grade B-plus, conditional approval, with four department rulings.">
      <div className="scm-verdict">
        <svg className="scm-ring" viewBox="0 0 120 120" aria-hidden>
          <circle cx="60" cy="60" r={RING_R} className="scm-ring-track" />
          <circle
            cx="60"
            cy="60"
            r={RING_R}
            className="scm-ring-arc"
            strokeDasharray={RING_C}
            strokeDashoffset={RING_C * (1 - SCORE / 100)}
            transform="rotate(-90 60 60)"
          />
          <text x="60" y="58" className="scm-grade">B+</text>
          <text x="60" y="76" className="scm-score">{SCORE}/100</text>
        </svg>
        <div className="scm-verdict-copy">
          <span className="sc-eyebrow">Final verdict</span>
          <p className="scm-outcome sc-hi">Conditional approval</p>
          <p className="scm-micro sc-lo">Approved with conditions attached</p>
          <p className="scm-summary sc-mid">
            Two departments cleared this codebase; two attached conditions
            before approval.
          </p>
        </div>
      </div>
      <div className="scm-depts">
        {DEPARTMENTS.map((d) => (
          <div className="scm-dept" key={d.name}>
            <div className="scm-dept-head">
              <span className="sc-eyebrow">{d.name}</span>
              <span
                className={`sc-tag ${d.vote === "Conditional" ? "sc-hi" : "sc-lo"}`}
              >
                {d.vote}
              </span>
            </div>
            <p className="scm-dept-reason sc-mid">{d.reason}</p>
            <span className="scm-dept-foot sc-quiet">{d.signals}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 2 · BLAST RADIUS ───────────────────────────────────────────────────
   Mirrors FunctionBlastRadiusView (CodePanel) for a function target. The data
   is the REAL resolved call graph of Flask.process_response from the flask
   survey: one caller (finalize_request) and four callees, all direct (hop 1).
   flask's source is laid out flat under src/flask/, so no hop-1 dependency
   crosses a directory boundary — hence no cross-module flag here (the feature
   only fires when one genuinely does). */

type BlastEntry = { fn: string; container?: string; path: string; hop: 1 | 2 | 3; cross?: boolean };

const INCOMING: BlastEntry[] = [
  { fn: "finalize_request", container: "Flask", path: "src/flask/app.py", hop: 1 },
];
const OUTGOING: BlastEntry[] = [
  { fn: "ensure_sync", container: "Flask", path: "src/flask/app.py", hop: 1 },
  { fn: "_get_session", path: "src/flask/ctx.py", hop: 1 },
  { fn: "is_null_session", container: "SessionInterface", path: "src/flask/sessions.py", hop: 1 },
  { fn: "save_session", container: "SessionInterface", path: "src/flask/sessions.py", hop: 1 },
];

function hopTone(hop: number) {
  return hop === 1 ? "sc-hi" : hop === 2 ? "sc-mid" : "sc-lo";
}

function BlastColumn({
  title,
  gloss,
  hops,
  entries,
}: {
  title: string;
  gloss: string;
  hops: string;
  entries: BlastEntry[];
}) {
  return (
    <div className="scm-col">
      <div className="scm-col-head">
        <span className="scm-col-title sc-mid">{title}</span>
        <span className="scm-col-gloss sc-quiet">{gloss}</span>
      </div>
      <div className="scm-hops sc-quiet">{hops}</div>
      <ul className="scm-rows">
        {entries.map((e, i) => (
          <li className="scm-row" key={i}>
            <span className={`scm-hop sc-tag ${hopTone(e.hop)}`}>{e.hop}</span>
            <span className="scm-row-main">
              <span className="scm-fn sc-mid">
                {e.fn}
                {e.container ? <span className="scm-ctr sc-quiet"> · {e.container}</span> : null}
              </span>
              <span className="scm-path sc-quiet">{e.path}</span>
            </span>
            {e.cross ? <span className="scm-xmod sc-lo">cross-module</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BlastRadiusMock() {
  return (
    <div className="scm scm-blast" role="img" aria-label="Blast radius for Flask.process_response: one caller, four callees, all direct.">
      <div className="scm-target">
        <span className="sc-eyebrow">Touch with care</span>
        <p className="scm-target-id">
          <span className="sc-hi">Flask.process_response</span>
          <span className="scm-path sc-quiet"> · src/flask/app.py · complexity 6</span>
        </p>
      </div>
      <div className="scm-cols">
        <BlastColumn
          title="Callers"
          gloss="functions that call this"
          hops="hop 1: 1"
          entries={INCOMING}
        />
        <BlastColumn
          title="Callees"
          gloss="functions this calls"
          hops="hop 1: 4"
          entries={OUTGOING}
        />
      </div>
    </div>
  );
}

/* ── 3 · SECURITY ───────────────────────────────────────────────────────
   Mirrors SecurityPanel: a 3-scanner status grid + a severity-sorted
   findings list. Representative populated state. */

const SCANNERS: { name: string; state: string; flagged: boolean; scope: string }[] = [
  { name: "Incidents", state: "Clean", flagged: false, scope: "dependencies vs known-incident record" },
  { name: "Secrets", state: "1", flagged: true, scope: "regex pass · low-confidence filtered" },
  { name: "Patterns", state: "2", flagged: true, scope: "dynamic execution in source" },
];

// rule = the human label the real FindingsList renders (patternLabel for
// secrets, patternName for patterns) — not the internal id. AWS keys are
// "critical" in the scanner registry, the tier the real UI shows.
const FINDINGS: { sev: "critical" | "info"; kind: string; loc: string; rule: string; detail: string }[] = [
  { sev: "critical", kind: "secret", loc: "config/settings.py:14", rule: "AWS Access Key ID", detail: "AKIA…M4QF" },
  { sev: "info", kind: "pattern", loc: "tasks/runner.py:88", rule: "eval() call", detail: "eval(expr)" },
  { sev: "info", kind: "pattern", loc: "app/loader.py:120", rule: "exec() call", detail: "exec(code, ns)" },
];

export function SecurityMock() {
  return (
    <div className="scm scm-sec" role="img" aria-label="Security: incidents clean, one secret and two risky patterns found, sorted by severity.">
      <div className="scm-grid scm-grid-3">
        {SCANNERS.map((s) => (
          <div className="scm-tile" key={s.name}>
            <span className="scm-tile-label sc-quiet">{s.name}</span>
            <span className={`scm-tile-count ${s.flagged ? "sc-hi" : "sc-lo"}`}>
              {s.state}
            </span>
            <span className="scm-tile-scope sc-quiet">{s.scope}</span>
          </div>
        ))}
      </div>
      <div className="scm-find-head">
        <span className="sc-eyebrow">Findings</span>
        <span className="sc-quiet">sorted by severity</span>
      </div>
      <ul className="scm-findings">
        {FINDINGS.map((f, i) => (
          <li className="scm-find" key={i}>
            <span className={`sc-tag scm-find-sev ${f.sev === "critical" ? "sc-hi" : "sc-lo"}`}>
              {f.sev}
            </span>
            <span className="sc-tag scm-find-kind sc-quiet">{f.kind}</span>
            <span className="scm-find-main">
              <span className="scm-find-loc sc-mid">
                {f.loc}
                <span className="scm-find-rule sc-quiet"> · {f.rule}</span>
              </span>
              <span className="scm-find-detail sc-quiet">{f.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── 4 · DUPLICATED CODE ─────────────────────────────────────────────────
   Mirrors NearDuplicatesPanel (CodePanel) — AST-body-hash clone detection.
   Real data from our OWN repo (coffeejones/gitvision): flask has zero
   duplicate groups, so this tab dogfoods. `lookupVariableType` is copy-pasted
   verbatim across five language plugins — a textbook "extract a helper". The
   worst group renders expanded, the rest collapsed, like the real default. */

interface DupMember {
  file: string;
  cx: number;
}
interface DupGroup {
  name: string;
  size: number;
  cx: number;
  file: string;
  open?: boolean;
  members?: DupMember[];
}

const DUP_GROUPS: DupGroup[] = [
  {
    name: "lookupVariableType",
    size: 5,
    cx: 5,
    file: "lib/codeAnalysis/plugins/csharp.ts",
    open: true,
    members: [
      { file: "lib/codeAnalysis/plugins/csharp.ts", cx: 5 },
      { file: "lib/codeAnalysis/plugins/java.ts", cx: 5 },
      { file: "lib/codeAnalysis/plugins/javascript.ts", cx: 5 },
      { file: "lib/codeAnalysis/plugins/php.ts", cx: 5 },
      { file: "lib/codeAnalysis/plugins/python.ts", cx: 5 },
    ],
  },
  { name: "splitTopLevel", size: 2, cx: 8, file: "lib/intelligence/classCanvas.ts" },
  { name: "generate", size: 2, cx: 6, file: "components/AiSummaryPanel.tsx" },
  { name: "onListKey", size: 2, cx: 5, file: "components/CommandPalette.tsx" },
];

export function DuplicatedCodeMock() {
  return (
    <div
      className="scm scm-dup"
      role="img"
      aria-label="Near-duplicate functions: six groups, fifteen functions, largest group five copies. lookupVariableType is duplicated across five language plugins."
    >
      <div className="scdup-head">
        <span className="sc-eyebrow">Near-duplicate functions</span>
        <span className="scdup-gloss sc-lo">
          structurally identical bodies — candidates for extraction
        </span>
        <span className="scdup-stats sc-lo">6 groups · 15 fns · largest ×5</span>
      </div>
      <ul className="scdup-list">
        {DUP_GROUPS.map((g) => (
          <li className="scdup-group" key={g.name}>
            <div className="scdup-grow">
              <span className="scdup-cx sc-mid">{g.cx}</span>
              <span className="sc-tag scdup-x sc-hi">×{g.size}</span>
              <span className="scdup-id">
                <span className="scdup-idline">
                  <span className="sc-mid">{g.name}</span>
                  {g.size > 1 ? <span className="sc-quiet"> + {g.size - 1} more</span> : null}
                </span>
                <span className="scdup-file sc-quiet">{g.file}</span>
              </span>
              <span className="scdup-chev sc-quiet" aria-hidden>
                {g.open ? "▾" : "▸"}
              </span>
            </div>
            {g.open && g.members ? (
              <ul className="scdup-members">
                {g.members.map((m) => (
                  <li className="scdup-mem" key={m.file}>
                    <span className="scdup-cx sc-quiet">{m.cx}</span>
                    <span className="scdup-mem-file sc-lo">{m.file}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="scdup-more sc-quiet">+2 more groups</p>
    </div>
  );
}

/* ── 6 · PACKAGES ───────────────────────────────────────────────────────
   Mirrors PackagesPanel. Real flask PyPI survey: 24 unique deps, 3
   vulnerable, 21 outdated, 0 deprecated. */

const PKG_STATS: { label: string; count: string; flagged: boolean }[] = [
  { label: "Packages", count: "24", flagged: false },
  { label: "Vulnerable", count: "3", flagged: true },
  { label: "Outdated", count: "21", flagged: false },
  { label: "Deprecated", count: "0", flagged: false },
];

// Vulnerable rows carry no "latest" in the survey (advisories pin the
// affected range, not an upgrade target), so the real VulnerableRow shows the
// current version + CVE chips — no version arrow. CVE counts are real: jinja2
// and werkzeug each carry 5 advisories, flask 1.
const VULNERABLE: { name: string; cur: string; advisory: string }[] = [
  { name: "jinja2", cur: "3.1.2", advisory: "GHSA-cpwx-vrp4-4pq7 +4" },
  { name: "werkzeug", cur: "2.3.3", advisory: "GHSA-29vq-49wr-vm6x +4" },
  { name: "flask", cur: "2.3.2", advisory: "GHSA-68rp-wp8r-4726" },
];

const OUTDATED: { name: string; cur: string; latest: string; age: string }[] = [
  { name: "click", cur: "8.1.3", latest: "8.4.0", age: "49m behind" },
  { name: "celery", cur: "5.2.7", latest: "5.6.3", age: "47m behind" },
];

function Version({ cur, latest }: { cur: string; latest: string }) {
  return (
    <span className="scm-ver">
      <span className="sc-quiet">{cur}</span>
      <span className="scm-ver-arr sc-quiet"> → </span>
      <span className="sc-mid">{latest}</span>
    </span>
  );
}

export function PackagesMock() {
  return (
    <div className="scm scm-packages" role="img" aria-label="Dependency health: 24 PyPI packages, three vulnerable, twenty-one outdated.">
      <div className="scm-grid scm-grid-4">
        {PKG_STATS.map((s) => (
          <div className="scm-tile" key={s.label}>
            <span className={`scm-tile-count ${s.flagged ? "sc-hi" : "sc-mid"}`}>{s.count}</span>
            <span className="scm-tile-label sc-quiet">{s.label}</span>
          </div>
        ))}
      </div>
      <div className="scm-eco-head">
        <span className="sc-mid">PyPI</span>
        <span className="sc-quiet"> · 24 packages · 5 manifests</span>
      </div>
      <ul className="scm-pkg-list">
        <li className="scm-pkg-group sc-quiet">Vulnerable</li>
        {VULNERABLE.map((p) => (
          <li className="scm-pkg" key={p.name}>
            <span className="scm-pkg-name sc-mid">{p.name}</span>
            <span className="scm-ver sc-quiet">{p.cur}</span>
            <span className="sc-tag scm-pkg-badge sc-hi">{p.advisory}</span>
          </li>
        ))}
        <li className="scm-pkg-group sc-quiet">Outdated</li>
        {OUTDATED.map((p) => (
          <li className="scm-pkg" key={p.name}>
            <span className="scm-pkg-name sc-mid">{p.name}</span>
            <Version cur={p.cur} latest={p.latest} />
            <span className="sc-tag scm-pkg-badge sc-lo">{p.age}</span>
          </li>
        ))}
        <li className="scm-pkg-more sc-quiet">+19 more outdated</li>
      </ul>
    </div>
  );
}

export type ShowcaseMock = () => ReactNode;
