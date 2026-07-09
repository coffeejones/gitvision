// Small display helpers shared by the /exposure index + detail pages.

import type { Ecosystem } from "@/lib/depsHealth/types";

const LABELS: Record<string, string> = {
  npm: "npm",
  pypi: "PyPI",
  cargo: "Cargo",
};

/** Pretty registry label for an ecosystem key. */
export function ECOSYSTEM_LABEL(eco: Ecosystem): string {
  return LABELS[eco] ?? eco;
}

/** ISO date → "14 Mar 2025". Sortable ISO stays the source of truth. */
export function formatIncidentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
