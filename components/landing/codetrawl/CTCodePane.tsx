// The Source view, rendered rather than photographed.
//
// A server component: Shiki runs at request time (lib/highlight.ts has no
// "use client" and the JS regex engine needs no WASM), so this ships as plain
// HTML — no client bundle, no image to decode, crisp at any pixel density, and
// it reflows on a phone instead of scaling down to something unreadable.
//
// GEOMETRY IS COPIED FROM THE PRODUCT, NOT APPROXIMATED. The numbers below are
// the ones components/views/CodeView.tsx uses: 20px lines, a 52px right-aligned
// number gutter, a 34px marker column, 12.5px mono. If those change there, they
// change here — lib/__tests__/landingCodePane.test.ts fails when they drift,
// because a landing that quietly stops matching the product is worse than a
// screenshot, which at least fails visibly.
//
// The theme is Shiki's github-dark-default, the same one the Source view uses,
// so the token colours are identical rather than merely similar.

import { highlightToLines } from "@/lib/highlight";
import { LANDING_SOURCE } from "@/lib/landingSource";

/** From components/views/CodeView.tsx. */
const LINE_HEIGHT = 20;
const GUTTER_NUM = 52;
const GUTTER_MARK = 34;
const CODE_SIZE = 12.5;

const SURFACE = "#171615";
const BORDER = "rgba(255,255,255,0.08)";
const MUTED = "#6e6a64";
const TEXT = "#f2efea";
const AMBER = "#d29922";

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: 10.5,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 4,
        color,
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${BORDER}`,
      }}
    >
      {label}
    </span>
  );
}

export async function CTCodePane() {
  const src = LANDING_SOURCE;
  const { lines } = await highlightToLines(src.code, src.lang);
  const fnLine = src.fn.line;

  return (
    <div style={{ background: SURFACE, fontFamily: "var(--ct-mono)" }}>
      {/* File path bar — the Source view's own header row. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 34,
          padding: "0 14px",
          borderBottom: `1px solid ${BORDER}`,
          fontSize: 11.5,
          color: MUTED,
        }}
      >
        <span style={{ color: TEXT }}>{src.path}</span>
        <span>·</span>
        <span>{src.repo}</span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: "max-content", fontSize: CODE_SIZE }}>
          {lines.map((toks, i) => {
            const n = src.firstLine + i;
            const isFn = n === fnLine;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  height: LINE_HEIGHT,
                  // The product highlights the focused line; here that is the
                  // function the chips below describe, so the eye lands on the
                  // thing being talked about.
                  background: isFn ? "rgba(255,255,255,0.07)" : SURFACE,
                }}
              >
                <span
                  style={{
                    width: GUTTER_NUM,
                    flexShrink: 0,
                    textAlign: "right",
                    paddingRight: 12,
                    color: MUTED,
                    lineHeight: `${LINE_HEIGHT}px`,
                    userSelect: "none",
                  }}
                >
                  {n}
                </span>
                <span
                  style={{
                    width: GUTTER_MARK,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    userSelect: "none",
                  }}
                >
                  {isFn && (
                    <span
                      title={`Complexity ${src.signals.complexity}`}
                      style={{
                        fontSize: 9.5,
                        fontWeight: 600,
                        color: AMBER,
                        border: `1px solid ${AMBER}55`,
                        borderRadius: 3,
                        padding: "0 3px",
                        lineHeight: "13px",
                      }}
                    >
                      {src.signals.complexity}
                    </span>
                  )}
                </span>
                <code
                  style={{
                    whiteSpace: "pre",
                    lineHeight: `${LINE_HEIGHT}px`,
                    paddingRight: 24,
                  }}
                >
                  {toks.length === 0
                    ? "​"
                    : toks.map((t, j) => (
                        <span key={j} style={t.color ? { color: t.color } : undefined}>
                          {t.content}
                        </span>
                      ))}
                </code>
              </div>
            );
          })}
        </div>
      </div>

      {/* Evidence row — the product's chip vocabulary, its computed values. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 6,
          padding: "10px 14px",
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        <span style={{ fontSize: 11.5, color: TEXT, marginRight: 2 }}>
          {src.fn.name}
        </span>
        {/* Same chips, same wording, same colours as components/views/AiReading
            — including the amber ones. A landing that only ever showed the
            flattering chips would be the fake version of this. */}
        <Chip label={`Complexity ${src.signals.complexity}`} color={AMBER} />
        <Chip label={`Called from ${src.signals.callerCount}`} color={MUTED} />
        {src.signals.duplicateCount > 0 && (
          <Chip
            label={`${src.signals.duplicateCount} twin${src.signals.duplicateCount === 1 ? "" : "s"}`}
            color={AMBER}
          />
        )}
        {!src.signals.fileTested && <Chip label="No test guards it" color={AMBER} />}
      </div>

      {/* The reading. Section labels are the product's own (AiReadingBody:
          "What it does" / "Where the risk is" / "Worth considering"), and the
          prose is verbatim model output — see LANDING_SOURCE.reading. This is
          the half that shows a visitor the thing the chips cannot: that the
          function becomes UNDERSTANDABLE, not just measured. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: "12px 14px 14px",
          borderTop: `1px solid ${BORDER}`,
          background: "rgba(255,255,255,0.015)",
          // The pane sets mono for the code; the product renders the reading in
          // the body face, so step back out of it here rather than letting the
          // prose inherit a terminal look the real panel does not have.
          fontFamily: "var(--ct-display)",
        }}
      >
        <Reading label="What it does" body={src.reading.does} />
        <Reading label="Where the risk is" body={src.reading.risk} />
        {src.reading.suggestion && (
          <Reading label="Worth considering" body={src.reading.suggestion} accent />
        )}
        {/* The same disclosure the product shows at the point of action. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingTop: 4,
            fontSize: 10,
            color: MUTED,
          }}
        >
          <span>
            Reads this function&rsquo;s source with AI — sent to Anthropic on
            your click, never stored.
          </span>
          <span style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
            {modelLabel(src.reading.model)}
          </span>
        </div>
      </div>
    </div>
  );
}

/** One labelled paragraph of the reading. `accent` marks the suggestion, which
 *  the product sets off with a rule the same way. */
function Reading({
  label,
  body,
  accent = false,
}: {
  label: string;
  body: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 3,
        ...(accent ? { borderLeft: `2px solid ${AMBER}55`, paddingLeft: 9 } : {}),
      }}
    >
      <span
        style={{
          fontSize: 9.5,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: MUTED,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 11.5, lineHeight: 1.55, color: "#cfcac3" }}>
        {body}
      </span>
    </div>
  );
}

/** "claude-haiku-4-5" -> "Haiku 4.5", matching FunctionInsight's own label. */
function modelLabel(model: string): string {
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  if (!m) return model;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
}
