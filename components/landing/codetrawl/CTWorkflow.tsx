// CTWorkflow — the pipeline diagram: how a sweep actually runs, drawn in the
// page's own ink. repo → clone → parse → four lenses (fan-out) → signals →
// grade, with the AI briefing as a DASHED side branch off the signals — the
// architecture's whole point (the model narrates, it never sits between the
// signals and the grade) made visible in the geometry.
//
// Engineering-drawing presentation: a phase rail across the top (acquire →
// parse → examine → decide), stage names in the display face over mono
// detail lines, and the grade as a double-ringed terminus plate. Hairlines,
// bone/dim/ghost ink only (the orange budget has no slot here). Edges draw
// themselves and stages rise left-to-right on scroll (via the wrapping
// CTReveal's .ct-in); reduced-motion renders it complete.

const MONO = "var(--ct-mono)";
const DISPLAY = "var(--ct-display)";

/** Stage box: hairline rect + display-face title + mono sub. */
function Box({
  x,
  y,
  w,
  h,
  title,
  sub,
  wi,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  wi: number;
}) {
  return (
    <g className="wf-n" style={{ "--wi": wi } as React.CSSProperties}>
      <rect x={x} y={y} width={w} height={h} rx={8} className="wf-box" />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 8 : y + h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="wf-stage"
        fontFamily={DISPLAY}
      >
        {title}
      </text>
      {sub && (
        <text
          x={x + w / 2}
          y={y + h / 2 + 13}
          textAnchor="middle"
          dominantBaseline="central"
          className="wf-sub"
          fontFamily={MONO}
        >
          {sub}
        </text>
      )}
    </g>
  );
}

/** Smooth horizontal connector with an arrowhead. */
function edge(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(26, (x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

const MID = 240;
const LENS_YS = [108, 196, 284, 372];
const LENS_NAMES = ["history", "structure", "security", "supply"];

/** Phase rail entry: mono-caps label + a hairline underlining its span. */
function Phase({
  x1,
  x2,
  label,
  wi,
}: {
  x1: number;
  x2: number;
  label: string;
  wi: number;
}) {
  return (
    <g className="wf-n" style={{ "--wi": wi } as React.CSSProperties}>
      <text x={x1} y={16} className="wf-phase" fontFamily={MONO}>
        {label}
      </text>
      <line x1={x1} y1={28} x2={x2} y2={28} className="wf-phaseline" />
    </g>
  );
}

export function CTWorkflow() {
  return (
    <div className="wf-scroll">
      <svg
        className="wf"
        viewBox="0 0 1180 424"
        role="img"
        aria-label="How a sweep runs: a repository URL is cloned bloblessly into an isolated temp workspace, parsed with tree-sitter, examined by four lenses — history, structure, security, supply — which produce twenty deterministic signals; the signals compute the surface grade, and the AI briefing only narrates the signals."
      >
        <defs>
          <marker
            id="wf-arr"
            markerWidth="7"
            markerHeight="7"
            refX="5.6"
            refY="3"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L6,3 L0,6 Z" className="wf-arrhead" />
          </marker>
        </defs>

        {/* phase rail */}
        <Phase x1={16} x2={384} label="acquire" wi={0} />
        <Phase x1={424} x2={584} label="parse" wi={2} />
        <Phase x1={648} x2={794} label="examine" wi={5} />
        <Phase x1={858} x2={1174} label="decide" wi={12} />

        {/* edges — drawn in document order, staggered by --wi */}
        <g>
          <path className="wf-e" style={{ "--wi": 1 } as React.CSSProperties} d={edge(194, MID, 228, MID)} markerEnd="url(#wf-arr)" />
          <path className="wf-e" style={{ "--wi": 3 } as React.CSSProperties} d={edge(388, MID, 424, MID)} markerEnd="url(#wf-arr)" />
          {LENS_YS.map((y, i) => (
            <path
              key={`f${i}`}
              className="wf-e"
              style={{ "--wi": 5 + i } as React.CSSProperties}
              d={edge(584, MID, 648, y)}
              markerEnd="url(#wf-arr)"
            />
          ))}
          {LENS_YS.map((y, i) => (
            <path
              key={`c${i}`}
              className="wf-e"
              style={{ "--wi": 9 + i } as React.CSSProperties}
              d={edge(794, y, 858, MID)}
              markerEnd="url(#wf-arr)"
            />
          ))}
          <path className="wf-e" style={{ "--wi": 14 } as React.CSSProperties} d={edge(1018, MID, 1052, 218)} markerEnd="url(#wf-arr)" />
          {/* dashed: the model hangs off the signals, never between them
              and the grade */}
          <path className="wf-e wf-dash" style={{ "--wi": 15 } as React.CSSProperties} d={edge(1018, MID, 1052, 326)} markerEnd="url(#wf-arr)" />
        </g>

        {/* stages */}
        <g className="wf-n" style={{ "--wi": 0 } as React.CSSProperties}>
          <rect x={16} y={MID - 17} width={178} height={34} rx={8} className="wf-box" />
          <text
            x={105}
            y={MID + 1}
            textAnchor="middle"
            dominantBaseline="central"
            className="wf-title"
            fontFamily={MONO}
          >
            github.com/owner/repo
          </text>
        </g>
        <Box x={228} y={MID - 34} w={160} h={68} title="clone" sub="blobless · temp" wi={2} />
        <Box x={424} y={MID - 34} w={160} h={68} title="parse" sub="tree-sitter · 8 langs" wi={4} />
        {LENS_YS.map((y, i) => (
          <g className="wf-n" style={{ "--wi": 5 + i } as React.CSSProperties} key={i}>
            <rect x={648} y={y - 19} width={146} height={38} rx={8} className="wf-box" />
            <rect x={662} y={y - 3} width={6} height={6} className="wf-tick" />
            <text
              x={678}
              y={y + 1}
              dominantBaseline="central"
              className="wf-stage"
              fontFamily={DISPLAY}
            >
              {LENS_NAMES[i]}
            </text>
          </g>
        ))}
        <Box x={858} y={MID - 34} w={160} h={68} title="signals" sub="20 deterministic" wi={13} />

        {/* grade — the terminus plate (double ring) */}
        <g className="wf-n" style={{ "--wi": 14 } as React.CSSProperties}>
          <rect x={1052} y={186} width={118} height={64} rx={8} className="wf-box" />
          <rect x={1057} y={191} width={108} height={54} rx={5} className="wf-ring" />
          <text
            x={1111}
            y={211}
            textAnchor="middle"
            dominantBaseline="central"
            className="wf-grademark"
            fontFamily={DISPLAY}
          >
            B+
          </text>
          <text
            x={1111}
            y={234}
            textAnchor="middle"
            dominantBaseline="central"
            className="wf-sub"
            fontFamily={MONO}
          >
            surface grade
          </text>
        </g>

        {/* briefing — the model's only job */}
        <g className="wf-n" style={{ "--wi": 15 } as React.CSSProperties}>
          <rect x={1052} y={304} width={118} height={44} rx={8} className="wf-box wf-boxdash" />
          <text
            x={1111}
            y={319}
            textAnchor="middle"
            dominantBaseline="central"
            className="wf-title"
            fontFamily={MONO}
          >
            briefing
          </text>
          <text
            x={1111}
            y={335}
            textAnchor="middle"
            dominantBaseline="central"
            className="wf-sub"
            fontFamily={MONO}
          >
            AI narrates only
          </text>
        </g>
      </svg>
      <p className="wf-cap">
        one pass · ~60s · deterministic end to end — the model never sits
        between the signals and the grade
      </p>
    </div>
  );
}
