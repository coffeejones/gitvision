// Named, dated CI/CD supply-chain incidents used to ground each hardening
// check. The point of the panel is never "best practice says pin your actions"
// — it's "this exact thing happened on this date, here's your exposure to it".
// Verified against independent knowledge; keep the dates/names accurate.

import type { CIIncident } from "./types";

/** tj-actions/changed-files (CVE-2025-30066) — the canonical unpinned-action
 *  attack: a widely-used Action's git tags were repointed to malicious code
 *  that dumped CI secrets into build logs. Repos pinning by tag ran the
 *  backdoor; repos pinning by commit SHA did not. */
export const TJ_ACTIONS: CIIncident = {
  name: "tj-actions/changed-files backdoor (CVE-2025-30066)",
  date: "2025-03-14",
  url: "https://nvd.nist.gov/vuln/detail/CVE-2025-30066",
  summary:
    "A popular GitHub Action's tags were repointed to code that exfiltrated CI secrets to build logs; repos pinned by tag ran it, repos pinned by commit SHA were unaffected.",
};

/** The reviewdog / coordinated action compromise family (also March 2025) —
 *  reinforces that the third-party action inventory is the surface an attacker
 *  moves through, not just any single action. */
export const REVIEWDOG: CIIncident = {
  name: "reviewdog action compromise (March 2025)",
  date: "2025-03-11",
  url: "https://www.wiz.io/blog/github-action-tj-actions-changed-files-supply-chain-attack-cve-2025-30066",
  summary:
    "Several third-party Actions were compromised in a coordinated campaign, each mutable tag a way into any workflow that referenced it — the reason the third-party inventory itself is the risk surface.",
};

/** Over-broad GITHUB_TOKEN permissions turn an action compromise into a repo
 *  compromise: with write scope, injected code can push commits, publish
 *  releases, or open PRs. Least-privilege permissions cap the blast radius. */
export const PWN_REQUEST: CIIncident = {
  name: "GITHUB_TOKEN over-permission (least-privilege guidance)",
  date: "2023-06-01",
  url: "https://docs.github.com/en/actions/security-guides/automatic-token-authentication",
  summary:
    "A workflow whose GITHUB_TOKEN has write-all (or the broad repo default) lets any compromised step push code, publish releases, or open PRs; a read-only default caps the blast radius.",
};
