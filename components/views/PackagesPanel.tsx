"use client";

// Dedicated panel for package-dependency health. Surfaces the full output
// of the multi-ecosystem plugin pipeline (npm, Cargo, PyPI, ...) — vulnerable
// packages with clickable CVE links, outdated packages with age info, and
// deprecated packages with registry messages.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  PackageX,
  ShieldAlert,
} from "lucide-react";
import type {
  AnalysisSnapshot,
  DependencyHealth,
  DeprecatedDep,
  OutdatedDep,
  VulnerableDep,
} from "@/lib/types";
import { TOK } from "@/lib/theme";
import { SearchInput } from "@/components/SearchInput";
import { HelpHint } from "@/components/HelpHint";
import { EmptyPanel } from "@/components/EmptyPanel";

// ------------------- Link builders -------------------

function registryUrl(ecosystem: string, name: string): string {
  switch (ecosystem) {
    case "npm":
      return `https://www.npmjs.com/package/${encodeURIComponent(name)}`;
    case "cargo":
      return `https://crates.io/crates/${encodeURIComponent(name)}`;
    case "pypi":
      return `https://pypi.org/project/${encodeURIComponent(name)}/`;
    default:
      return `https://google.com/search?q=${encodeURIComponent(`${ecosystem} ${name}`)}`;
  }
}

function vulnUrl(id: string): string {
  // osv.dev redirects GHSA-, CVE-, RUSTSEC-, PYSEC- etc. to the right page
  return `https://osv.dev/vulnerability/${encodeURIComponent(id)}`;
}

function ecosystemLabel(eco: string): string {
  switch (eco) {
    case "npm":
      return "npm";
    case "cargo":
      return "Cargo";
    case "pypi":
      return "PyPI";
    default:
      return eco;
  }
}

// ------------------- Props -------------------

export function PackagesPanel({ snapshot }: { snapshot: AnalysisSnapshot }) {
  const healths =
    snapshot.dependencyHealths ??
    (snapshot.dependencyHealth ? [snapshot.dependencyHealth] : []);
  const [query, setQuery] = useState("");

  const totals = useMemo(() => {
    let packages = 0,
      vulnerable = 0,
      outdated = 0,
      deprecated = 0;
    for (const h of healths) {
      packages += h.uniquePackages ?? h.total;
      vulnerable += h.vulnerable.length;
      outdated += h.outdated.length;
      deprecated += h.deprecated.length;
    }
    return { packages, vulnerable, outdated, deprecated };
  }, [healths]);

  if (healths.length === 0) {
    return (
      <EmptyPanel
        icon={<PackageX size={22} />}
        title="No package manifests detected in this repo"
        body={
          <>
            RepoBaron reads{" "}
            <code className="font-mono">package.json</code>,{" "}
            <code className="font-mono">Cargo.toml</code>,{" "}
            <code className="font-mono">pyproject.toml</code>, and{" "}
            <code className="font-mono">requirements*.txt</code>. Try a
            JavaScript, Rust, or Python project to see vulnerable /
            outdated / deprecated dependencies surfaced here.
          </>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Summary tiles — four-up stat grid (packages, vulnerable,
       *  outdated, deprecated). Each tile carries the same material
       *  recipe as WorkspaceCard: diagonal gradient + layered shadow
       *  so the row reads as "objects on the page" not "row of
       *  spreadsheet cells". Severity counts adopt their colour at
       *  rest so the eye lands on red before green even reads. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile
          label="Packages"
          count={totals.packages}
          sublabel={`${healths.length} ecosystem${healths.length === 1 ? "" : "s"}: ${healths.map((h) => ecosystemLabel(h.ecosystem)).join(", ")}`}
        />
        <StatTile
          label="Vulnerable"
          count={totals.vulnerable}
          color={TOK.rose}
          colorBg={TOK.roseSoft}
          icon={<ShieldAlert size={13} />}
        />
        <StatTile
          label="Outdated"
          count={totals.outdated}
          color={TOK.amber}
          colorBg={TOK.amberSoft}
          icon={<Clock size={13} />}
        />
        <StatTile
          label="Deprecated"
          count={totals.deprecated}
          color={TOK.amber}
          colorBg={TOK.amberSoft}
          icon={<AlertTriangle size={13} />}
        />
      </div>

      {/* Help affordance — moved out of the summary bar prose. */}
      <div className="flex items-center justify-end -mt-3">
        <HelpHint
          anchor="dep-health"
          label="What outdated, deprecated, vulnerable, and abandoned mean"
        />
      </div>

      {/* Search */}
      <SearchInput
        value={query}
        onChange={setQuery}
        placeholder="Filter by package name…"
        surface="elevated"
      />

      {/* Per-ecosystem sections */}
      {healths.map((h) => (
        <EcosystemSection key={h.ecosystem} health={h} query={query} />
      ))}

      {/* Footer note */}
      <p className="text-xs" style={{ color: TOK.textMuted }}>
        Vulnerabilities from{" "}
        <a
          href="https://osv.dev"
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2"
        >
          OSV.dev
        </a>
        . Registry metadata from each ecosystem&apos;s official API. Click any
        package name to open its registry page, or any CVE ID to see the
        advisory.
      </p>
    </div>
  );
}

// ------------------- Stat tile -------------------

/** Apple-style summary tile. Large number leads, label sits below
 *  in caps. Severity tiles (vulnerable / outdated / deprecated) get
 *  their colour applied to both the count (so the eye lands on red
 *  before green) and a small icon chip in the top-right. Material
 *  recipe: diagonal gradient + 1px ambient shadow, same as the
 *  WorkspaceCard. Zero-count severity tiles dim back to textMuted
 *  so they don't shout when there's nothing to act on. */
function StatTile({
  label,
  count,
  sublabel,
  color,
  colorBg,
  icon,
}: {
  label: string;
  count: number;
  sublabel?: string;
  color?: string;
  colorBg?: string;
  icon?: React.ReactNode;
}) {
  const isZero = count === 0;
  const activeColor = color && !isZero ? color : TOK.textPrimary;
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1.5"
      style={{
        background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
        border: `1px solid ${TOK.border}`,
        boxShadow:
          "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-[10px] uppercase tracking-[0.18em] font-medium"
          style={{ color: TOK.textMuted }}
        >
          {label}
        </span>
        {icon && color && colorBg && !isZero && (
          <span
            className="rounded-md p-1 flex items-center justify-center"
            style={{ background: colorBg, color }}
          >
            {icon}
          </span>
        )}
      </div>
      <span
        className="text-3xl font-semibold tabular-nums tracking-tight"
        style={{
          color: isZero ? TOK.textMuted : activeColor,
          letterSpacing: "-0.02em",
        }}
      >
        {count.toLocaleString()}
      </span>
      {sublabel && (
        <span
          className="text-[11px] leading-snug truncate"
          style={{ color: TOK.textSecondary }}
          title={sublabel}
        >
          {sublabel}
        </span>
      )}
    </div>
  );
}

// ------------------- Ecosystem section -------------------

function EcosystemSection({
  health,
  query,
}: {
  health: DependencyHealth;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const vulnerable = q
    ? health.vulnerable.filter((d) => d.name.toLowerCase().includes(q))
    : health.vulnerable;
  const outdated = q
    ? health.outdated.filter((d) => d.name.toLowerCase().includes(q))
    : health.outdated;
  const deprecated = q
    ? health.deprecated.filter((d) => d.name.toLowerCase().includes(q))
    : health.deprecated;

  const matchTotal = vulnerable.length + outdated.length + deprecated.length;
  if (q && matchTotal === 0) return null;

  return (
    <section
      className="rounded-xl overflow-hidden"
      style={{
        background: `linear-gradient(135deg, ${TOK.surfaceElevated} 0%, ${TOK.surface} 60%)`,
        border: `1px solid ${TOK.border}`,
        boxShadow:
          "0 1px 2px rgba(0, 0, 0, 0.15), 0 8px 24px -12px rgba(0, 0, 0, 0.35)",
      }}
    >
      {/* Header — title-case ecosystem name as the lead. No accent
       *  pill (it competed with the severity colours in the issue
       *  groups below); meta lives as a subtle subtitle in textMuted. */}
      <header
        className="flex items-baseline justify-between gap-4 px-5 py-4 border-b flex-wrap"
        style={{ borderColor: TOK.border }}
      >
        <div className="flex items-baseline gap-3 flex-wrap">
          <h3
            className="text-lg font-semibold tracking-tight"
            style={{
              color: TOK.textPrimary,
              letterSpacing: "-0.015em",
            }}
          >
            {ecosystemLabel(health.ecosystem)}
          </h3>
          <span
            className="text-xs tabular-nums"
            style={{ color: TOK.textMuted }}
          >
            {health.uniquePackages ?? health.total} packages
            {health.packageFiles !== undefined && (
              <>
                {" · "}
                {health.packageFiles} manifest
                {health.packageFiles === 1 ? "" : "s"}
              </>
            )}
          </span>
        </div>
        {health.note && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{
              background: "rgba(255,255,255,0.04)",
              color: TOK.textMuted,
              border: `1px solid ${TOK.border}`,
            }}
            title={health.note}
          >
            note
          </span>
        )}
      </header>

      {/* Sections */}
      <div className="flex flex-col divide-y" style={{ borderColor: TOK.border }}>
        {vulnerable.length > 0 && (
          <IssueGroup
            title="Vulnerable"
            icon={<ShieldAlert size={14} />}
            accent={TOK.rose}
            accentBg={TOK.roseSoft}
            count={vulnerable.length}
          >
            {vulnerable.map((d) => (
              <VulnerableRow
                key={`${d.name}@${d.current}`}
                ecosystem={health.ecosystem}
                dep={d}
              />
            ))}
          </IssueGroup>
        )}

        {outdated.length > 0 && (
          <IssueGroup
            title="Outdated"
            icon={<Clock size={14} />}
            accent={TOK.amber}
            accentBg={TOK.amberSoft}
            count={outdated.length}
          >
            {outdated.map((d) => (
              <OutdatedRow
                key={`${d.name}@${d.current}`}
                ecosystem={health.ecosystem}
                dep={d}
              />
            ))}
          </IssueGroup>
        )}

        {deprecated.length > 0 && (
          <IssueGroup
            title="Deprecated"
            icon={<AlertTriangle size={14} />}
            accent={TOK.amber}
            accentBg={TOK.amberSoft}
            count={deprecated.length}
          >
            {deprecated.map((d) => (
              <DeprecatedRow
                key={`${d.name}@${d.current}`}
                ecosystem={health.ecosystem}
                dep={d}
              />
            ))}
          </IssueGroup>
        )}

        {vulnerable.length === 0 &&
          outdated.length === 0 &&
          deprecated.length === 0 && (
            <div
              className="px-5 py-4 text-sm"
              style={{ color: TOK.textMuted }}
            >
              No issues surfaced for this ecosystem.
            </div>
          )}
      </div>
    </section>
  );
}

// ------------------- Issue group (collapsible) -------------------

function IssueGroup({
  title,
  icon,
  accent,
  accentBg,
  count,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  accentBg: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-sm transition hover:bg-white/[0.02]"
        style={{ color: TOK.textPrimary }}
      >
        {open ? (
          <ChevronDown size={14} style={{ color: TOK.textMuted }} />
        ) : (
          <ChevronRight size={14} style={{ color: TOK.textMuted }} />
        )}
        <span style={{ color: accent }}>{icon}</span>
        <span className="font-semibold">{title}</span>
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded tabular-nums"
          style={{
            background: accentBg,
            color: accent,
          }}
        >
          {count}
        </span>
      </button>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

// ------------------- Package rows -------------------

function PackageRow({
  ecosystem,
  name,
  children,
}: {
  ecosystem: string;
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="px-5 py-3 flex items-start gap-3 border-t"
      style={{ borderColor: "rgba(255,255,255,0.04)" }}
    >
      <a
        href={registryUrl(ecosystem, name)}
        target="_blank"
        rel="noopener"
        className="font-mono text-[13px] font-medium flex items-center gap-1 shrink-0 hover:underline"
        style={{ color: TOK.textPrimary, minWidth: 180 }}
      >
        <span className="truncate">{name}</span>
        <ExternalLink
          size={10}
          style={{ color: TOK.textMuted }}
          className="shrink-0"
        />
      </a>
      <div className="flex-1 min-w-0 flex flex-col gap-1">{children}</div>
    </div>
  );
}

function VersionBlob({
  current,
  latest,
}: {
  current: string;
  latest?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-mono">
      <span
        className="px-1.5 py-0.5 rounded"
        style={{
          background: "rgba(255,255,255,0.04)",
          color: TOK.textPrimary,
        }}
      >
        {current}
      </span>
      {latest && (
        <>
          <span style={{ color: TOK.textMuted }}>→</span>
          <span
            className="px-1.5 py-0.5 rounded"
            style={{
              background: TOK.accentSoft,
              color: TOK.accent,
            }}
          >
            {latest}
          </span>
        </>
      )}
    </div>
  );
}

function Sources({ sources }: { sources?: string[] }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div
      className="text-[10px] font-mono flex items-center gap-1.5 flex-wrap"
      style={{ color: TOK.textMuted }}
    >
      <span>in:</span>
      {sources.slice(0, 3).map((s, i) => (
        <span key={i} className="truncate max-w-[260px]">
          {s}
          {i < Math.min(sources.length, 3) - 1 ? " ·" : ""}
        </span>
      ))}
      {sources.length > 3 && <span>+{sources.length - 3} more</span>}
    </div>
  );
}

function VulnerableRow({
  ecosystem,
  dep,
}: {
  ecosystem: string;
  dep: VulnerableDep;
}) {
  return (
    <PackageRow ecosystem={ecosystem} name={dep.name}>
      <VersionBlob current={dep.current} />
      <div className="flex items-center gap-1.5 flex-wrap">
        {dep.cves.slice(0, 5).map((cve) => (
          <a
            key={cve}
            href={vulnUrl(cve)}
            target="_blank"
            rel="noopener"
            className="text-[10px] font-mono px-1.5 py-0.5 rounded hover:brightness-125 transition"
            style={{
              background: TOK.roseSoft,
              color: TOK.rose,
            }}
          >
            {cve}
          </a>
        ))}
        {dep.cves.length > 5 && (
          <span
            className="text-[10px] font-mono"
            style={{ color: TOK.textMuted }}
          >
            +{dep.cves.length - 5} more
          </span>
        )}
      </div>
      <Sources sources={dep.sources} />
    </PackageRow>
  );
}

function OutdatedRow({
  ecosystem,
  dep,
}: {
  ecosystem: string;
  dep: OutdatedDep;
}) {
  return (
    <PackageRow ecosystem={ecosystem} name={dep.name}>
      <div className="flex items-center gap-2 flex-wrap">
        <VersionBlob current={dep.current} latest={dep.latest} />
        <span
          className="text-[10px] px-1.5 py-0.5 rounded font-mono"
          style={{
            background: TOK.amberSoft,
            color: TOK.amber,
          }}
        >
          {dep.ageMonths}m behind
        </span>
      </div>
      <Sources sources={dep.sources} />
    </PackageRow>
  );
}

function DeprecatedRow({
  ecosystem,
  dep,
}: {
  ecosystem: string;
  dep: DeprecatedDep;
}) {
  return (
    <PackageRow ecosystem={ecosystem} name={dep.name}>
      <VersionBlob current={dep.current} />
      <p
        className="text-xs leading-relaxed"
        style={{ color: TOK.textSecondary }}
      >
        {dep.message}
      </p>
      <Sources sources={dep.sources} />
    </PackageRow>
  );
}
