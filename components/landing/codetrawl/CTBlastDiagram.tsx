// The Faultline blast, drawn rather than photographed.
//
// Inline SVG, not React Flow. The product's canvas is a client component that
// pulls the whole library in for pan-and-zoom the landing has no use for; this
// needs the picture only, so it ships as markup with zero JavaScript, stays
// crisp at any density, and scales by viewBox the way the real canvas scales by
// fitView.
//
// GEOMETRY AND COLOUR ARE THE CANVAS'S OWN, not an impression of them: the
// column pitch, row pitch, rows-per-column and card size below are
// FaultlineBlastCanvas's constants, and the palette is CH — rose #ff4f00 for
// the epicenter, the same 4px inset stripe and soft wash on an untested
// casualty, neutral surface for a covered one. lib/__tests__/landingBlast.test
// fails when they drift apart.
//
// The one deliberate difference: the real canvas lets a casualty click through
// to the Source view. There is nothing to click through to from a landing page,
// so these are inert — the picture, not the tool.

import { LANDING_BLAST, blastCounts } from "@/lib/landingBlast";

/** From components/views/FaultlineBlastCanvas.tsx. */
const COL_W = 250;
const ROW_H = 86;
const ROWS_PER_COL = 6;
const CARD_W = 208;
const CARD_H = 56;
const EPI_W = 190;

/** CH — components/chambers/theme.ts. */
const ROSE = "#ff4f00";
const ROSE_SOFT = "rgba(255,79,0,0.13)";
const SURFACE = "#171615";
const BG = "#0c0b0b";
const BORDER = "rgba(255,255,255,0.08)";
const TEXT = "#eceae8";
const MUTED = "#8a8783";

const split = (p: string) => {
  const i = p.lastIndexOf("/");
  return { base: i < 0 ? p : p.slice(i + 1), dir: i < 0 ? "" : p.slice(0, i + 1) };
};

/** Trim a directory to its tail so a long app-router path still reads. The real
 *  canvas ellipsises with CSS; SVG text cannot, so it is done here — and the cut
 *  lands on a SEGMENT boundary, because slicing mid-word turned
 *  "app/(workspace)/account/billing/" into "…rkspace)/account/billing/", which
 *  looks like a rendering fault rather than a shortened path. */
function shortDir(d: string, max = 26): string {
  if (d.length <= max) return d;
  const segs = d.split("/").filter(Boolean);
  const out: string[] = [];
  for (let i = segs.length - 1; i >= 0; i--) {
    const next = [segs[i], ...out];
    if (next.join("/").length + 2 > max) break;
    out.unshift(segs[i]);
  }
  // Never return a bare ellipsis: one segment is more use than none.
  if (out.length === 0) out.push(segs[segs.length - 1]);
  return "…/" + out.join("/") + "/";
}

export function CTBlastDiagram() {
  const { epicenter, casualties } = LANDING_BLAST;
  const { breaks, untested } = blastCounts();
  const epi = split(epicenter);

  const cols = Math.ceil(casualties.length / ROWS_PER_COL);
  const rowsInFirst = Math.min(casualties.length, ROWS_PER_COL);
  const vbW = EPI_W + 60 + cols * COL_W + 20;
  const vbH = Math.max(rowsInFirst, 1) * ROW_H + 24;
  const epiY = vbH / 2 - CARD_H / 2;

  const pos = (i: number) => {
    const col = Math.floor(i / ROWS_PER_COL);
    const row = i % ROWS_PER_COL;
    const inCol = Math.min(casualties.length - col * ROWS_PER_COL, ROWS_PER_COL);
    // Centre each column's stack, so a short last column doesn't hang off the top.
    const top = (vbH - inCol * ROW_H) / 2 + (ROW_H - CARD_H) / 2;
    return { x: EPI_W + 60 + col * COL_W, y: top + row * ROW_H };
  };

  return (
    <div style={{ background: SURFACE }}>
      {/* Verdict header — the product's own wording, its computed counts. */}
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: ROSE,
              border: `1px solid ${ROSE}55`,
              background: ROSE_SOFT,
              borderRadius: 5,
              padding: "2px 7px",
            }}
          >
            High risk
          </span>
          <span style={{ fontSize: 11.5, color: MUTED, fontFamily: "var(--ct-mono)" }}>
            if you delete {epicenter}
          </span>
        </div>
        <div style={{ fontSize: 15.5, fontWeight: 600, color: TEXT, letterSpacing: "-0.01em" }}>
          {epi.base} is load-bearing — deleting it breaks {breaks} files,{" "}
          {untested} with no test to catch it.
        </div>
      </div>

      <div style={{ padding: "6px 8px 10px", background: BG }}>
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          width="100%"
          role="img"
          aria-label={`Blast radius: deleting ${epicenter} breaks ${breaks} files, ${untested} with no test`}
          style={{ display: "block" }}
        >
          {/* Edges first so the cards sit on top of them. */}
          <g fill="none">
            {casualties.map((c, i) => {
              const p = pos(i);
              const x1 = EPI_W + 8;
              const y1 = epiY + CARD_H / 2;
              const x2 = p.x;
              const y2 = p.y + CARD_H / 2;
              const mid = x1 + (x2 - x1) / 2;
              return (
                <path
                  key={c.path}
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  stroke={c.untested ? `${ROSE}66` : BORDER}
                  strokeWidth={1.25}
                  strokeDasharray={c.untested ? "4 4" : undefined}
                />
              );
            })}
          </g>

          {/* Epicenter */}
          <g>
            <rect x={0} y={epiY} width={EPI_W} height={CARD_H} rx={10} fill={ROSE} />
            <text x={14} y={epiY + 19} fontSize={9.5} letterSpacing="1.3" fill={BG} opacity={0.85}>
              DELETE
            </text>
            <text
              x={14}
              y={epiY + 38}
              fontSize={13}
              fontWeight={700}
              fill={BG}
              fontFamily="var(--ct-mono)"
            >
              {epi.base}
            </text>
            <text x={14} y={epiY + 50} fontSize={9.5} fill={BG} opacity={0.8} fontFamily="var(--ct-mono)">
              {epi.dir}
            </text>
          </g>

          {/* Casualties */}
          {casualties.map((c, i) => {
            const p = pos(i);
            const s = split(c.path);
            return (
              <g key={c.path}>
                <rect
                  x={p.x}
                  y={p.y}
                  width={CARD_W}
                  height={CARD_H}
                  rx={8}
                  fill={c.untested ? ROSE_SOFT : SURFACE}
                  stroke={c.untested ? `${ROSE}33` : BORDER}
                  strokeWidth={1}
                />
                {/* The canvas marks an untested casualty with a 4px inset stripe. */}
                {c.untested && (
                  <rect x={p.x} y={p.y + 1} width={4} height={CARD_H - 2} rx={2} fill={ROSE} />
                )}
                <text
                  x={p.x + 11}
                  y={p.y + 20}
                  fontSize={13}
                  fontWeight={600}
                  fill={TEXT}
                  fontFamily="var(--ct-mono)"
                >
                  {s.base}
                </text>
                <text x={p.x + 11} y={p.y + 34} fontSize={10} fill={MUTED} fontFamily="var(--ct-mono)">
                  {shortDir(s.dir)}
                </text>
                <text
                  x={p.x + 11}
                  y={p.y + 48}
                  fontSize={9.5}
                  fill={c.untested ? ROSE : MUTED}
                  letterSpacing="0.06em"
                >
                  {c.untested ? "NO TEST" : "COVERED"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* The count strip the card carries under the diagram. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          padding: "10px 16px 12px",
          borderTop: `1px solid ${BORDER}`,
          fontSize: 11.5,
          fontFamily: "var(--ct-mono)",
          color: MUTED,
        }}
      >
        <span>
          <b style={{ color: ROSE }}>{breaks}</b> files break
        </span>
        <span>
          <b style={{ color: ROSE }}>{untested}</b> with no test
        </span>
        <span>
          <b style={{ color: TEXT }}>{LANDING_BLAST.hops}</b> hop — direct importers only
        </span>
      </div>
    </div>
  );
}
