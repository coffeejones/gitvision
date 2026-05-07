// /help — long-form documentation for GitVision's mental models
// (v0.73). Scrollable single page with anchor-linkable sections so
// in-app <HelpHint anchor="..." /> icons can deep-link to the
// concept the user just asked about.
//
// Why one long page instead of a multi-page docs site:
//   - The whole site fits comfortably in 7 sections; splitting them
//     across pages doubles navigation cost without adding clarity
//   - Anchor scrolling is faster than route navigation for cross-
//     references between sections
//   - Easier to maintain — one file, one table of contents
//
// What this page is NOT for:
//   - Marketing copy ("Welcome to GitVision!"). The home page
//     already does that.
//   - API reference. We don't expose a public API.
//   - Tutorials. Walk-through content lives in blog posts (TBD).
//
// What this page IS for:
//   - Mental models a first-time user can't infer from the UI
//     (McCabe complexity, blast radius, snapshot vs session, etc.)
//   - Edge-case behaviors worth surfacing (overload collapsing,
//     constructor `new` rendering, generic-type peeling)
//   - The "why" behind decisions that look weird but aren't bugs

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { STYLE, TOK } from "@/lib/theme";

export const metadata = {
  title: "Help — GitVision",
  description:
    "How the panels, signals, and diagrams in GitVision work — the mental models behind the UI.",
};

interface SectionMeta {
  id: string;
  title: string;
  hint: string;
}

const SECTIONS: SectionMeta[] = [
  {
    id: "sessions-snapshots",
    title: "Sessions & snapshots",
    hint: "What gets saved, what refresh means, why URLs are shareable",
  },
  {
    id: "code-panel",
    title: "Code panel",
    hint: "File browser, complexity chips, overloads, constructors",
  },
  {
    id: "blast-radius",
    title: "Blast radius",
    hint: "Callers, callees, hops, file-level vs function-level",
  },
  {
    id: "imports",
    title: "Imports tab",
    hint: "File-level dependency canvas, layers, edge kinds",
  },
  {
    id: "architecture",
    title: "Architecture tab",
    hint: "Class canvas, edge types, filters, Mermaid export",
  },
  {
    id: "dep-health",
    title: "Dependency health",
    hint: "Outdated, deprecated, vulnerable packages across ecosystems",
  },
  {
    id: "untested-duplicates",
    title: "Untested hotspots & near-duplicates",
    hint: "Coverage detection, complexity ranking, AST duplicate groups",
  },
];

export default function HelpPage() {
  return (
    <main className="max-w-3xl w-full mx-auto px-8 pt-16 pb-20 flex flex-col gap-10">
      <div>
        <Link
          href="/"
          className="text-xs inline-flex items-center gap-1.5 transition hover:underline"
          style={{ color: TOK.textSecondary }}
        >
          <ArrowLeft size={12} />
          Back to GitVision
        </Link>
      </div>

      <header className="flex flex-col gap-3">
        <span className={STYLE.eyebrow} style={{ color: TOK.textSecondary }}>
          Help
        </span>
        <h1
          className="text-4xl font-semibold tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          How the panels and signals work.
        </h1>
        <p
          className="text-base leading-relaxed"
          style={{ color: TOK.textSecondary }}
        >
          GitVision packs a lot into each tab. This page explains the
          mental models — what the numbers mean, why the diagrams look
          the way they do, and the edge cases that trip people up. Click
          a section in the table of contents to jump straight there.
        </p>
      </header>

      <TableOfContents />

      <Section id="sessions-snapshots" title="Sessions & snapshots">
        <P>
          A <strong>session</strong> is a saved analysis of one repo. You
          create one by pasting a public GitHub URL on the home page.
          Each session has a stable URL — bookmark it, share it, come
          back to it later.
        </P>
        <P>
          A <strong>snapshot</strong> is a point-in-time slice of that
          session. Every time you click <strong>Refresh</strong>, GitVision
          re-fetches the repo, re-runs the full analysis pipeline, and
          stores the result as a new snapshot inside the same session.
          Old snapshots aren&apos;t deleted — they&apos;re kept so we can
          diff between them.
        </P>
        <P>
          That diff drives the &quot;Since your last visit&quot; banner
          on the Overview, the Structural changes panel below it, and
          health-tile delta arrows. The first snapshot has nothing to
          compare against, so those affordances stay hidden until you
          refresh at least once.
        </P>
        <P>
          <strong>Sessions are not access-controlled.</strong> Anyone with
          the URL can open them. The home-page list filters by an
          anonymous owner-id stored in your browser&apos;s localStorage
          — that&apos;s soft isolation, not a permission boundary. If
          you analyzed a sensitive repo, don&apos;t paste the session URL
          publicly.
        </P>
      </Section>

      <Section id="code-panel" title="Code panel">
        <P>
          The Code tab shows your repo as a list of files sorted by{" "}
          <strong>file complexity</strong> (sum of McCabe complexity for
          every function in the file). Heavy files float to the top —
          those are the ones with the most branches, the most loops, the
          most reasons to break.
        </P>
        <P>
          Click a file. The right side becomes <strong>Blast radius
          for </strong> that file (see the next section). Below the file
          path, you&apos;ll see a strip of <strong>chips</strong> — one
          per top function in the file, sorted by complexity descending.
          Each chip carries:
        </P>
        <Bullets>
          <li>
            <strong>Function name</strong> — prefixed with the class /
            container if there is one (<Code>LogInService.login</Code>).
          </li>
          <li>
            <strong>A complexity number</strong> — McCabe cyclomatic
            complexity. Roughly &quot;number of independent paths through
            the function.&quot; 1 = straight line, 5–7 = a complex branch,
            10+ = candidate for refactoring.
          </li>
          <li>
            <strong>
              <Code>×N</Code> overload marker
            </strong>{" "}
            — when N functions in the same class share a name (Java /
            C# overloads like <Code>login(String)</Code> vs{" "}
            <Code>login(String, String)</Code>), they collapse into one
            chip. The blast-radius graph can&apos;t distinguish between
            them at the call-site level, so showing them as separate
            chips would imply more precision than we actually have.
          </li>
          <li>
            <strong>
              <Code>new ClassName</Code>
            </strong>{" "}
            — Java and C# name constructors after the class itself, which
            would otherwise render as <Code>ClassName.ClassName</Code> and
            read like the class is duplicated. The <Code>new</Code> prefix
            disambiguates.
          </li>
        </Bullets>
        <P>
          Click any chip to <strong>zoom in</strong> from file-level to
          function-level blast radius for that specific function.
        </P>
      </Section>

      <Section id="blast-radius" title="Blast radius">
        <P>
          Blast radius answers two questions:
        </P>
        <Bullets>
          <li>
            <strong>Callers</strong> — &quot;if I change this, what
            breaks?&quot; The set of functions (or files) that depend on
            this one, transitively.
          </li>
          <li>
            <strong>Callees</strong> — &quot;what does this depend on?&quot;
            The set of functions this one calls, transitively.
          </li>
        </Bullets>
        <P>
          Each result is shown grouped by <strong>hop count</strong> — 1 =
          direct caller / callee, 2 = caller-of-a-caller, 3 = three
          layers out. We cap at 3 hops by default because the noise grows
          faster than the signal past that.
        </P>
        <P>
          When you see <Code>200+</Code> instead of a precise count,
          we&apos;ve hit the per-direction node cap. The real number is
          higher — the cap is there so a single &quot;hub&quot; function
          (one that calls hundreds of utilities) doesn&apos;t blow up the
          BFS or the UI.
        </P>
        <P>
          <strong>File-level vs function-level.</strong> When you select
          a file but no specific function, blast radius unions all the
          functions in that file — useful for the &quot;if I touch this
          file, what touches it back?&quot; question. Click a chip in the
          function strip to drill down to one specific function.
        </P>
      </Section>

      <Section id="imports" title="Imports tab">
        <P>
          The Imports tab is a <strong>file-level</strong> dependency
          canvas — every box is a file, every edge is an import (or an
          extends / implements / renders relationship for the languages
          where we extract those). Different from the Architecture tab,
          which works at the <em>class</em> level.
        </P>
        <P>
          The layout is <strong>BFS depth-layered</strong>. Files with
          zero incoming edges (entry points: app routes, main scripts,
          public APIs) sit at the top. Leaf utilities — files that only
          export, never import — sit at the bottom. Layers in between
          form the dependency chain that connects them.
        </P>
        <P>
          Node colors come from the file extension (TypeScript = blue,
          Java = orange, etc.). Edge colors come from the kind:
        </P>
        <Bullets>
          <li>
            <strong>Import</strong> (default) — module dependency
          </li>
          <li>
            <strong>Renders</strong> — JSX / TSX component reference
          </li>
          <li>
            <strong>Extends</strong> — class inheritance
          </li>
          <li>
            <strong>Implements</strong> — interface realization
          </li>
        </Bullets>
        <P>
          Click any file to <strong>highlight neighbors</strong> — direct
          imports on either side stay opaque, the rest dim. Click the
          empty canvas to clear.
        </P>
      </Section>

      <Section id="architecture" title="Architecture tab">
        <P>
          The Architecture tab is a <strong>class-level</strong> diagram —
          one box per class / interface / enum, with their fields,
          methods, and relationships. Different from Imports (which is
          file-level): a single file can hold multiple classes, and a
          single class diagram skips files that have no classes at all.
        </P>
        <P>
          The default view is the <strong>interactive canvas</strong>{" "}
          (ReactFlow + Dagre auto-layout). Below it is a collapsible{" "}
          <strong>&quot;Show Mermaid source&quot;</strong> disclosure —
          for sharing the diagram outside the app (paste into a README,
          a blog post, or{" "}
          <a
            href="https://mermaid.live"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2"
          >
            mermaid.live
          </a>
          ).
        </P>
        <P>
          <strong>Edge types:</strong>
        </P>
        <Bullets>
          <li>
            <strong>Extends</strong> — solid line, filled triangle
            (inheritance)
          </li>
          <li>
            <strong>Implements</strong> — dashed line, filled triangle
            (interface realization)
          </li>
          <li>
            <strong>Association</strong> — solid line, open arrow, with
            the field name as a label. Drawn whenever a class has a field
            whose type is another rendered class. Spring DI&apos;s{" "}
            <Code>private final FooService fooService</Code> is the
            textbook case.
          </li>
        </Bullets>
        <P>
          <strong>Generic peeling.</strong> A field of type{" "}
          <Code>List&lt;Card&gt;</Code> draws an arrow to <Code>Card</Code>,
          not to <Code>List</Code>. Same for Go slices (<Code>[]Foo</Code>),
          maps (<Code>map[K]V</Code>), pointers (<Code>*Foo</Code>), and
          nullable types (<Code>Foo?</Code>) across all supported
          languages.
        </P>
        <P>
          <strong>Filters</strong> handle big repos: &quot;Hide
          unconnected&quot; drops classes with zero edges (typical Props /
          State interface noise), and the search input filters by
          substring on class name. Both trigger a layout recompute, so
          remaining classes pack tightly instead of spreading across the
          original full-set bounding box.
        </P>
      </Section>

      <Section id="dep-health" title="Dependency health">
        <P>
          The Packages tab inspects your repo&apos;s manifest files (
          <Code>package.json</Code>, <Code>pyproject.toml</Code>,{" "}
          <Code>Cargo.toml</Code>, <Code>composer.json</Code>,{" "}
          <Code>Gemfile</Code>, etc.) and pulls metadata from each
          ecosystem&apos;s registry plus security data from{" "}
          <a
            href="https://osv.dev"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2"
          >
            OSV.dev
          </a>
          .
        </P>
        <P>
          For each package we surface:
        </P>
        <Bullets>
          <li>
            <strong>Outdated</strong> — installed version is behind the
            latest published. Soft signal; not always actionable.
          </li>
          <li>
            <strong>Deprecated</strong> — the maintainer marked the
            package end-of-life. Strong signal; plan migration.
          </li>
          <li>
            <strong>Vulnerable</strong> — a CVE matches the installed
            version, severity from the OSV record. Hard signal; act fast.
          </li>
          <li>
            <strong>Abandoned</strong> — no commits / releases for an
            extended window (heuristic, varies by ecosystem). Soft
            signal; cross-check with the project&apos;s own communication.
          </li>
        </Bullets>
        <P>
          <strong>Multi-ecosystem.</strong> One repo can have npm + PyPI +
          Maven manifests at the same time — each ecosystem&apos;s health
          is computed independently and grouped by manifest in the UI.
        </P>
      </Section>

      <Section id="untested-duplicates" title="Untested hotspots & near-duplicates">
        <P>
          Two actionable insight panels at the bottom of the Code tab.
          Both compute against your codebase as a whole, not against
          individual files.
        </P>
        <P>
          <strong>Untested hotspots</strong> are functions with{" "}
          <em>zero direct test callers</em>, sorted by complexity
          descending. The detection is a heuristic: any file whose
          path ends in <Code>.test.</Code>, <Code>.spec.</Code>,{" "}
          <Code>_test.</Code>, lives under <Code>__tests__/</Code>, or
          matches similar conventions counts as a test file. A function
          with at least one call edge from a test file is &quot;tested.&quot;
        </P>
        <P>
          The list is ordered by complexity because untested simple
          getters are usually fine; an untested 12-branch validator is
          where the bugs live. Click an item to jump to it in the file
          browser.
        </P>
        <P>
          <strong>Near-duplicates</strong> are groups of functions whose
          AST hashes match (above a complexity floor — we ignore tiny
          one-line wrappers). The hash captures structure, not literal
          text, so two functions that differ only in variable names or
          formatting still match. Each group is a candidate for
          extracting a shared helper.
        </P>
        <P>
          Both panels hide themselves when there&apos;s nothing to show
          (no test files detected, no duplicates found). Brand-new repos
          don&apos;t get a confusing &quot;everything is untested&quot;
          lecture.
        </P>
      </Section>

      <footer
        className="pt-8 text-xs border-t"
        style={{ borderColor: TOK.border, color: TOK.textMuted }}
      >
        Found something unclear? Open an issue on{" "}
        <a
          href="https://github.com/coffeejones/gitvision/issues"
          target="_blank"
          rel="noopener"
          className="underline underline-offset-2"
        >
          GitHub
        </a>{" "}
        — these are the kinds of doc gaps we want to know about.
      </footer>
    </main>
  );
}

// ---------------- Layout primitives ----------------

function TableOfContents() {
  return (
    <nav
      className="rounded-lg p-4 flex flex-col gap-2"
      style={{
        background: TOK.surface,
        border: `1px solid ${TOK.border}`,
      }}
      aria-label="Help table of contents"
    >
      <span
        className="text-[11px] uppercase tracking-[0.08em] font-semibold"
        style={{ color: TOK.textMuted }}
      >
        Contents
      </span>
      <ul className="flex flex-col gap-1.5">
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="text-sm hover:underline underline-offset-2"
              style={{ color: TOK.textPrimary }}
            >
              {s.title}
            </a>
            <span
              className="text-xs ml-2"
              style={{ color: TOK.textMuted }}
            >
              — {s.hint}
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="flex flex-col gap-4 scroll-mt-16"
      // scroll-mt offsets the in-page anchor scroll so the heading
      // doesn't end up flush against the top of the viewport.
    >
      <h2
        className="text-xl font-semibold"
        style={{ color: TOK.textPrimary, letterSpacing: "-0.01em" }}
      >
        {title}
      </h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-sm leading-relaxed"
      style={{ color: TOK.textSecondary }}
    >
      {children}
    </p>
  );
}

function Bullets({ children }: { children: React.ReactNode }) {
  return (
    <ul
      className="text-sm leading-relaxed list-disc pl-6 flex flex-col gap-1.5"
      style={{ color: TOK.textSecondary }}
    >
      {children}
    </ul>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="font-mono text-[12px] px-1 py-0.5 rounded"
      style={{
        background: TOK.surfaceElevated,
        color: TOK.textPrimary,
        border: `1px solid ${TOK.border}`,
      }}
    >
      {children}
    </code>
  );
}
