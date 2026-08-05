// One shape for every brief, so the page renders any subject and adding a
// fourth is a file rather than a redesign.
//
// A SUBJECT EARNS A SLOT BY CROSSING TABS. That is the whole test, and it is
// what keeps this from becoming a second navigation tree on top of the first:
//
//   security   Security + Packages + Signals
//   understand Flows + Architecture + Code + Source
//   improve    Test quality + Code (duplicates) + Refactor
//
// "Refactor" and "Tests" are each a single existing tab. As subjects they would
// be a menu entry pointing at a menu entry — the problem this exists to solve,
// repeated one level up. They live inside `improve` instead.

import type { CoverageGap } from "../coverage";

export const SUBJECTS = {
  security: {
    question: "Is this safe to depend on?",
    blurb: "Secrets, advisories, dangerous calls and supply-chain incidents.",
  },
  understand: {
    question: "Where do I start?",
    blurb: "Entry points, the files everything leans on, and the biggest pieces.",
  },
  improve: {
    question: "What is worth cleaning up?",
    blurb: "Untested load-bearing code, duplication, and tests that assert little.",
  },
} as const;

export type SubjectId = keyof typeof SUBJECTS;

export const SUBJECT_IDS = Object.keys(SUBJECTS) as SubjectId[];

export function isSubjectId(x: string): x is SubjectId {
  // Object.hasOwn, NOT `in`: `"__proto__" in SUBJECTS` is true, and so are
  // "toString" and "constructor". With `in` the route would validate
  // /brief/__proto__, then look up a composer that does not exist and throw a
  // 500 where it owed a 404.
  return Object.hasOwn(SUBJECTS, x);
}

export interface BriefItem {
  /** Stable and unique within a brief. Index-prefixed where a natural key can
   *  collide — two findings on one line is a real case, not a hypothetical. */
  id: string;
  title: string;
  /** The concrete fact behind the title. Never a paraphrase, never a score. */
  evidence: string;
  /** Deep link to the surface that owns it. A brief that cannot be audited is
   *  a summary, and summaries are what this replaces. */
  href: string;
}

export interface BriefSection {
  id: string;
  label: string;
  /** What belonging to this section means. Load-bearing when a section's whole
   *  job is to hold a line — "found, not corroborated" is the security brief's
   *  entire claim. */
  note: string;
  items: BriefItem[];
}

export interface Brief {
  subject: SubjectId;
  question: string;
  /** One line under the title: where this came from and what it is not. */
  intro: string;
  sections: BriefSection[];
  /** The recorded blind spots that bear on THIS question. Not every gap — a
   *  PR-window note is real and belongs on the PRs tab. */
  gaps: CoverageGap[];
  /** Shown only when `clean`. Each subject phrases its own, because "nothing
   *  found" means something different for each question. */
  emptyHeadline: string;
  emptyDetail: string;
  /** True only when there is nothing to report AND nothing blocked us from
   *  looking. Any blocking gap keeps this false — calling an unchecked repo
   *  clean is the overclaim this whole surface exists to prevent. */
  clean: boolean;
}

/** Assemble, dropping empty sections and deciding `clean` the one honest way.
 *  Every composer ends with this so the rule cannot drift between subjects. */
export function assemble(
  subject: SubjectId,
  intro: string,
  sections: BriefSection[],
  gaps: CoverageGap[],
  empty: { headline: string; detail: string },
): Brief {
  const kept = sections.filter((s) => s.items.length > 0);
  return {
    subject,
    question: SUBJECTS[subject].question,
    intro,
    sections: kept,
    gaps,
    emptyHeadline: empty.headline,
    emptyDetail: empty.detail,
    clean: kept.length === 0 && !gaps.some((g) => g.kind === "blocking"),
  };
}
