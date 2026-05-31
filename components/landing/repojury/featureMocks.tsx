// Hand-built feature mockups in the dossier palette (paper / brass /
// mono / noir), shared by the Investigation section (V1 landing) and
// the consolidated Process section (V2). They evoke real workspace
// panels — blast radius, signal evidence, security scanners — while
// belonging to the page, the same way Exhibit A (the dependency graph)
// does. No screenshots; drawn in the page's own colours.

export function BlastRadiusMock() {
  const incoming = [
    "routes/login.ts",
    "middleware/require-auth.ts",
    "api/users/[id].ts",
    "lib/session-cookie.ts",
    "tests/auth.e2e.ts",
  ];
  const outgoing = ["lib/crypto/sign.ts", "db/pool.ts", "config/env.ts"];
  return (
    <div className="fm">
      <div className="fm-head">
        <span className="fm-eyebrow">Blast radius for</span>
        <span className="fm-file">auth/session.ts</span>
        <span className="fm-tag">complexity 58</span>
      </div>
      <div className="fm-cols">
        <div className="fm-col">
          <div className="fm-col-head">
            Incoming — what breaks <b>41</b>
          </div>
          <ul>
            {incoming.map((p) => (
              <li key={p}>
                <span className="fm-warn" /> {p}
              </li>
            ))}
            <li className="fm-more">+36 more</li>
          </ul>
        </div>
        <div className="fm-col">
          <div className="fm-col-head">
            Outgoing — depends on <b>12</b>
          </div>
          <ul>
            {outgoing.map((p) => (
              <li key={p}>
                <span className="fm-dot" /> {p}
              </li>
            ))}
            <li className="fm-more">+9 more</li>
          </ul>
        </div>
      </div>
      <div className="fm-legend">
        <span>
          <span className="fm-warn" /> breaks if changed
        </span>
        <span>
          <span className="fm-dot" /> this file relies on
        </span>
      </div>
    </div>
  );
}

export function SignalsMock() {
  return (
    <div className="fm">
      <div className="fm-head">
        <span className="fm-eyebrow">Signals · needs work</span>
        <span className="fm-tag">20 deterministic</span>
      </div>
      <div className="fm-signal">
        <div className="fm-signal-top">
          <b>Tightly-coupled modules</b>
          <span className="fm-badge high">High</span>
        </div>
        <div className="fm-paths">
          auth/session.ts · payments/ledger.ts · users/store.ts
        </div>
      </div>
      <div className="fm-signal">
        <div className="fm-signal-top">
          <b>Untested hotspots</b>
          <span className="fm-badge med">Med</span>
        </div>
        <div className="fm-paths">ledger.ts — 1,240 LOC · cyclomatic 58 · 0 tests</div>
      </div>
      <div className="fm-signal">
        <div className="fm-signal-top">
          <b>Bus factor</b>
          <span className="fm-badge med">Med</span>
        </div>
        <div className="fm-paths">auth/ — 62 commits · 1 author</div>
      </div>
    </div>
  );
}

export function SecurityMock() {
  const rows: {
    name: string;
    sub: string;
    state: "ok" | "warn";
    label: string;
  }[] = [
    { name: "Incidents", sub: "10 curated supply-chain attacks", state: "ok", label: "Clear" },
    { name: "Secrets", sub: "regex scan of source + config", state: "ok", label: "Clear" },
    { name: "Patterns", sub: "eval / new Function / exec", state: "warn", label: "1 noted" },
  ];
  return (
    <div className="fm">
      <div className="fm-head">
        <span className="fm-eyebrow">Security · 3 scanners</span>
        <span className="fm-tag">deterministic</span>
      </div>
      {rows.map((r) => (
        <div className="fm-scan" key={r.name}>
          <div className="fm-scan-name">
            <b>{r.name}</b>
            <span>{r.sub}</span>
          </div>
          <span className={`fm-badge ${r.state}`}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}
