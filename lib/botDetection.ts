// Bot-author detection — used by:
//   - lib/signals.ts (PR cycle-time + throughput metrics should reflect
//     human workflow, not bot churn)
//   - lib/githubApp/events/pullRequest.ts (skip analysis on bot-opened
//     PRs so we don't comment on Dependabot etc.)
//
// Both surfaces must agree on what counts as a bot — keeping the rules
// in one place prevents drift between them.

export const BOT_LOGIN_PATTERNS: RegExp[] = [
  /\[bot\]$/i,
  /-bot$/i,
  /^bot-/i,
  /^dependabot/i,
  /^renovate/i,
  /^github-actions/i,
  /^vercel-release/i,
  /^mergify/i,
  /^codecov/i,
  /^snyk-bot/i,
  /^greenkeeper/i,
  /^imgbot/i,
];

export function isBotAuthor(login: string | null | undefined): boolean {
  if (!login) return false;
  return BOT_LOGIN_PATTERNS.some((re) => re.test(login));
}
