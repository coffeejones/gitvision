import type { LanguageBreakdown } from "@/lib/types";
import { TOK } from "@/lib/sessionTheme";
import { MUTED_LIST } from "@/lib/vizPalette";

// Deterministic colour per language name — a stable index into the shared
// muted categorical palette (lib/vizPalette), so the language bar matches the
// canvas/graph hues and stays on the calm bitumen palette instead of a
// full-saturation rainbow.
function colorFor(lang: string): string {
  let hash = 0;
  for (let i = 0; i < lang.length; i++) hash = (hash * 31 + lang.charCodeAt(i)) >>> 0;
  return MUTED_LIST[hash % MUTED_LIST.length].ring;
}

export function LanguageBar({ languages }: { languages: LanguageBreakdown }) {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  const containerStyle = {
    background: TOK.surface,
    border: `1px solid ${TOK.border}`,
  };

  if (entries.length === 0) {
    return (
      <div
        className="rounded-xl p-5 text-sm"
        style={{ ...containerStyle, color: TOK.textMuted }}
      >
        No language data available.
      </div>
    );
  }

  return (
    <div className="rounded-xl p-5" style={containerStyle}>
      <h3
        className="text-base font-semibold tracking-tight mb-3"
        style={{
          color: TOK.textPrimary,
          letterSpacing: "-0.01em",
        }}
      >
        Language mix
      </h3>
      <div
        className="flex h-3 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        {entries.map(([lang, bytes]) => (
          <div
            key={lang}
            style={{
              width: `${(bytes / total) * 100}%`,
              background: colorFor(lang),
            }}
            title={`${lang}: ${((bytes / total) * 100).toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1">
        {entries.slice(0, 8).map(([lang, bytes]) => (
          <li key={lang} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: colorFor(lang) }}
            />
            <span className="truncate" style={{ color: TOK.textPrimary }}>
              {lang}
            </span>
            <span
              className="ml-auto tabular-nums"
              style={{ color: TOK.textMuted }}
            >
              {((bytes / total) * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
