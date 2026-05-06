// Secret-pattern registry (v0.61 / B1).
//
// Each pattern matches a specific credential format. Designed to be
// conservative — we'd rather miss obscure keys than fire false alarms.
// All regexes use the `g` flag so the scanner can iterate matches per
// file without re-compiling.
//
// Severity guide:
//   critical  Production-grade credentials (AWS, GitHub PAT, Stripe,
//             OpenAI/Anthropic). Leaking these costs real money or
//             grants real account access.
//   high      High-impact but narrower (Google API, Slack). Still
//             worth alarming on.
//   medium    Best-effort patterns where false positives are likely
//             (generic JWT, PEM headers without key body verified).
//             Surfaced but not promoted to headline.
//
// Adding a new pattern: append one entry to PATTERNS. No other file
// needs to change. Patterns are tried in declaration order; the
// scanner doesn't bail early on first match (a single line could
// contain multiple credentials of different types).

import type { SecretPattern } from "./types";

export const PATTERNS: readonly SecretPattern[] = [
  // AWS — IAM access keys + secret access keys. AKIA prefix is the
  // canonical IAM user key; ASIA is temp session credentials.
  {
    id: "aws-access-key",
    label: "AWS Access Key ID",
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    severity: "critical",
  },

  // GitHub — Personal Access Tokens, OAuth tokens, server tokens, user
  // tokens. All share the gh{type}_ prefix + 36 base62 chars.
  {
    id: "github-token",
    label: "GitHub Token",
    regex: /\bgh[oprsu]_[A-Za-z0-9]{36}\b/g,
    severity: "critical",
  },

  // Stripe — modern live + test secret keys. The {24,} bound matches
  // both legacy (24-char) and modern (99-char) formats.
  {
    id: "stripe-secret",
    label: "Stripe Secret Key",
    regex: /\bsk_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
    severity: "critical",
  },

  // OpenAI / Anthropic — both use the `sk-` prefix. OpenAI's modern
  // project keys are `sk-proj-` + 64+ base64-ish chars; Anthropic's
  // are `sk-ant-` + similar. Plain `sk-` followed by 32+ chars catches
  // either while being narrow enough to avoid generic words.
  {
    id: "llm-api-key",
    label: "LLM API Key (OpenAI / Anthropic)",
    regex: /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{32,}\b/g,
    severity: "critical",
  },

  // Google — API keys (AIza prefix + 35 url-safe base64 chars).
  // Public-facing browser keys may legitimately appear in source, but
  // they're still worth flagging because misconfigured ones leak quota.
  {
    id: "google-api-key",
    label: "Google API Key",
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    severity: "high",
  },

  // Slack — bot, user, app tokens. xox{type}- + numeric IDs + secret.
  // Bot tokens (xoxb) most damaging if leaked.
  {
    id: "slack-token",
    label: "Slack Token",
    regex: /\bxox[abprs]-(?:\d+-){2,}[A-Za-z0-9]{24,}\b/g,
    severity: "high",
  },

  // PEM-style private keys — RSA, OpenSSH, EC, DSA, plain. Only the
  // header line is matched; the body would blow regex memory on large
  // keys. The presence of the header in source is itself the signal.
  {
    id: "pem-private-key",
    label: "Private Key (PEM)",
    regex:
      /-----BEGIN (?:RSA |OPENSSH |EC |DSA |ENCRYPTED |PGP )?PRIVATE KEY-----/g,
    severity: "critical",
  },

  // JWT-shaped tokens — three base64url segments separated by dots.
  // Often legitimate (public claims, session tokens that are meant to
  // be visible) so this is medium-severity. We require the second
  // segment to start with eyJ too — that filters out random dotted
  // base64 noise.
  {
    id: "jwt-token",
    label: "JWT-like Token",
    regex: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    severity: "medium",
  },
];
