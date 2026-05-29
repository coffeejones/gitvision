// The verdict, in full — per-department breakdown + Exhibit A, a
// professional dependency diagram: tiered top-down layout, aligned
// columns, React-Flow-style smoothstep edges, typed node cards, layer
// rails on the left, and a docked inspector panel for the flagged
// module (mirrors selecting a node in a real graph tool).

import { Reveal } from "../Reveal";

type Row = { name: string; val: number; color: string };
const ROWS: Row[] = [
  { name: "Health", val: 64, color: "var(--caution)" },
  { name: "Security", val: 91, color: "var(--cleared)" },
  { name: "Forensics", val: 48, color: "var(--flagged)" },
  { name: "Supply", val: 88, color: "var(--cleared)" },
];

const MONO = "'Spline Sans Mono',ui-monospace,monospace";
const NEUTRAL = "#5f6672";

type Node = { id: string; x: number; y: number; label: string; kind: string; accent: string; flagged?: boolean };
const NODES: Node[] = [
  { id: "app", x: 262, y: 72, label: "app.ts", kind: "ENTRY", accent: "#c9a227" },
  { id: "router", x: 262, y: 152, label: "router", kind: "ROUTE", accent: NEUTRAL },
  { id: "payments", x: 140, y: 232, label: "payments", kind: "SERVICE", accent: NEUTRAL },
  { id: "auth", x: 262, y: 232, label: "auth/session", kind: "SERVICE", accent: "#e5484d", flagged: true },
  { id: "users", x: 384, y: 232, label: "users", kind: "SERVICE", accent: NEUTRAL },
  { id: "crypto", x: 140, y: 312, label: "crypto", kind: "UTIL", accent: NEUTRAL },
  { id: "db", x: 262, y: 312, label: "db/pool", kind: "STORE", accent: NEUTRAL },
  { id: "cache", x: 384, y: 312, label: "cache", kind: "STORE", accent: NEUTRAL },
];

// Smoothstep-style edges: leave the source going down, arrive at the
// target going down — the recognizable "engineered DAG" look.
const EDGES: string[] = [
  "M262 92 V132",
  "M262 172 C262 198 140 186 140 212",
  "M262 172 V212",
  "M262 172 C262 198 384 186 384 212",
  "M140 252 V292",
  "M140 252 C140 278 262 266 262 292",
  "M262 252 V292",
  "M262 252 C262 278 140 266 140 292",
  "M384 252 V292",
  "M384 252 C384 278 262 266 262 292",
];

const LAYERS: { label: string; y: number }[] = [
  { label: "entry", y: 75 },
  { label: "routes", y: 155 },
  { label: "domain", y: 235 },
  { label: "data", y: 315 },
];

const METRICS: { k: string; v: string; bad?: boolean }[] = [
  { k: "Bus factor", v: "1", bad: true },
  { k: "Tests", v: "0", bad: true },
  { k: "Commits", v: "62" },
  { k: "Authors", v: "1" },
];

export function VerdictFull() {
  return (
    <section className="section-pad spot" id="verdict">
      <div className="wrap">
        <Reveal className="sec-head">
          <span className="eyebrow">The verdict, in full · how the score is built</span>
          <h2 className="display">
            A score you can
            <br />
            take into the room.
          </h2>
          <p className="lede">
            Every point is traceable to a department and an exhibit. No black box — open any line and see the
            evidence.
          </p>
        </Reveal>

        <Reveal className="verdict-full">
          <div className="breakdown">
            {ROWS.map((r) => (
              <div className="bd-row" key={r.name}>
                <span className="name">{r.name}</span>
                <span className="bar">
                  <i style={{ width: `${r.val}%`, background: r.color }} />
                </span>
                <span className="val">{r.val}</span>
              </div>
            ))}
            <div className="bd-row" style={{ marginTop: 8, borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <span className="name" style={{ color: "var(--bone)" }}>
                Verdict
              </span>
              <span className="bar">
                <i style={{ width: "72%", background: "linear-gradient(90deg,#d29a31,#c9a227)" }} />
              </span>
              <span className="val" style={{ color: "var(--brass-lt)" }}>
                72
              </span>
            </div>
          </div>

          <div className="exhibit">
            <span className="ex-label">Exhibit A · sample dependency graph</span>
            <span className="ex-tag">Sample exhibit · 8 modules</span>
            <div className="ex-canvas">
              <svg viewBox="0 0 640 400" role="img" aria-label="Dependency graph — auth/session flagged: bus factor 1, 0 tests">
                <defs>
                  <marker id="rjarr" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill="rgba(233,229,216,.34)" />
                  </marker>
                </defs>

                {/* layer rails */}
                <g fontFamily={MONO} fontSize={9} letterSpacing="1" fill="#5c5950">
                  {LAYERS.map((l) => (
                    <text key={l.label} x={14} y={l.y}>
                      {l.label.toUpperCase()}
                    </text>
                  ))}
                </g>

                {/* edges */}
                <g fill="none" stroke="rgba(233,229,216,.16)" strokeWidth={1.4} markerEnd="url(#rjarr)">
                  {EDGES.map((d, i) => (
                    <path key={i} d={d} />
                  ))}
                </g>

                {/* nodes */}
                <g>
                  {NODES.map((n) => (
                    <g key={n.id}>
                      {n.flagged && (
                        <rect
                          x={n.x - 57}
                          y={n.y - 25}
                          width={114}
                          height={50}
                          rx={11}
                          fill="none"
                          stroke="rgba(229,72,77,.3)"
                          strokeDasharray="3 3"
                        />
                      )}
                      <rect
                        x={n.x - 52}
                        y={n.y - 20}
                        width={104}
                        height={40}
                        rx={8}
                        fill="#0c0f15"
                        stroke={n.flagged ? "rgba(229,72,77,.55)" : "rgba(233,229,216,.14)"}
                      />
                      <rect x={n.x - 46} y={n.y - 13} width={3} height={26} rx={1.5} fill={n.accent} />
                      <text x={n.x - 38} y={n.y - 2} fontFamily={MONO} fontSize={11.5} fill="#d6d1c4">
                        {n.label}
                      </text>
                      <text x={n.x - 38} y={n.y + 11} fontFamily={MONO} fontSize={8} letterSpacing="1" fill={n.flagged ? "#c77" : "#75726a"}>
                        {n.kind}
                      </text>
                    </g>
                  ))}
                </g>

                {/* inspector panel — the "selected node" detail view */}
                <g>
                  <rect x={458} y={60} width={170} height={276} rx={10} fill="#0a0c11" stroke="rgba(233,229,216,.1)" />
                  <text x={474} y={82} fontFamily={MONO} fontSize={9} letterSpacing="1.5" fill="#75726a">
                    INSPECTOR
                  </text>
                  <line x1={470} y1={94} x2={616} y2={94} stroke="rgba(233,229,216,.08)" />
                  <text x={474} y={120} fontFamily={MONO} fontSize={12.5} fill="#f0b3b5">
                    auth/session.ts
                  </text>
                  <rect x={474} y={130} width={62} height={18} rx={3} fill="rgba(229,72,77,.12)" stroke="rgba(229,72,77,.45)" />
                  <text x={505} y={143} textAnchor="middle" fontFamily={MONO} fontSize={9} letterSpacing="1" fill="#f0b3b5">
                    FLAGGED
                  </text>
                  <g fontFamily={MONO} fontSize={11}>
                    {METRICS.map((m, i) => {
                      const y = 178 + i * 26;
                      return (
                        <g key={m.k}>
                          <text x={474} y={y} fill="#75726a">
                            {m.k}
                          </text>
                          <text x={612} y={y} textAnchor="end" fill={m.bad ? "#f0b3b5" : "#c9c4b6"}>
                            {m.v}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                  <line x1={470} y1={296} x2={616} y2={296} stroke="rgba(233,229,216,.08)" />
                  <text x={474} y={318} fontFamily={MONO} fontSize={9} letterSpacing=".5" fill="#5c5950">
                    1 finding · forensics-021
                  </text>
                </g>

                {/* legend */}
                <g fontFamily={MONO} fontSize={10}>
                  <rect x={16} y={366} width={9} height={9} rx={2} fill="#c9a227" />
                  <text x={30} y={374} fill="#75726a">entry</text>
                  <rect x={86} y={366} width={9} height={9} rx={2} fill={NEUTRAL} />
                  <text x={100} y={374} fill="#75726a">module</text>
                  <rect x={170} y={366} width={9} height={9} rx={2} fill="#e5484d" />
                  <text x={184} y={374} fill="#75726a">flagged</text>
                </g>
              </svg>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
