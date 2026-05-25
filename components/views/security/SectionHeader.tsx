// Shared section header for /session/[id]/security sections.
// Title + subtitle on the left, status pill on the right. Status
// color drives the visual urgency: rose for findings, emerald for
// clean, muted for "scan not available".

import { TOK } from "@/lib/theme";

interface Props {
  title: string;
  subtitle: string;
  statusLabel: string;
  statusColor: string;
}

export function SectionHeader({
  title,
  subtitle,
  statusLabel,
  statusColor,
}: Props) {
  return (
    <header
      className="flex items-start justify-between gap-4 pb-3"
      style={{ borderBottom: `1px solid ${TOK.border}` }}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <h2
          className="text-base font-semibold tracking-tight"
          style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
        >
          {title}
        </h2>
        <p
          className="text-xs leading-relaxed"
          style={{ color: TOK.textMuted }}
        >
          {subtitle}
        </p>
      </div>
      <span
        className="text-[10px] uppercase tracking-[0.14em] font-semibold px-2 py-0.5 rounded flex-shrink-0"
        style={{
          background: `${statusColor}1a`,
          color: statusColor,
          border: `1px solid ${statusColor}40`,
        }}
      >
        {statusLabel}
      </span>
    </header>
  );
}
