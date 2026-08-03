// Deterministic formatting for anything a client component renders.
//
// `toLocaleDateString()` and `toLocaleString()` with no arguments read the
// AMBIENT locale — the Node process's on the server, the visitor's in the
// browser. A client component runs both, so whenever the two disagree React
// finds different text during hydration, throws away that subtree and rebuilds
// it. Measured on a session page:
//
//   server (Node, en-US)    5/19/2026     34,687
//   browser (da)            19.5.2026     34.687
//
// The date was reported as a visible dev-overlay error. The numbers were not,
// and are the same bug: five call sites across four components where the only
// difference is a comma versus a period, which nobody looks at twice.
//
// These helpers take no locale from the environment. They are also ICU-free —
// spelled out rather than delegating to Intl — so they cannot drift with a
// small-icu Node build or an ICU version bump on the deploy box either.
//
// The product's interface is English throughout, so English conventions are the
// right target: "19 May 2026" and "34,687". "19 May 2026" over "5/19/2026"
// because the latter is genuinely ambiguous to most of the world, and this
// string sits next to relative English ("2d ago") where a US date would read as
// a slip rather than a choice.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Thousands-grouped integer: 34687 -> "34,687". Negative numbers and any
 *  fractional part are preserved; only the integer part is grouped. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const neg = n < 0;
  const abs = Math.abs(n);
  const [whole, frac] = String(abs).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** "19 May 2026". Renders in UTC, deliberately: a snapshot's date is a fact
 *  about when the analysis ran, not about where the reader is sitting, and a
 *  local-time render would put the server and client a day apart either side of
 *  midnight — the same hydration bug in a rarer costume. */
export function formatDateAbs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "19 May 2026, 12:24 UTC" — for title attributes, where the exact moment is
 *  the point. Explicitly labelled UTC so the number is not mistaken for local
 *  time. */
export function formatDateTimeAbs(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${formatDateAbs(iso)}, ${hh}:${mm} UTC`;
}
