// The Faultline blast, drawn rather than photographed.
//
// Inline SVG, not React Flow. The product's canvas is a client component that
// pulls the whole library in for pan-and-zoom the landing has no use for; this
// needs the picture only, so it ships as markup with zero JavaScript, stays
// crisp at any density, and scales by viewBox the way the real canvas scales by
// fitView.
//
// COLOUR IS IMPORTED, NOT TRANSCRIBED. TOK is the product's own theme module
// (lib/sessionTheme, CH-backed), so this cannot drift from the canvas the way
// the first draft had. That draft flooded every untested card with flat orange,
// hung the cards straight on the dark well, and joined them with dashed bezier
// curves — none of which the product does. It tints only the leading 30% of an
// otherwise NEUTRAL panel, draws straight hairlines at low opacity, and leaves
// covered files fully grey, "so the danger reads instantly against them", as
// FaultlineBlastCanvas puts it. Restoring that took a wall of orange off the
// landing and made the shot true at the same time — the drift was never a
// stylistic choice, just an embellishment nobody had checked.
//
// GEOMETRY IS THE CANVAS'S TOO: column pitch, row pitch, rows-per-column and
// card size below are its constants, and lib/__tests__/landingBlast.test fails
// when they drift apart.
//
// TYPE SIZE is the one deliberate difference — see SHOT_SCALE.
//
// The other: the real canvas lets a casualty click through to the Source view.
// There is nothing to click through to from a landing page, so these are inert
// — the picture, not the tool.

import { TOK } from "@/lib/sessionTheme";
import { LANDING_BLAST, blastCounts } from "@/lib/landingBlast";
import { CT } from "./tokens";

/** From components/views/FaultlineBlastCanvas.tsx. */
const COL_W = 250;
const ROW_H = 86;
const ROWS_PER_COL = 6;
const CARD_W = 208;
const CARD_H = 56;
const EPI_W = 190;

/** The rose signature, and the edge weights the canvas gives its two classes. */
const ROSE = TOK.rose;
const EDGE_UNTESTED = { stroke: ROSE, strokeWidth: 1.25, opacity: 0.32 };
const EDGE_COVERED = { stroke: TOK.border, strokeWidth: 1, opacity: 0.22 };

/** The shot renders about 790px wide from a 1020-unit viewBox, so everything in
 *  it is scaled by roughly this much. Left alone, the product's 13px card label
 *  would arrive at 10px and its 9.5px "NO TEST" at 7.3 — smaller than anything
 *  else on the landing, whose floor is 10.5. So type is specified PRE-DIVIDED
 *  by the scale and lands at the product's own size instead of the product's
 *  size shrunk. The canvas does the same thing in reverse: fitView shrinks the
 *  labels and the reader zooms back in. A still picture cannot zoom.
 *
 *  Compensating for one width only works if the width holds, and the shot's
 *  column is `minmax(0, 1fr)` — at 1920 it would be a third wider and the type
 *  a third too big. So the drawing is CAPPED at the width the compensation
 *  assumes. Past that it stops growing and centres, the way a screenshot has a
 *  natural size and does not inflate to fill its container. */
const SHOT_SCALE = 0.78;
const px = (productPx: number) => Math.round((productPx / SHOT_SCALE) * 10) / 10;

const split = (p: string) => {
  const i = p.lastIndexOf("/");
  return { base: i < 0 ? p : p.slice(i + 1), dir: i < 0 ? "" : p.slice(0, i + 1) };
};

/** Trim a directory to its tail so a long app-router path still reads. The real
 *  canvas ellipsises with CSS; SVG text cannot, so it is done here — and the cut
 *  lands on a SEGMENT boundary, because slicing mid-word turned
 *  "app/(workspace)/account/billing/" into "…rkspace)/account/billing/", which
 *  looks like a rendering fault rather than a shortened path. */
function shortDir(d: string, max = 22): string {
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
    <div style={{ background: TOK.surface }}>
      {/* Verdict header — the product's own wording, its computed counts. */}
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${TOK.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.04em",
              color: ROSE,
              border: `1px solid ${ROSE}55`,
              background: TOK.roseSoft,
              borderRadius: 5,
              padding: "2px 7px",
            }}
          >
            High risk
          </span>
          <span style={{ fontSize: 11.5, color: TOK.textMuted, fontFamily: "var(--ct-mono)" }}>
            if you delete {epicenter}
          </span>
        </div>
        <div
          style={{
            fontSize: 15.5,
            fontWeight: 600,
            color: TOK.textPrimary,
            letterSpacing: "-0.01em",
          }}
        >
          {epi.base} is load-bearing — deleting it breaks {breaks} files,{" "}
          {untested} with no test to catch it.
        </div>
      </div>

      {/* The well takes the LANDING's bitumen rather than the product's canvas
          colour, which is one point off it. The frame fades into the page on
          this side (CTScreenshot fade="right"), and a fade between two nearly
          equal darks is what reads as a smudge instead of an edge. */}
      <div className="ct-blast-graph" style={{ padding: "6px 8px 10px", background: CT.bg }}>
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          width="100%"
          role="img"
          aria-label={`Blast radius: deleting ${epicenter} breaks ${breaks} files, ${untested} with no test`}
          style={{
            display: "block",
            maxWidth: Math.round(vbW * SHOT_SCALE),
            margin: "0 auto",
          }}
        >
          <defs>
            {/* The canvas's UNTESTED_BG, exactly: roseSoft at the leading edge,
                gone by 30%, over a neutral panel. Per-rect because the default
                objectBoundingBox units make each card its own 0→30%. */}
            <linearGradient id="ct-blast-untested" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={ROSE} stopOpacity={0.13} />
              <stop offset="30%" stopColor={ROSE} stopOpacity={0} />
            </linearGradient>
          </defs>

          {/* Edges first so the cards sit on top of them. Straight, as the
              canvas draws them — beziers from one origin cross each other into
              a thicket, which is why the first draft looked busy. */}
          <g fill="none">
            {casualties.map((c, i) => {
              const p = pos(i);
              const style = c.untested ? EDGE_UNTESTED : EDGE_COVERED;
              return (
                <line
                  key={c.path}
                  x1={EPI_W + 8}
                  y1={epiY + CARD_H / 2}
                  x2={p.x}
                  y2={p.y + CARD_H / 2}
                  {...style}
                />
              );
            })}
          </g>

          {/* Epicenter */}
          <g>
            <rect x={0} y={epiY} width={EPI_W} height={CARD_H} rx={10} fill={ROSE} />
            <text
              x={14}
              y={epiY + 18}
              fontSize={px(9.5)}
              letterSpacing="1.3"
              fill={TOK.bg}
              opacity={0.85}
            >
              DELETE
            </text>
            <text
              x={14}
              y={epiY + 36}
              fontSize={px(13)}
              fontWeight={700}
              fill={TOK.bg}
              fontFamily="var(--ct-mono)"
            >
              {epi.base}
            </text>
            <text
              x={14}
              y={epiY + 50}
              fontSize={px(9.5)}
              fill={TOK.bg}
              opacity={0.8}
              fontFamily="var(--ct-mono)"
            >
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
                  fill={TOK.surface}
                  stroke={c.untested ? `${ROSE}33` : TOK.border}
                  strokeWidth={1}
                />
                {c.untested && (
                  <>
                    <rect
                      x={p.x}
                      y={p.y}
                      width={CARD_W}
                      height={CARD_H}
                      rx={8}
                      fill="url(#ct-blast-untested)"
                    />
                    {/* The canvas's 4px inset stripe. */}
                    <rect
                      x={p.x}
                      y={p.y + 1}
                      width={4}
                      height={CARD_H - 2}
                      rx={2}
                      fill={ROSE}
                    />
                  </>
                )}
                <text
                  x={p.x + 12}
                  y={p.y + 21}
                  fontSize={px(13)}
                  fontWeight={600}
                  fill={TOK.textPrimary}
                  fontFamily="var(--ct-mono)"
                >
                  {s.base}
                </text>
                <text
                  x={p.x + 12}
                  y={p.y + 36}
                  fontSize={px(10)}
                  fill={TOK.textMuted}
                  fontFamily="var(--ct-mono)"
                >
                  {shortDir(s.dir)}
                </text>
                <text
                  x={p.x + 12}
                  y={p.y + 50}
                  fontSize={px(9.5)}
                  fill={c.untested ? ROSE : TOK.textMuted}
                  letterSpacing="0.06em"
                >
                  {c.untested ? "NO TEST" : "COVERED"}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* PHONES GET THE LIST, NOT THE GRAPH.
          A 1020-unit viewBox in a 349px column scales by 0.34, which puts
          "NO TEST" at 4.2px — and "it reflows on a phone instead of scaling
          down to something unreadable" is the whole reason these panes are
          rendered rather than photographed. A screenshot could only shrink; this
          can change shape. Same casualties, same order, same rose signature —
          the graph's spatial claim (one origin, many dependants) is what a
          narrow column cannot hold, so it is the part that goes. */}
      <ul
        className="ct-blast-list"
        style={{ listStyle: "none", margin: 0, padding: "8px 10px 10px", background: CT.bg }}
      >
        {casualties.map((c) => {
          const s = split(c.path);
          return (
            <li
              key={c.path}
              style={{
                position: "relative",
                padding: "7px 10px 7px 13px",
                marginBottom: 4,
                borderRadius: 8,
                background: c.untested
                  ? `linear-gradient(90deg, ${TOK.roseSoft} 0%, transparent 30%), ${TOK.surface}`
                  : TOK.surface,
                border: `1px solid ${c.untested ? `${ROSE}33` : TOK.border}`,
                boxShadow: c.untested ? `inset 4px 0 0 ${ROSE}` : "none",
              }}
            >
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: TOK.textPrimary,
                  fontFamily: "var(--ct-mono)",
                }}
              >
                {s.base}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 10.5,
                  fontFamily: "var(--ct-mono)",
                  color: TOK.textMuted,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.dir}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    flexShrink: 0,
                    letterSpacing: "0.06em",
                    color: c.untested ? ROSE : TOK.textMuted,
                  }}
                >
                  {c.untested ? "NO TEST" : "COVERED"}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {/* The count strip the card carries under the diagram. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 18,
          padding: "10px 16px 12px",
          borderTop: `1px solid ${TOK.border}`,
          fontSize: 11.5,
          fontFamily: "var(--ct-mono)",
          color: TOK.textMuted,
        }}
      >
        <span>
          <b style={{ color: ROSE }}>{breaks}</b> files break
        </span>
        <span>
          <b style={{ color: ROSE }}>{untested}</b> with no test
        </span>
        <span>
          <b style={{ color: TOK.textPrimary }}>{LANDING_BLAST.hops}</b> hop —
          direct importers only
        </span>
      </div>
    </div>
  );
}
