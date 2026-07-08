// README trend badge (Arc 3 distribution) — a shields-flat SVG of a session's
// verdict grade + trend arrow ("codetrawl | B+ ↘"), pasted into a repo README
// as an evergreen backlink. Every README view re-fetches it, so the grade is
// always current — the "update angle" as a distribution surface.
//
// Pure string builder (no DOM), so the route stays thin and this is unit
// testable. Text widths are approximated — a badge doesn't need pixel-perfect
// metrics, just enough padding that nothing clips.

export type BadgeTrend = "up" | "down" | "flat" | "none";

const BITUMEN = "#141210";
const BONE = "#eceae8";

/** Grade band → background. A green ramp to red, the convention README readers
 *  expect from a grade badge. White message text reads on all of them. */
function gradeBg(grade: string): string {
  switch (grade.charAt(0)) {
    case "A":
      return "#2ea043"; // green
    case "B":
      return "#6fa524"; // lime
    case "C":
      return "#b8860b"; // goldenrod
    case "D":
      return "#e8730f"; // orange
    default:
      return "#d1242f"; // F — red
  }
}

const CHAR_W = 6.3; // avg px per glyph at 11px system sans

function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    if (/[↗↘→]/.test(ch)) w += 11;
    else if (ch === " ") w += 3.4;
    else w += CHAR_W;
  }
  return w;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface BadgeParts {
  label: string;
  message: string;
  labelBg: string;
  messageBg: string;
  labelFg: string;
  messageFg: string;
  /** Draw the brand dot before the label. */
  dot: boolean;
}

function renderBadge(p: BadgeParts): string {
  const dotSpace = p.dot ? 16 : 0;
  const labelPadL = p.dot ? 6 : 10;
  const labelW = Math.ceil(labelPadL + dotSpace + textWidth(p.label) + 10);
  const msgW = Math.ceil(14 + textWidth(p.message));
  const w = labelW + msgW;
  const h = 20;

  const dot = p.dot
    ? `<circle cx="11" cy="10" r="3.5" fill="#ff4f00"/>`
    : "";
  const labelTextX = labelPadL + dotSpace;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${escapeXml(
    `${p.label}: ${p.message}`
  )}">
  <title>${escapeXml(`${p.label}: ${p.message}`)}</title>
  <clipPath id="r"><rect width="${w}" height="${h}" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${h}" fill="${p.labelBg}"/>
    <rect x="${labelW}" width="${msgW}" height="${h}" fill="${p.messageBg}"/>
  </g>
  <g font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif" font-size="11" font-weight="600">
    ${dot}
    <text x="${labelTextX}" y="14" fill="${p.labelFg}">${escapeXml(p.label)}</text>
    <text x="${labelW + msgW / 2}" y="14" fill="${p.messageFg}" text-anchor="middle">${escapeXml(
    p.message
  )}</text>
  </g>
</svg>`;
}

/** The grade + trend badge for a public session. */
export function gradeBadgeSvg(opts: { grade: string; trend: BadgeTrend }): string {
  const arrow =
    opts.trend === "up"
      ? "↗"
      : opts.trend === "down"
        ? "↘"
        : opts.trend === "flat"
          ? "→"
          : "";
  const message = arrow ? `${opts.grade} ${arrow}` : opts.grade;
  return renderBadge({
    label: "codetrawl",
    message,
    labelBg: BITUMEN,
    messageBg: gradeBg(opts.grade),
    labelFg: BONE,
    messageFg: "#ffffff",
    dot: true,
  });
}

/** A neutral badge — no grade — for private sessions or unresolved state, so a
 *  README never shows a broken image while also never leaking a private grade. */
export function neutralBadgeSvg(message: string): string {
  return renderBadge({
    label: "codetrawl",
    message,
    labelBg: BITUMEN,
    messageBg: "#3a3632",
    labelFg: BONE,
    messageFg: "#cbc7c2",
    dot: true,
  });
}
