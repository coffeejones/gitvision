// Preview gallery for the TierIcon component. Lets us eyeball the
// Lucide Shield / Swords / Crown choices at every size we'd actually
// render them — favicon (16), nav-badge (24), in-app standard (32),
// pricing-card (64), pricing-hero (128), marketing-hero (256) — plus
// a mock pricing-card layout to see the icons in context.
//
// Visit at /mockups/tiers while dev server is running.

import { TOK } from "@/lib/theme";
import { TierIcon, type Tier } from "@/components/TierIcon";

const TIERS: Array<{ id: Tier; label: string; price: string; tagline: string }> = [
  {
    id: "open-case",
    label: "Scout",
    price: "Free",
    tagline: "Explore your codebase. No card required.",
  },
  {
    id: "standing-docket",
    label: "Knight",
    price: "$12/mo",
    tagline: "Capable analysis for serious work.",
  },
  {
    id: "full-bench",
    label: "Baron",
    price: "$48/mo",
    tagline: "Master every repo you touch.",
  },
];

const SIZES = [16, 24, 32, 64, 128, 256];

export default function TierIconsPreview() {
  return (
    <main
      className="min-h-screen w-full"
      style={{ background: TOK.bg, color: TOK.textPrimary }}
    >
      <div className="max-w-7xl mx-auto px-8 pt-12 pb-24 flex flex-col gap-16">
        {/* Hero */}
        <header className="flex flex-col gap-3">
          <span
            className="text-[10px] uppercase tracking-[0.18em] font-medium"
            style={{ color: TOK.textMuted }}
          >
            Preview · /mockups/tiers
          </span>
          <h1
            className="text-3xl sm:text-4xl font-semibold tracking-tight"
            style={{ letterSpacing: "-0.025em", lineHeight: 1.1 }}
          >
            Tier icon preview
          </h1>
          <p
            className="text-base max-w-2xl leading-relaxed"
            style={{ color: TOK.textSecondary }}
          >
            Lucide Shield / Swords / Crown rendered at every size we&apos;d
            ship them. Plus mock pricing-card layout so you can see the
            icons in context.
          </p>
        </header>

        {/* Size grid — each tier at every render size */}
        <section className="flex flex-col gap-6">
          <h2
            className="text-base font-semibold tracking-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            Every tier at every size
          </h2>
          <div
            className="rounded-xl p-6 flex flex-col gap-6"
            style={{
              background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
              border: `1px solid ${TOK.border}`,
              boxShadow:
                "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
            }}
          >
            {TIERS.map((tier) => (
              <div
                key={tier.id}
                className="flex items-center gap-6 flex-wrap"
              >
                <div className="min-w-[80px]">
                  <div
                    className="text-sm font-semibold"
                    style={{ color: TOK.textPrimary }}
                  >
                    {tier.label}
                  </div>
                  <div
                    className="text-[11px] uppercase tracking-[0.12em]"
                    style={{ color: TOK.textMuted }}
                  >
                    {tier.id}
                  </div>
                </div>
                <div className="flex items-end gap-6 flex-wrap">
                  {SIZES.map((size) => (
                    <div
                      key={size}
                      className="flex flex-col items-center gap-2"
                    >
                      <TierIcon tier={tier.id} size={size} />
                      <span
                        className="text-[10px] font-mono"
                        style={{ color: TOK.textMuted }}
                      >
                        {size}px
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Color variants */}
        <section className="flex flex-col gap-6">
          <h2
            className="text-base font-semibold tracking-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            Color variants (Baron at 64px)
          </h2>
          <div
            className="rounded-xl p-6 flex items-center gap-12 flex-wrap"
            style={{
              background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
              border: `1px solid ${TOK.border}`,
              boxShadow:
                "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
            }}
          >
            <ColorSwatch
              label="Default (textPrimary)"
              hex={TOK.textPrimary}
            >
              <TierIcon tier="full-bench" size={64} />
            </ColorSwatch>
            <ColorSwatch
              label="textSecondary (current tier dim)"
              hex={TOK.textSecondary}
            >
              <TierIcon tier="full-bench" size={64} color={TOK.textSecondary} />
            </ColorSwatch>
            <ColorSwatch
              label="textMuted (inactive)"
              hex={TOK.textMuted}
            >
              <TierIcon tier="full-bench" size={64} color={TOK.textMuted} />
            </ColorSwatch>
            <ColorSwatch label="accent (upgrade CTA)" hex={TOK.accent}>
              <TierIcon tier="full-bench" size={64} color={TOK.accent} />
            </ColorSwatch>
            <ColorSwatch label="rose (warning)" hex={TOK.rose}>
              <TierIcon tier="full-bench" size={64} color={TOK.rose} />
            </ColorSwatch>
          </div>
        </section>

        {/* Mock pricing-card layout */}
        <section className="flex flex-col gap-6">
          <h2
            className="text-base font-semibold tracking-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            Mock pricing-card layout
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {TIERS.map((tier, i) => (
              <div
                key={tier.id}
                className="rounded-xl p-6 flex flex-col gap-4 relative"
                style={{
                  background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
                  border: `1px solid ${i === 1 ? TOK.borderStrong : TOK.border}`,
                  boxShadow:
                    "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
                }}
              >
                {/* Recommended badge on Knight */}
                {i === 1 && (
                  <span
                    className="absolute -top-2 left-6 text-[10px] uppercase tracking-[0.18em] font-medium px-2 py-0.5 rounded"
                    style={{
                      background: TOK.textPrimary,
                      color: TOK.bg,
                    }}
                  >
                    Recommended
                  </span>
                )}

                {/* Tier icon */}
                <TierIcon tier={tier.id} size={48} />

                {/* Tier label */}
                <div className="flex flex-col gap-1">
                  <h3
                    className="text-xl font-semibold tracking-tight"
                    style={{
                      color: TOK.textPrimary,
                      letterSpacing: "-0.015em",
                    }}
                  >
                    {tier.label}
                  </h3>
                  <p
                    className="text-sm"
                    style={{ color: TOK.textSecondary }}
                  >
                    {tier.tagline}
                  </p>
                </div>

                {/* Price */}
                <div
                  className="text-3xl font-semibold tabular-nums tracking-tight"
                  style={{
                    color: TOK.textPrimary,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {tier.price}
                </div>

                {/* CTA */}
                <button
                  className="inline-flex items-center justify-center h-10 px-5 rounded-lg text-sm font-medium transition hover:opacity-90 mt-2"
                  style={{
                    background:
                      i === 1 ? TOK.textPrimary : "rgba(255, 255, 255, 0.04)",
                    color: i === 1 ? TOK.bg : TOK.textPrimary,
                    border:
                      i === 1
                        ? "none"
                        : `1px solid rgba(255, 255, 255, 0.1)`,
                  }}
                >
                  {i === 0 ? "Start free" : "Choose " + tier.label}
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Favicon check */}
        <section className="flex flex-col gap-6">
          <h2
            className="text-base font-semibold tracking-tight"
            style={{ letterSpacing: "-0.01em" }}
          >
            Favicon-tier check (16px on white)
          </h2>
          <div
            className="rounded-xl p-6 flex items-center gap-8"
            style={{
              background: "white",
              border: `1px solid ${TOK.border}`,
            }}
          >
            <p className="text-sm" style={{ color: "#333" }}>
              At 16×16 on light background, the tier icons should still
              read clearly:
            </p>
            <div className="flex items-center gap-6">
              {TIERS.map((tier) => (
                <div
                  key={tier.id}
                  className="flex flex-col items-center gap-1"
                >
                  <TierIcon tier={tier.id} size={16} color="#333" />
                  <span className="text-[10px]" style={{ color: "#666" }}>
                    {tier.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function ColorSwatch({
  label,
  hex,
  children,
}: {
  label: string;
  hex: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <div className="flex flex-col items-center">
        <span className="text-[11px]" style={{ color: TOK.textSecondary }}>
          {label}
        </span>
        <span className="text-[10px] font-mono" style={{ color: TOK.textMuted }}>
          {hex}
        </span>
      </div>
    </div>
  );
}
