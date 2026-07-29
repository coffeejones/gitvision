// Disclosure report for a security finding — the "#1" layer (v0.82+).
//
// This is the AI-as-translator step, applied to security. It takes ONE
// deterministic finding the engine already produced — its rule, its
// reachability path, its taint flow — and writes a responsible-disclosure
// report a human can act on. It NEVER invents a finding: the input is a single
// ClassifiedSink, the output is prose ABOUT that sink, and the finding's
// identity, location, rule, severity, reachability and taint are passed through
// untouched. The model fills the words, not the facts.
//
// OWNERSHIP CALIBRATION — the load-bearing distinction (see the vision
// discussion): codetrawl.com analyses public repos the user does NOT own, so
// this cannot be a payload generator pointed at strangers' code.
//
//   owned        the user's own project. The trigger is a concrete
//                proof-of-concept SKETCH — the shape of the request or input
//                that exercises the path — so they can understand it and, on
//                the desktop build, confirm it locally against their own app.
//   third-party  a repo the user is only reading. The trigger stays at the
//                ATTACK CLASS plus a pointer to disclose to the owner. No
//                copy-paste payload. Same responsible-disclosure line the
//                original brief drew.
//
// Even for owned code this stays a report, not a weapon: a sketch of what to
// send, not a packaged exploit. Actually FIRING it — the local dynamic
// confirmation — is the separate desktop "#2" pillar, deliberately not here.
//
// Privacy: transmits the finding's snippet + path to Anthropic on an explicit
// action, one finding at a time, never stored. Returns null when
// ANTHROPIC_API_KEY is unset so callers hide the feature without special-casing.

import Anthropic from "@anthropic-ai/sdk";
import type { ClassifiedSink } from "./reachability";
import { formatPath, sinkRuleLabel } from "./reachability";
import { formatTaintFlow } from "./interproceduralTaint";

// Same call class as every other AI feature here: a constrained "read these
// facts, write a short grounded report" task, not deep reasoning. The aiBudget
// kill-switch bounds cost either way.
export const DISCLOSURE_MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 700;

export type FindingOwnership = "owned" | "third-party";

export interface DisclosureReport {
  /** The finding this report is about. Derived from the finding, NOT authored
   *  by the model — the structural guarantee that the AI cannot mint a new
   *  finding: a report always points back at exactly one deterministic sink. */
  findingKey: string;
  /** One line naming the vulnerability class. */
  title: string;
  /** How untrusted input reaches the sink, grounded in the computed path. */
  howReached: string;
  /** What an attacker gains by exercising it. */
  impact: string;
  /** The trigger. Concrete input-shape sketch for owned code; attack class only
   *  for third-party. */
  trigger: string;
  /** The remediation. */
  fix: string;
  /** Responsible-disclosure guidance. Present for third-party findings only. */
  disclosure?: string;
  /** Echoes the calibration the report was written under, so the UI can badge
   *  "sketch shown because this is your repo" vs. "disclose to owner". */
  ownership: FindingOwnership;
  model: string;
  generatedAt: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Stable identity for a finding — the same key classifySinks/unifiedFindings
 *  use, so a report can never drift onto a different finding. */
export function findingKeyOf(f: {
  filePath: string;
  line: number;
  ruleId: string;
}): string {
  return `${f.filePath}:${f.line}:${f.ruleId}`;
}

const SYSTEM_PROMPT = `You are a security engineer writing a responsible-disclosure report for ONE vulnerability that a static analyzer has already found and confirmed reachable. You are given the analyzer's deterministic facts — the vulnerability class, the exact file and line, the code at the sink, the call path from the entry point, and (when known) the flow of untrusted input into it. Treat every one of those facts as ground truth. They are computed, not guessed.

Your job is to TRANSLATE those facts into a report a developer can act on. You are NOT finding new issues, NOT reviewing the surrounding code, NOT speculating about other vulnerabilities. Write only about the one finding you were given.

OWNERSHIP determines how concrete the trigger may be, and it is non-negotiable:
- ownership = "owned": the reader owns this code. The "trigger" is a concrete proof-of-concept SKETCH — describe the shape of the HTTP request or input that would exercise this exact path (method, route, which parameter carries the payload, and the KIND of value that reaches the sink). It is a sketch to understand and locally confirm, NOT a packaged exploit script. Do not output a runnable attack tool.
- ownership = "third-party": the reader does NOT own this code. The "trigger" must stay at the ATTACK CLASS in general terms only — name what category of attack this is and what an attacker would target, with NO specific payload, NO exact request a person could copy and send. Then the "disclosure" field explains that the correct action is to report this privately to the project's maintainers, never to exploit it.

HARD RULES (break one and the report is unusable):
- Output VALID JSON ONLY, this exact shape: {"title": "...", "howReached": "...", "impact": "...", "trigger": "...", "fix": "...", "disclosure": "..."}. Set "disclosure" to null when ownership is "owned".
- Ground every sentence in a fact you were given. Cite the real route, parameter, and file:line. NEVER invent a route, parameter, function, or behavior you were not told about.
- "howReached" must describe the ACTUAL path you were given, in plain language — entry point, the hops, the sink. Do not embellish it with steps that are not in the path.
- "impact" is about THIS sink's class (e.g. remote code execution for a deserialization sink, data disclosure/modification for SQL injection). Do not inflate beyond what the sink class supports.
- For third-party: absolutely no concrete payload, request body, or copy-pasteable input in ANY field. If you are tempted to write one, describe the class instead.
- Each field is 1-3 sentences. No markdown, no headings, no code fences. You MAY name an exact identifier or route inline.
- Output the JSON object and nothing else.`;

/** Build the exact user message sent to the model, from the finding alone.
 *  Pure and exported so a test can assert it contains only facts derived from
 *  the finding — the model gets no other material to work from. */
export function buildDisclosureUserContent(
  finding: ClassifiedSink,
  ownership: FindingOwnership,
): string {
  const facts: Record<string, unknown> = {
    ownership,
    vulnerabilityClass: sinkRuleLabel(finding.ruleId),
    ruleId: finding.ruleId,
    severity: finding.severity,
    location: `${finding.filePath}:${finding.line}`,
    reachability: finding.reachability,
    codeAtSink: finding.snippet,
  };
  if (finding.path) {
    facts.entryPoint = finding.path.entry.route
      ? `${finding.path.entry.methods?.join("/") ?? "ANY"} ${finding.path.entry.route}`
      : finding.path.entry.name;
    facts.callPath = formatPath(finding.path);
  }
  if (finding.taint) {
    facts.untrustedInputFlow = formatTaintFlow(finding.taint);
    facts.untrustedSource = finding.taint.source;
  }
  return (
    `Write the disclosure report for this finding.\n\n` +
    `Deterministic facts (ground truth):\n${JSON.stringify(facts, null, 2)}`
  );
}

interface ParsedProse {
  title: string;
  howReached: string;
  impact: string;
  trigger: string;
  fix: string;
  disclosure: string | null;
}

/** Parse the model's JSON into the prose fields. Pure. Coerces junk to empty /
 *  null rather than throwing, and on non-JSON surfaces the raw text in `impact`
 *  so a prompt regression is visible instead of silent. */
export function parseDisclosure(rawText: string): ParsedProse {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  try {
    const p = JSON.parse(cleaned) as Record<string, unknown>;
    const disc = str(p.disclosure);
    return {
      title: str(p.title),
      howReached: str(p.howReached),
      impact: str(p.impact),
      trigger: str(p.trigger),
      fix: str(p.fix),
      disclosure: disc && !/^(null|none|n\/a)$/i.test(disc) ? disc : null,
    };
  } catch {
    return {
      title: "",
      howReached: "",
      impact: `Model returned an unparseable response: ${cleaned.slice(0, 300)}`,
      trigger: "",
      fix: "",
      disclosure: null,
    };
  }
}

/** Generate a disclosure report for one finding. Returns null when the API key
 *  is unset (feature disabled). Throws only on a genuine API error.
 *
 *  The finding's own fields are the CONTRACT: this reports on exactly the sink
 *  passed in, keyed by its identity, and the model can only supply prose. There
 *  is no path by which it introduces a finding that was not in the input. */
export async function generateDisclosure(
  finding: ClassifiedSink,
  ownership: FindingOwnership,
): Promise<DisclosureReport | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const client = new Anthropic();
  const response = await client.messages.create({
    model: DISCLOSURE_MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: buildDisclosureUserContent(finding, ownership) },
    ],
  });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const prose = parseDisclosure(rawText);

  return {
    // Identity comes from the finding, never the model.
    findingKey: findingKeyOf(finding),
    title: prose.title,
    howReached: prose.howReached,
    impact: prose.impact,
    trigger: prose.trigger,
    fix: prose.fix,
    // A third-party report keeps its disclosure guidance; an owned one drops it.
    ...(ownership === "third-party" && prose.disclosure
      ? { disclosure: prose.disclosure }
      : {}),
    ownership,
    model: DISCLOSURE_MODEL,
    generatedAt: new Date().toISOString(),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
  };
}
