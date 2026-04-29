// Side-panel shown when the user clicks a node in the Constellation.

import { X } from "lucide-react";
import type { FileHotspot, CoChangeEdge, CommitSummary, RepoMeta } from "@/lib/types";
import { TOK } from "@/lib/theme";

interface Props {
  hotspot: FileHotspot;
  coChange: CoChangeEdge[];
  recentCommits: CommitSummary[];
  repo: RepoMeta;
  onClose: () => void;
}

export function FileDetailsPanel({
  hotspot,
  coChange,
  recentCommits,
  repo,
  onClose,
}: Props) {
  const partners = coChange
    .filter((e) => e.from === hotspot.path || e.to === hotspot.path)
    .map((e) => ({
      path: e.from === hotspot.path ? e.to : e.from,
      count: e.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const commitsForFile = recentCommits
    .filter((c) => hotspot.commits.includes(c.sha))
    .slice(0, 8);

  const ghUrl = `https://github.com/${repo.fullName}/blob/${repo.defaultBranch}/${hotspot.path}`;

  return (
    <aside
      className="absolute z-20 top-0 right-0 h-full w-[360px] backdrop-blur overflow-y-auto"
      style={{
        background: `${TOK.surface}f2`,
        color: TOK.textPrimary,
        borderLeft: `1px solid ${TOK.border}`,
      }}
    >
      <div
        className="sticky top-0 backdrop-blur px-4 py-3 flex items-start justify-between gap-2"
        style={{
          background: `${TOK.surface}f2`,
          borderBottom: `1px solid ${TOK.border}`,
        }}
      >
        <div className="min-w-0">
          <div
            className="text-[10px] uppercase tracking-wider"
            style={{ color: TOK.textMuted }}
          >
            File
          </div>
          <a
            href={ghUrl}
            target="_blank"
            rel="noopener"
            className="font-mono text-sm break-all hover:underline"
            style={{ color: TOK.textPrimary }}
          >
            {hotspot.path}
          </a>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 h-7 w-7 rounded-full transition flex items-center justify-center"
          style={{ color: TOK.textSecondary }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = TOK.surfaceElevated;
            e.currentTarget.style.color = TOK.textPrimary;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = TOK.textSecondary;
          }}
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <div className="p-4 space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Churn" value={hotspot.churn.toString()} sub="commits" />
          <Stat label="Authors" value={hotspot.authors.toString()} sub="unique" />
          <Stat
            label="Score"
            value={hotspot.score.toFixed(1)}
            sub="risk"
          />
        </div>

        {hotspot.authorLogins.length > 0 && (
          <section>
            <SectionTitle>Authors</SectionTitle>
            <div className="flex flex-wrap gap-1.5">
              {hotspot.authorLogins.map((login) => (
                <a
                  key={login}
                  href={`https://github.com/${login}`}
                  target="_blank"
                  rel="noopener"
                  className="text-xs px-2 py-0.5 rounded-full transition"
                  style={{
                    background: TOK.surfaceElevated,
                    color: TOK.textSecondary,
                    border: `1px solid ${TOK.border}`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = TOK.borderStrong;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = TOK.border;
                  }}
                >
                  @{login}
                </a>
              ))}
            </div>
          </section>
        )}

        {partners.length > 0 && (
          <section>
            <SectionTitle>Co-changes with</SectionTitle>
            <ul className="space-y-1">
              {partners.map((p) => (
                <li
                  key={p.path}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span className="font-mono truncate flex-1" title={p.path}>
                    {p.path}
                  </span>
                  <span
                    className="tabular-nums shrink-0"
                    style={{ color: TOK.textMuted }}
                  >
                    ×{p.count}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {commitsForFile.length > 0 && (
          <section>
            <SectionTitle>Recent commits</SectionTitle>
            <ul className="space-y-2">
              {commitsForFile.map((c) => (
                <li key={c.sha} className="text-xs">
                  <a
                    href={`https://github.com/${repo.fullName}/commit/${c.sha}`}
                    target="_blank"
                    rel="noopener"
                    className="block rounded px-2 py-1.5 -mx-2 transition"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = TOK.surfaceElevated;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                  >
                    <div
                      className="truncate"
                      style={{ color: TOK.textPrimary }}
                    >
                      {c.message}
                    </div>
                    <div
                      className="mt-0.5 flex items-center gap-2"
                      style={{ color: TOK.textMuted }}
                    >
                      <span>{c.authorLogin ?? c.authorName}</span>
                      <span>·</span>
                      <span>{new Date(c.date).toLocaleDateString()}</span>
                      <span>·</span>
                      <span className="font-mono">{c.sha.slice(0, 7)}</span>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4
      className="text-[10px] uppercase tracking-wider mb-2 font-medium"
      style={{ color: TOK.textMuted }}
    >
      {children}
    </h4>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      className="rounded-lg p-2"
      style={{
        background: TOK.surfaceElevated,
        border: `1px solid ${TOK.border}`,
      }}
    >
      <div
        className="text-[10px] uppercase tracking-wider"
        style={{ color: TOK.textMuted }}
      >
        {label}
      </div>
      <div
        className="text-lg font-semibold tabular-nums mt-0.5"
        style={{ color: TOK.textPrimary }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="text-[10px]"
          style={{ color: TOK.textMuted }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
