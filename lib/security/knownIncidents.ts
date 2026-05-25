// Known supply-chain incident database (v0.81+, signal #19).
//
// Curated list of well-documented attacks where specific package
// versions are KNOWN to be compromised. The detector here only
// reports matches — it never claims "this code IS malicious", just
// "this version matches a known incident; review manually". The
// brand promise of zero false positives means we err strongly on
// the side of "only ship patterns where ground truth is publicly
// documented (CVE, security advisory, post-mortem blog post)".
//
// What we DON'T do here:
//   - General-purpose backdoor detection (heuristic, high FP rate)
//   - Behavioral analysis (computationally hard, low signal)
//   - Matching against the broader CVE database (Snyk/GitHub Advisory
//     already cover that; vulnerable-deps signal surfaces it)
//
// What this catches: the cases where a maintainer's account was
// compromised or a maintainer themselves shipped malicious code —
// supply-chain attacks where the package + version is the smoking
// gun. These get missed by CVE scanners when the advisory comes
// out late, and they get drowned out in "outdated-deps" lists.
//
// Curation guidelines for new entries:
//   - Public advisory exists (GHSA, NVD, or reputable blog)
//   - Specific version strings are documented as compromised
//   - Incident was confirmed by maintainer or post-mortem
//   - At least 6 months elapsed (we want documented, not breaking
//     news where details may still shift)
//
// Review cadence: quarterly. When adding entries, link the
// reference URL so future maintainers can verify the claim.

import type {
  AnalysisSnapshot,
  Ecosystem,
  HealthSignal,
} from "@/lib/types";

export interface KnownIncident {
  /** Stable id, kebab-case. Used in evidence + future filtering. */
  id: string;
  /** Display name shown in card title. */
  name: string;
  /** One-sentence summary of what the attack did. Kept terse so it
   *  reads in a card; full context lives at the reference URL. */
  shortDescription: string;
  /** Authoritative reference (GHSA advisory, CVE entry, or
   *  maintainer post-mortem). Surfaced in the evidence note. */
  reference: string;
  /** ISO date the incident became public. Helps users decide
   *  whether their lockfile predates discovery. */
  discoveredAt: string;
  affectedPackages: AffectedPackage[];
}

export interface AffectedPackage {
  ecosystem: Ecosystem;
  name: string;
  /** Specific version strings known to be compromised. We match
   *  with substring containment (not strict equality) so version
   *  prefixes like "==", "^", "~" don't break detection. */
  compromisedVersions: string[];
}

/** Curated database. Order doesn't matter; the detector iterates
 *  all entries. Add new incidents at the end with a clear comment. */
export const KNOWN_INCIDENTS: KnownIncident[] = [
  {
    id: "eslint-config-prettier-2025",
    name: "eslint-config-prettier supply-chain (2025)",
    shortDescription:
      "Maintainer's npm token was phished; malicious versions executed an install.js that dropped a node-gyp.dll malware payload on Windows installs.",
    // Specific GitHub Advisory — durable and informative. CVE-2025-54313.
    reference: "https://github.com/advisories/GHSA-f29h-pxvx-f335",
    discoveredAt: "2025-07-19",
    affectedPackages: [
      {
        ecosystem: "npm",
        name: "eslint-config-prettier",
        compromisedVersions: ["8.10.1", "9.1.1", "10.1.6", "10.1.7"],
      },
    ],
  },
  {
    id: "solana-web3-js-2024",
    name: "@solana/web3.js supply-chain (December 2024)",
    shortDescription:
      "Compromised maintainer token led to two malicious releases that exfiltrate Solana private keys at runtime.",
    // Snyk advisory page — durable + informative. Tracks the
    // SNYK-JS-SOLANAWEB3JS-8453984 entry covering versions 1.95.6-1.95.7.
    reference: "https://security.snyk.io/package/npm/%40solana%2Fweb3.js",
    discoveredAt: "2024-12-03",
    affectedPackages: [
      {
        ecosystem: "npm",
        name: "@solana/web3.js",
        compromisedVersions: ["1.95.6", "1.95.7"],
      },
    ],
  },
  {
    id: "colors-faker-sabotage-2022",
    name: "colors.js / faker.js maintainer sabotage (January 2022)",
    shortDescription:
      "Marak Squires intentionally pushed broken releases that print zalgo text and infinite-loop, breaking thousands of downstream builds.",
    reference: "https://github.com/Marak/colors.js/issues/285",
    discoveredAt: "2022-01-08",
    affectedPackages: [
      {
        ecosystem: "npm",
        name: "colors",
        compromisedVersions: ["1.4.1", "1.4.2", "1.4.44-liberty-2"],
      },
      {
        ecosystem: "npm",
        name: "faker",
        compromisedVersions: ["6.6.6"],
      },
    ],
  },
  {
    id: "ua-parser-js-2021",
    name: "ua-parser-js supply-chain (October 2021)",
    shortDescription:
      "Maintainer's npm credentials were compromised; published versions installed a crypto-miner plus a password-stealing payload on Windows hosts.",
    reference: "https://github.com/faisalman/ua-parser-js/issues/536",
    discoveredAt: "2021-10-22",
    affectedPackages: [
      {
        ecosystem: "npm",
        name: "ua-parser-js",
        compromisedVersions: ["0.7.29", "0.8.0", "1.0.0"],
      },
    ],
  },
  {
    id: "event-stream-2018",
    name: "event-stream / flatmap-stream backdoor (November 2018)",
    shortDescription:
      "A new maintainer added 'flatmap-stream' as a nested dependency; it shipped a backdoor that exfiltrated Bitcoin wallet credentials from the Copay app.",
    reference: "https://github.com/dominictarr/event-stream/issues/116",
    discoveredAt: "2018-11-26",
    affectedPackages: [
      {
        ecosystem: "npm",
        name: "flatmap-stream",
        compromisedVersions: ["0.1.1"],
      },
      {
        ecosystem: "npm",
        name: "event-stream",
        // event-stream itself wasn't compromised, but 3.3.6 was the
        // version that pulled the malicious flatmap-stream. Flag it
        // so users who locked to 3.3.6 know to bump.
        compromisedVersions: ["3.3.6"],
      },
    ],
  },
  {
    id: "rc-2021",
    name: "rc supply-chain (November 2021)",
    shortDescription:
      "Maintainer's npm token was compromised; attacker published malicious versions that ran a credential-stealing payload during install.",
    reference: "https://github.com/advisories/GHSA-g2q5-5433-rhrf",
    discoveredAt: "2021-11-25",
    affectedPackages: [
      {
        ecosystem: "npm",
        name: "rc",
        compromisedVersions: ["1.2.9", "1.3.9", "2.3.9"],
      },
    ],
  },
  {
    id: "node-ipc-protestware-2022",
    name: "node-ipc protestware / wiper (March 2022)",
    shortDescription:
      "Maintainer Brandon Nozaki Miller shipped versions that overwrite filesystem contents with heart emoji on machines geolocating to Russia or Belarus.",
    reference: "https://github.com/advisories/GHSA-97m3-w2cp-4xx6",
    discoveredAt: "2022-03-15",
    affectedPackages: [
      {
        ecosystem: "npm",
        name: "node-ipc",
        compromisedVersions: ["10.1.1", "10.1.2"],
      },
    ],
  },
  {
    id: "ctx-pypi-2022",
    name: "ctx (PyPI) takeover (May 2022)",
    shortDescription:
      "Attacker took over the abandoned 'ctx' package on PyPI and published versions that exfiltrate environment variables (AWS keys, tokens) on import.",
    // Specific GitHub Advisory — "Malware in ctx" entry.
    reference: "https://github.com/advisories/GHSA-4g82-3jcr-q52w",
    discoveredAt: "2022-05-24",
    affectedPackages: [
      {
        ecosystem: "pypi",
        name: "ctx",
        compromisedVersions: ["0.2.2", "0.2.6", "0.2.7", "0.2.8"],
      },
    ],
  },
  {
    id: "rustdecimal-typosquat-2022",
    name: "rustdecimal typosquat (May 2022)",
    shortDescription:
      "Typosquat of the legitimate 'rust_decimal' crate. Published to crates.io with a malicious binary payload that downloads + executes second-stage code.",
    // Official RustSec advisory (Rust Security Working Group) — more
    // durable than the original SentinelOne blog URL, which moved.
    reference: "https://rustsec.org/advisories/RUSTSEC-2022-0049.html",
    discoveredAt: "2022-05-10",
    affectedPackages: [
      {
        ecosystem: "cargo",
        // No underscore — this is the typosquat. The legitimate crate
        // is `rust_decimal` (with underscore). Any version of the
        // un-underscored name is the malicious one.
        name: "rustdecimal",
        compromisedVersions: ["1.23.1"],
      },
    ],
  },
  {
    id: "lottiefiles-lottie-player-2024",
    name: "@lottiefiles/lottie-player supply-chain (October 2024)",
    shortDescription:
      "Maintainer's npm credentials compromised; attackers published versions injecting a Web3 wallet-drainer into thousands of downstream sites.",
    // Independent news coverage with verifiable detail — the LottieFiles
    // incident wasn't routed through GitHub Advisory Database.
    reference:
      "https://www.bleepingcomputer.com/news/security/lottiefiles-hacked-in-supply-chain-attack-to-steal-users-crypto/",
    discoveredAt: "2024-10-30",
    affectedPackages: [
      {
        ecosystem: "npm",
        name: "@lottiefiles/lottie-player",
        compromisedVersions: ["2.0.5", "2.0.6", "2.0.7"],
      },
    ],
  },
];

/** Per-incident match payload used by the Security page (#19 +
 *  /security route, v0.81+). The detector in lib/signals.ts aggregates
 *  ALL matches into a single signal for the Health-at-a-Glance + Signals
 *  tab — that's the right unit there. The Security tab wants per-
 *  incident cards with full metadata (advisory URL, discovery date),
 *  which is what this richer shape carries. */
export interface IncidentMatch {
  incident: KnownIncident;
  /** The actual packages in the snapshot that matched. Each entry is
   *  the same wire-format used in signal evidence: [ecosystem] name@version. */
  matchedPackages: string[];
}

/** Collect every (ecosystem, name, current-version) tuple visible in
 *  the snapshot's dependencyHealths. Combines outdated + vulnerable +
 *  deprecated arrays — compromised packages typically land in one of
 *  these once the advisory drops. */
function packagesFromSnapshot(snap: AnalysisSnapshot): Array<{
  ecosystem: Ecosystem;
  name: string;
  current: string;
}> {
  const healths =
    snap.dependencyHealths ??
    (snap.dependencyHealth ? [snap.dependencyHealth] : []);
  const out: Array<{ ecosystem: Ecosystem; name: string; current: string }> =
    [];
  for (const h of healths) {
    for (const d of [...h.outdated, ...h.vulnerable, ...h.deprecated]) {
      out.push({ ecosystem: h.ecosystem, name: d.name, current: d.current });
    }
  }
  return out;
}

/** Pure match walker — returns per-incident matches without
 *  wrapping them in signal shape. Used by:
 *    - detectKnownIncidents (wraps result into a single aggregated
 *      HealthSignal for the Signals tab + Health-at-a-Glance)
 *    - /session/[id]/security page (renders per-incident cards with
 *      full metadata)
 *
 *  Returns [] when there's nothing to scan or no matches found. */
export function findIncidentMatches(snap: AnalysisSnapshot): IncidentMatch[] {
  const pkgs = packagesFromSnapshot(snap);
  if (pkgs.length === 0) return [];

  const out: IncidentMatch[] = [];
  for (const incident of KNOWN_INCIDENTS) {
    const matchedPackages: string[] = [];
    for (const pkg of pkgs) {
      for (const affected of incident.affectedPackages) {
        if (affected.ecosystem !== pkg.ecosystem) continue;
        if (affected.name !== pkg.name) continue;
        for (const ver of affected.compromisedVersions) {
          if (pkg.current.includes(ver)) {
            matchedPackages.push(
              `[${pkg.ecosystem}] ${pkg.name}@${pkg.current}`,
            );
            break;
          }
        }
      }
    }
    if (matchedPackages.length > 0) {
      out.push({ incident, matchedPackages });
    }
  }
  return out;
}

/** Walk the curated incident DB against the snapshot's packages and
 *  emit a single aggregated signal for the Signals tab + Health-at-a-
 *  Glance. The richer per-incident shape is available via
 *  findIncidentMatches; this function exists to satisfy the
 *  HealthSignal contract that extractHealthSignals iterates.
 *
 *  Always returns [] when no matches occur — the signal only appears
 *  when we have something to say. */
export function detectKnownIncidents(
  snap: AnalysisSnapshot,
): HealthSignal[] {
  const matches = findIncidentMatches(snap);
  if (matches.length === 0) return [];

  const totalPackages = matches.reduce(
    (sum, m) => sum + m.matchedPackages.length,
    0,
  );
  const allPaths = matches.flatMap((m) => m.matchedPackages);
  const noteLines = matches.map(
    (m) =>
      `${m.incident.name} — discovered ${m.incident.discoveredAt} — ${m.incident.reference}`,
  );

  // Conservative wording: "Possible match" not "Compromised". Users
  // make the final call after reviewing the reference.
  const isSingle = matches.length === 1;
  const titleSuffix = isSingle
    ? matches[0].incident.name
    : `${matches.length} known incidents`;

  return [
    {
      id: "known-incident-match",
      title: `Possible match — ${titleSuffix}`,
      detail: `${totalPackages} dependenc${totalPackages === 1 ? "y" : "ies"} match version${totalPackages === 1 ? "" : "s"} from ${isSingle ? "a known supply-chain incident" : "known supply-chain incidents"}. Verify against the linked advisory before treating as a confirmed compromise.`,
      evidence: {
        paths: allPaths,
        note: noteLines.join(" | "),
        numbers: {
          incidents: matches.length,
          packages: totalPackages,
        },
      },
      severity: "high",
    },
  ];
}
