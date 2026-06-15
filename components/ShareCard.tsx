"use client";

// Branded share-card layout. Renders at exact pixel dimensions so the capture
// is publishing-ready (1200×630 for OG / Twitter, 1080×1080 for Instagram-ish).
//
// CodeTrawl "SURFACE & DEPTH": bitumen ground, bone text, Schibsted Grotesk +
// Fragment Mono. International Orange is the one accent — the brand dot, glow,
// and the hotspot "heat" bars (churn literally reads as heat). Languages use
// the muted categorical palette; activity stays neutral bone. The card is
// captured live (html-to-image), so the CodeTrawl webfonts embed in the PNG.

import Image from "next/image";
import type { AnalysisSnapshot } from "@/lib/types";
import { ctDisplay, ctMono } from "@/components/landing/codetrawl/ctFonts";
import { MUTED } from "@/lib/vizPalette";

const DISPLAY = `${ctDisplay.style.fontFamily}, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;
const MONO = `${ctMono.style.fontFamily}, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;

// Muted categorical hues for the language bar (lib/vizPalette).
const LANG_COLORS = [MUTED.blue.ring, MUTED.sage.ring, MUTED.sand.ring];

export type ShareCardVariant = "landscape" | "square";

const DIMS: Record<ShareCardVariant, { w: number; h: number }> = {
  landscape: { w: 1200, h: 630 },
  square: { w: 1080, h: 1080 },
};

function Sparkline({
  data,
  width,
  height,
}: {
  data: Array<{ week: string; count: number }>;
  width: number;
  height: number;
}) {
  if (data.length === 0) {
    return (
      <div
        className="rounded"
        style={{
          width,
          height,
          background:
            "linear-gradient(90deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))",
        }}
      />
    );
  }
  const max = Math.max(...data.map((d) => d.count), 1);
  const step = width / Math.max(1, data.length - 1);
  const points = data.map((d, i) => {
    const x = i * step;
    const y = height - (d.count / max) * (height - 10) - 2;
    return `${x},${y}`;
  });
  const pathD = `M ${points.join(" L ")}`;
  const areaD = `${pathD} L ${width},${height} L 0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(236,234,232,0.22)" />
          <stop offset="100%" stopColor="rgba(236,234,232,0)" />
        </linearGradient>
      </defs>
      <path d={areaD} fill="url(#sparkFill)" />
      <path
        d={pathD}
        fill="none"
        stroke="#eceae8"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex flex-col items-start"
      style={{ padding: "10px 16px" }}
    >
      <span
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: "#eceae8",
          lineHeight: 1.1,
          letterSpacing: "-0.01em",
          fontFamily: MONO,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.45)",
          marginTop: 2,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fileBasename(p: string): string {
  return p.split("/").pop() || p;
}

interface Props {
  snapshot: AnalysisSnapshot;
  variant: ShareCardVariant;
}

export function ShareCard({ snapshot, variant }: Props) {
  const dim = DIMS[variant];
  const isSquare = variant === "square";

  const topHotspots = [...snapshot.hotspots]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const maxChurn = Math.max(1, ...topHotspots.map((h) => h.churn));
  const topContributors = snapshot.contributors.slice(0, 6);
  const activity = snapshot.commitActivity.slice(-26); // last ~6 months

  // Languages → normalized percentages (top 3)
  const langEntries = Object.entries(snapshot.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  const langTotal = langEntries.reduce((a, [, v]) => a + v, 0) || 1;

  return (
    <div
      style={{
        width: dim.w,
        height: dim.h,
        background:
          "linear-gradient(135deg, #0c0b0b 0%, #141210 55%, #1c140d 100%)",
        color: "#eceae8",
        fontFamily: DISPLAY,
        padding: isSquare ? 64 : 56,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: isSquare ? 28 : 22,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Decorative glow — International Orange (the brand moment) top-right,
          a faint ember balance bottom-left. */}
      <div
        style={{
          position: "absolute",
          top: -160,
          right: -160,
          width: 480,
          height: 480,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,79,0,0.20) 0%, rgba(255,79,0,0) 70%)",
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -200,
          left: -200,
          width: 540,
          height: 540,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(255,138,80,0.12) 0%, rgba(255,138,80,0) 70%)",
          filter: "blur(8px)",
          pointerEvents: "none",
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#ff4f00",
              boxShadow: "0 0 12px rgba(255,79,0,0.55)",
            }}
          />
          <span
            style={{
              fontSize: 16,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              fontFamily: DISPLAY,
            }}
          >
            CodeTrawl
          </span>
        </div>
        <span
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.55)",
            fontFamily: MONO,
          }}
        >
          {snapshot.repo.fullName}
        </span>
      </div>

      {/* Repo title */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, position: "relative" }}>
        <div
          style={{
            fontSize: isSquare ? 70 : 60,
            fontWeight: 700,
            lineHeight: 1.02,
            letterSpacing: "-0.035em",
            fontFamily: DISPLAY,
            background:
              "linear-gradient(90deg, #ffffff 0%, #eceae8 55%, #b0aca8 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}
        >
          {snapshot.repo.name}
        </div>
        {snapshot.repo.description && (
          <div
            style={{
              fontSize: 18,
              color: "rgba(255,255,255,0.7)",
              lineHeight: 1.4,
              maxWidth: "90%",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {snapshot.repo.description}
          </div>
        )}
      </div>

      {/* Stat row */}
      <div
        style={{
          display: "flex",
          gap: 4,
          borderRadius: 12,
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          position: "relative",
        }}
      >
        <StatPill label="Stars" value={formatNum(snapshot.repo.stars)} />
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <StatPill label="Forks" value={formatNum(snapshot.repo.forks)} />
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <StatPill
          label="Contributors"
          value={formatNum(snapshot.contributors.length)}
        />
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <StatPill
          label="Recent commits"
          value={formatNum(snapshot.recentCommits.length)}
        />
        <div style={{ width: 1, background: "rgba(255,255,255,0.08)" }} />
        <StatPill
          label="Language"
          value={snapshot.repo.language ?? "—"}
        />
      </div>

      {/* Body: sparkline + hotspots + contributors */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isSquare ? "1fr" : "1.3fr 1fr",
          gap: isSquare ? 24 : 28,
          position: "relative",
          flex: 1,
          minHeight: 0,
        }}
      >
        {/* Left: hotspots + activity */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.5)",
                marginBottom: 10,
              }}
            >
              Top hotspots
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {topHotspots.map((h) => (
                <div
                  key={h.path}
                  style={{ display: "flex", alignItems: "center", gap: 10 }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontFamily: MONO,
                      color: "rgba(255,255,255,0.85)",
                      width: isSquare ? 320 : 260,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={h.path}
                  >
                    {fileBasename(h.path)}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 8,
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.06)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${(h.churn / maxChurn) * 100}%`,
                        background: "linear-gradient(90deg, #c2693a, #ff4f00)",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.6)",
                      fontFamily: MONO,
                      width: 32,
                      textAlign: "right",
                    }}
                  >
                    {h.churn}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.5)",
                marginBottom: 8,
              }}
            >
              Commit activity (sampled)
            </div>
            <Sparkline
              data={activity}
              width={isSquare ? dim.w - 128 : 620}
              height={64}
            />
          </div>
        </div>

        {/* Right: contributors + languages */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.5)",
                marginBottom: 10,
              }}
            >
              Top contributors
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {topContributors.map((c) => (
                <div
                  key={c.login}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 10px 4px 4px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <Image
                    src={c.avatarUrl}
                    alt={c.login}
                    width={28}
                    height={28}
                    unoptimized
                    style={{ borderRadius: "50%" }}
                  />
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.85)",
                      fontFamily: MONO,
                    }}
                  >
                    {c.login}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.5)",
                marginBottom: 8,
              }}
            >
              Languages
            </div>
            <div
              style={{
                display: "flex",
                height: 8,
                borderRadius: 4,
                overflow: "hidden",
                marginBottom: 8,
              }}
            >
              {langEntries.map(([lang, bytes], i) => (
                <div
                  key={lang}
                  style={{
                    flex: bytes / langTotal,
                    background: LANG_COLORS[i % LANG_COLORS.length],
                  }}
                />
              ))}
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                fontSize: 12,
                color: "rgba(255,255,255,0.7)",
              }}
            >
              {langEntries.map(([lang, bytes], i) => {
                const pct = Math.round((bytes / langTotal) * 100);
                return (
                  <span
                    key={lang}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: LANG_COLORS[i % LANG_COLORS.length],
                      }}
                    />
                    {lang} {pct}%
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 12,
          color: "rgba(255,255,255,0.45)",
          position: "relative",
        }}
      >
        <span>
          Generated{" "}
          {new Date(snapshot.fetchedAt).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
        <span>CodeTrawl · paste a repo URL, get a constellation</span>
      </div>
    </div>
  );
}

export { DIMS as SHARE_CARD_DIMS };
