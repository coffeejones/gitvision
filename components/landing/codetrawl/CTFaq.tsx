// The four questions an evaluator actually asks, answered where they ask them.
//
// The landing had no FAQ anywhere, so every objection was left to be raised in
// someone's head and never answered. These four are not invented personas —
// they are the questions the product's own architecture is built around, which
// is why all four have real answers rather than reassurance:
//
//   where does my code go   → /security, written from the call sites
//   is this an LLM guessing → the analysis engine calls no AI at all
//   what does it cost       → the whole toolset is free on one repo
//   what if you disappear   → source-available, and you can run it yourself
//
// Native <details>, not a JS accordion: it works before hydration, it is
// keyboard-operable and screen-reader-announced for free, and the answers stay
// in the DOM so they are findable with the browser's own search. The one thing
// it costs is an animated height, which is not worth a state machine.

import Link from "next/link";
import { Plus } from "lucide-react";

interface Faq {
  q: string;
  /** Kept as a node so answers can link to the page that proves them — an
   *  answer a reader cannot verify is just a nicer-sounding claim. */
  a: React.ReactNode;
}

const FAQS: Faq[] = [
  {
    q: "Where does my code go?",
    a: (
      <>
        We take two temporary copies to analyze it — a metadata-only git clone
        for history, and the repository archive, because the parsers have to
        read the files — and the analysis process deletes both when it is done.
        What we keep afterwards is the result: paths, structure, symbol names,
        metrics, findings. Not your files, with a short list of named
        exceptions we spell out rather than round off.{" "}
        <Link href="/security">The whole answer is on one page</Link>, including
        the parts that are inconvenient for us.
      </>
    ),
  },
  {
    q: "Is this just an LLM guessing about my repo?",
    a: (
      <>
        No — the analysis engine calls no AI at all. The clone, the parse, the
        call graph and every signal are computed by code, and with no API key
        configured the product loses its narration and nothing else. The AI
        layer sits on top in three clearly different shapes: the health verdict
        is written from the computed signals alone, the briefing also draws on
        what the model knows about well-known projects, and the per-function
        explainer reads that one function&rsquo;s source when you click it.{" "}
        <Link href="/security">We split those out</Link> instead of claiming the
        strongest one covers all three.
      </>
    ),
  },
  {
    q: "What does it cost?",
    a: (
      <>
        Every panel is free on one repo, private repositories included — the
        source browser, the call graph, Faultline, the AI briefing, the grade.
        Nothing is held back to make the free tier feel thin. What you pay for
        is keeping more than one repo on the go, a grade on every pull request,
        and a daily re-sweep that tells you when something regressed.{" "}
        <Link href="/pricing">Plans and limits</Link>.
      </>
    ),
  },
  {
    q: "What happens if CodeTrawl disappears?",
    a: (
      <>
        The source is public and licensed under PolyForm Noncommercial, so you
        can read exactly what it does to your code and run it yourself — the{" "}
        <Link href="/agents">MCP server</Link> is one npx command and does its
        analysis on your machine, with no CodeTrawl server in the path at all.
        We are one person, not a funded team, and{" "}
        <Link href="/security">we say so plainly</Link>; that is the reason the
        escape hatch exists rather than something to discover later.
      </>
    ),
  },
];

export function CTFaq() {
  return (
    <section className="rk-faq" id="faq">
      <div className="rk-faq-head" data-rv>
        <h2 className="rk-h2">Questions worth asking first.</h2>
      </div>
      <div className="rk-faq-list" data-rv>
        {FAQS.map((f) => (
          <details className="rk-faq-item" key={f.q}>
            <summary className="rk-faq-q">
              {f.q}
              <Plus size={16} className="rk-faq-icon" aria-hidden />
            </summary>
            <div className="rk-faq-a">{f.a}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
