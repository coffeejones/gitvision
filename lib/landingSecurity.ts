// The Security screen shown on the landing — a real sweep, pinned.
//
// This one is different from lib/landingSource.ts and lib/landingBlast.ts. Those
// two fed data to landing components that RE-DREW the product; the redraws
// drifted, and lib/__tests__/landingTokens.test.ts exists because of it. Here
// the landing mounts the product's OWN component — <SecurityPanel> — and this
// file is only its input. Nothing is redrawn, so nothing can drift: the four
// scanner states, their count labels, the "N curated supply-chain attacks"
// subtitle, the severity sort and the rollup arithmetic are all still
// SecurityPanel's, computed at render time from the snapshot below.
//
// That is also why this is a SNAPSHOT and not a bag of pre-computed findings.
// Handing the panel finished answers would put the derivations back on the
// landing, which is the mistake this whole arc has been undoing.
//
// WHAT IS CHOSEN, AND WHAT IS NOT
//
// Chosen: the repository. pallets/flask is a well-known Python project, so a
// stranger recognises it, and it is the same repo the landing's demo cards
// already link to.
//
// Not chosen: every number. This is the verbatim output of a sweep run through
// the product's own analyzeRepo() — see `provenance`. Four taint-confirmed
// sinks (none reachable), two risky patterns, no secrets, no incident matches.
// Re-derive after any change to the scanners; do not edit a finding to look
// better or worse.
//
// RE-DERIVE WHEN A SCANNER IS ADDED, not only when one changes. This fixture
// predated the reachability engine, so `sinkFindings` was simply absent — and
// SecurityPanel reads absent as "not scanned", which put "code paths not
// scanned" at the top of the landing's security shot for the whole week the
// engine shipped. The test now fails if any scanner lands in that state.
//
// The dependency list matters more than it looks. findIncidentMatches() reads
// outdated + vulnerable + deprecated and checks each against KNOWN_INCIDENTS,
// so pinning the real 23 packages means the Incidents card reads "Clean"
// because the check RAN AND PASSED. Drop them and it would still say "Clean" —
// but only because there was nothing to check, which is a different claim
// wearing the same words.

import type { AnalysisSnapshot } from "./types";

/** The demo session this was swept from, so the panel's links land on a real,
 *  anonymously-viewable analysis rather than a 404. See lib/demoSessions.ts. */
export const LANDING_SECURITY_SESSION_ID = "2W8VJwPfzl";

export const LANDING_SECURITY_PROVENANCE =
  "analyzeRepo('pallets', 'flask') run 2026-07-31 on ANALYZER_VERSION 8, transcribed verbatim: 4 taint-confirmed sinks (0 reachable), 2 risky patterns, 0 secrets across 95 files scanned, 23 dependency versions checked against all 10 KNOWN_INCIDENTS with no match.";

const SRC = ["examples/celery/requirements.txt"];

/** The sweep's real outdated list. Every one of these is dev-scope and comes
 *  from an EXAMPLE app's requirements file, not from Flask's own runtime
 *  dependencies — which is why the Dependencies dimension still reads healthy
 *  while these sit here. */
const OUTDATED = [
  { name: "click-plugins", current: "==1.1.1", latest: "1.1.1.2", ageMonths: 76, lastPublished: "2025-06-25T00:47:36", sources: SRC, scope: "dev" as const },
  { name: "billiard", current: "==3.6.4.0", latest: "4.2.4", ageMonths: 57, lastPublished: "2025-11-30T13:28:47", sources: SRC, scope: "dev" as const },
  { name: "click", current: "==8.1.3", latest: "8.4.2", ageMonths: 51, lastPublished: "2026-06-24T17:45:13", sources: SRC, scope: "dev" as const },
  { name: "celery", current: "==5.2.7", latest: "5.6.3", ageMonths: 47, lastPublished: "2026-03-26T12:14:49", sources: SRC, scope: "dev" as const },
  { name: "kombu", current: "==5.2.4", latest: "5.6.2", ageMonths: 46, lastPublished: "2025-12-29T20:30:05", sources: SRC, scope: "dev" as const },
  { name: "six", current: "==1.16.0", latest: "1.17.0", ageMonths: 44, lastPublished: "2024-12-04T17:35:26", sources: SRC, scope: "dev" as const },
  { name: "wcwidth", current: "==0.2.6", latest: "0.8.2", ageMonths: 42, lastPublished: "2026-06-29T18:11:09", sources: SRC, scope: "dev" as const },
  { name: "prompt-toolkit", current: "==3.0.38", latest: "3.0.53", ageMonths: 41, lastPublished: "2026-07-26T20:56:12", sources: SRC, scope: "dev" as const },
  { name: "pytz", current: "==2023.3", latest: "2026.3.post1", ageMonths: 40, lastPublished: "2026-07-25T15:12:05", sources: SRC, scope: "dev" as const },
  { name: "redis", current: "==4.5.4", latest: "8.0.1", ageMonths: 39, lastPublished: "2026-06-23T14:52:36", sources: SRC, scope: "dev" as const },
  { name: "vine", current: "==5.0.0", latest: "5.1.0", ageMonths: 38, lastPublished: "2023-11-05T08:46:51", sources: SRC, scope: "dev" as const },
  { name: "werkzeug", current: "==2.3.3", latest: "3.1.8", ageMonths: 36, lastPublished: "2026-04-02T18:49:12", sources: SRC, scope: "dev" as const },
  { name: "async-timeout", current: "==4.0.2", latest: "5.0.1", ageMonths: 35, lastPublished: "2024-11-06T16:41:37", sources: SRC, scope: "dev" as const },
  { name: "jinja2", current: "==3.1.2", latest: "3.1.6", ageMonths: 35, lastPublished: "2025-03-05T20:05:00", sources: SRC, scope: "dev" as const },
  { name: "markupsafe", current: "==2.1.2", latest: "3.0.3", ageMonths: 33, lastPublished: "2025-09-27T18:36:05", sources: SRC, scope: "dev" as const },
  { name: "amqp", current: "==5.1.1", latest: "5.3.1", ageMonths: 31, lastPublished: "2024-11-12T19:55:41", sources: SRC, scope: "dev" as const },
  { name: "click-didyoumean", current: "==0.3.0", latest: "0.3.1", ageMonths: 30, lastPublished: "2024-03-24T08:22:06", sources: SRC, scope: "dev" as const },
  { name: "click-repl", current: "==0.2.0", latest: "0.3.0", ageMonths: 25, lastPublished: "2023-06-15T12:43:48", sources: SRC, scope: "dev" as const },
  { name: "itsdangerous", current: "==2.1.2", latest: "2.2.0", ageMonths: 25, lastPublished: "2024-04-16T21:28:14", sources: SRC, scope: "dev" as const },
  { name: "blinker", current: "==1.6.2", latest: "1.9.0", ageMonths: 19, lastPublished: "2024-11-08T17:25:46", sources: SRC, scope: "dev" as const },
];

/** And the real vulnerable list — kept as VULNERABLE, not folded into the one
 *  above. Eleven advisories across three packages is a true fact about this
 *  sweep, and flattening it away to keep the fixture short would be exactly the
 *  kind of quiet edit lib/landingSource.ts warns against. */
const VULNERABLE = [
  { name: "jinja2", current: "==3.1.2", cves: ["GHSA-cpwx-vrp4-4pq7", "GHSA-gmj6-6f8f-6699", "GHSA-h5c8-rqwp-cp95", "GHSA-h75v-3vvj-5mfj", "GHSA-q2x7-8rv6-6q7h"], sources: SRC, scope: "dev" as const },
  { name: "werkzeug", current: "==2.3.3", cves: ["GHSA-29vq-49wr-vm6x", "GHSA-2g68-c3qc-8985", "GHSA-87hc-h4r5-73f7", "GHSA-f9vj-2wh5-fj8j", "GHSA-hgf8-39gv-g3f2"], sources: SRC, scope: "dev" as const },
  { name: "click", current: "==8.1.3", cves: ["PYSEC-2026-2132"], sources: SRC, scope: "dev" as const },
];

/** Typed as the product's own AnalysisSnapshot, so `tsc --noEmit` fails if the
 *  shape moves under us — a guarantee the redrawn panes had to buy with regex
 *  tests. Fields the Security screen does not read are left empty rather than
 *  invented; SecurityPanel touches only secretFindings, riskyPatternFindings
 *  and the dependency lists. */
export const LANDING_SECURITY_SNAPSHOT: AnalysisSnapshot = {
  fetchedAt: "2026-07-31T23:19:44.980Z",
  repo: {
    owner: "pallets",
    name: "flask",
    fullName: "pallets/flask",
    description: "The Python micro framework for building web applications.",
    stars: 72013,
    forks: 16922,
    watchers: 2090,
    openIssues: 7,
    defaultBranch: "main",
    createdAt: "2010-04-06T11:11:59Z",
    updatedAt: "2026-07-31T23:12:51Z",
    pushedAt: "2026-07-30T17:29:53Z",
    language: "Python",
    license: "BSD-3-Clause",
    homepage: "https://flask.palletsprojects.com",
    topics: ["flask", "jinja", "pallets", "python", "web-framework", "werkzeug", "wsgi"],
    private: false,
  },
  contributors: [],
  languages: { Python: 100 },
  recentCommits: [],
  hotspots: [],
  coChange: [],
  commitActivity: [],

  // Clean, and scanned: 95 files walked, nothing matched. The distinction is
  // the whole point of the card — `undefined` here would render "Not scanned".
  secretFindings: { findings: [], filesScanned: 95 },

  // The two the scanner found. Both are legitimate uses inside Flask's own
  // tooling, which is exactly why the product files them as informational
  // rather than as a verdict: it shows you the line and lets you judge.
  riskyPatternFindings: {
    findings: [
      {
        patternId: "py-eval",
        patternName: "eval() call",
        filePath: "src/flask/cli.py",
        line: 1023,
        snippet: 'eval(compile(f.read(), startup, "exec"), ctx)',
      },
      {
        patternId: "py-exec",
        patternName: "exec() call",
        filePath: "src/flask/config.py",
        line: 209,
        snippet: 'exec(compile(config_file.read(), filename, "exec"), d.__dict__)',
      },
    ],
  },


  // The reachability engine's own output for this sweep (v0.82+). Absent until
  // now, which made SecurityPanel render "code paths not scanned" at the top of
  // the landing's security shot — the flagship scanner advertised as one that
  // had not run, because this fixture was pinned before the engine existed.
  //
  // Four sinks, all tainted, NONE reachable. That last part is left exactly as
  // the engine returned it: two "unknown" and two "unreachable" is the honest
  // answer for a framework with no application routes of its own, and softening
  // it would be the fake version of the one panel whose whole claim is that
  // reachability is computed rather than assumed.
  //
  // The two config.py findings are a real interprocedural flow: os.environ at
  // line 124 reaches exec() through from_envvar -> from_pyfile, which is what
  // Flask's from_envvar does by design. The engine shows the hops.
  sinkFindings: {
    findings: [
      {
        filePath: "src/flask/config.py",
        ruleId: "py-path-traversal",
        severity: "high",
        line: 208,
        inFunction: "from_pyfile",
        inContainerType: "Config",
        snippet: "with open(filename, mode=\"rb\") as config_file:",
        taintedByParam: "filename",
        requiresTaint: true,
        taint: {
          source: "os.environ",
          line: 124,
          via: "filename",
          hops: [
            {
              filePath: "src/flask/config.py",
              name: "from_envvar"
            },
            {
              filePath: "src/flask/config.py",
              name: "from_pyfile"
            }
          ]
        },
        reachability: "unknown"
      },
      {
        filePath: "src/flask/config.py",
        ruleId: "py-exec",
        severity: "high",
        line: 209,
        inFunction: "from_pyfile",
        inContainerType: "Config",
        snippet: "exec(compile(config_file.read(), filename, \"exec\"), d.__dict__)",
        taintedByParam: "filename",
        taint: {
          source: "os.environ",
          line: 124,
          via: "filename",
          hops: [
            {
              filePath: "src/flask/config.py",
              name: "from_envvar"
            },
            {
              filePath: "src/flask/config.py",
              name: "from_pyfile"
            }
          ]
        },
        reachability: "unknown"
      },
      {
        filePath: "src/flask/cli.py",
        ruleId: "py-path-traversal",
        severity: "high",
        line: 1022,
        inFunction: "shell_command",
        snippet: "with open(startup) as f:",
        taint: {
          source: "os.environ",
          line: 1020,
          via: "startup"
        },
        requiresTaint: true,
        reachability: "unreachable"
      },
      {
        filePath: "src/flask/cli.py",
        ruleId: "py-eval",
        severity: "high",
        line: 1023,
        inFunction: "shell_command",
        snippet: "eval(compile(f.read(), startup, \"exec\"), ctx)",
        taint: {
          source: "os.environ",
          line: 1020,
          via: "startup"
        },
        reachability: "unreachable"
      }
    ],
    counts: {
      reachable: 0,
      unknown: 2,
      unreachable: 2,
      "module-scope": 0
    },
    total: 4,
    tainted: 4,
    entryPoints: 50
  },

  dependencyHealths: [
    {
      ecosystem: "pypi",
      total: 31,
      uniquePackages: 30,
      packageFiles: 5,
      outdated: OUTDATED,
      vulnerable: VULNERABLE,
      deprecated: [],
      components: [],
      analyzedAt: "2026-07-31T23:19:44.980Z",
    },
  ],
};
