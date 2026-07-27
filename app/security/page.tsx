// /security — what happens to a customer's source code, in the detail an
// engineer would check.
//
// Written from an adversarial pass over the pipeline rather than from
// intentions: every sentence here was traced to a call site, and several
// earlier drafts were thrown out because the code said otherwise. Three that
// are worth remembering, because they are the ones a founder writes by reflex:
//
//   "We never store your source code."  — false. riskyPatterns.ts stores the
//   flagged line verbatim as its evidence, and a set of short strings your code
//   declares (symbol names, test descriptions, import specifiers) are kept as
//   finding evidence too. The page names them instead.
//
//   "We never send your code to an AI model."  — false. functionExplain.ts
//   sends one function's source when the reader clicks Explain. It is the only
//   path that does, and the page says exactly that.
//
//   "The temporary copy is always deleted."  — was false until the try in
//   graph.ts was moved above the download. Even now a process killed
//   mid-analysis leaves it, and nothing sweeps: there is no SIGTERM handler in
//   the codebase. The page says so rather than rounding up to "always".
//
// The closing section is deliberate. An enterprise reader has been trained to
// discount everything above it; a specific list of what CodeTrawl is NOT is the
// only part of a security page that cannot be written by someone bluffing. Keep
// it, and keep it accurate — if a certification or a second operator ever
// arrives, this is the first place to change.
//
// Keep in step with app/privacy (the processor table) and the in-product custody
// lines in SourcePanel / FunctionInsight / FlowsView. If those move, this moves.

import type { Metadata } from "next";
import Link from "next/link";
import { ctMono } from "@/components/landing/codetrawl/ctFonts";
import { CTSurface } from "@/components/landing/codetrawl/CTSurface";
import { CTNav } from "@/components/landing/codetrawl/CTNav";
import { CTFooter } from "@/components/landing/codetrawl/CTFooter";

export const metadata: Metadata = {
  title: "Security — what happens to your code | CodeTrawl",
  description:
    "Exactly what CodeTrawl fetches, what it keeps, what it sends to a model, and who can read the result — including the parts most tools leave out.",
  alternates: { canonical: "/security" },
};

const MONO = ctMono.style.fontFamily;
const BONE = "#eceae8";
const MUTED = "rgba(255,255,255,0.58)";
const FAINT = "rgba(255,255,255,0.42)";
const SURFACE = "rgba(255,255,255,0.04)";
const BORDER = "rgba(255,255,255,0.10)";
const EMBER = "#ff8a50";

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{ display: "flex", flexDirection: "column", gap: 18, marginTop: 68 }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            color: EMBER,
          }}
        >
          {eyebrow}
        </span>
        <h2
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            margin: 0,
            color: BONE,
          }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontSize: 15.5,
        lineHeight: 1.7,
        color: MUTED,
        margin: 0,
        maxWidth: 680,
      }}
    >
      {children}
    </p>
  );
}

/** A stated fact with its scope. The scope line is the point of the component:
 *  a security page is only useful where it draws the boundary. */
function Fact({
  label,
  children,
  limit,
}: {
  label: string;
  children: React.ReactNode;
  /** The caveat. Rendered in a colder colour, never omitted for brevity. */
  limit?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr)",
        gap: 6,
        padding: "16px 18px",
        background: SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
      }}
    >
      <span
        style={{
          fontFamily: MONO,
          fontSize: 12,
          letterSpacing: "0.04em",
          color: EMBER,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 15, lineHeight: 1.6, color: BONE }}>
        {children}
      </span>
      {limit && (
        <span style={{ fontSize: 13.5, lineHeight: 1.6, color: FAINT }}>
          {limit}
        </span>
      )}
    </div>
  );
}

function Stack({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {children}
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code style={{ fontFamily: MONO, fontSize: 13.5, color: EMBER }}>
      {children}
    </code>
  );
}

export default function SecurityPage() {
  return (
    <CTSurface>
      <CTNav />

      <main className="wrap" style={{ paddingBottom: 96 }}>
        <header
          className="price-hero"
          style={{ maxWidth: 720, marginLeft: "auto", marginRight: "auto" }}
        >
          <span className="eyebrow">Security · code custody</span>
          <h1>What happens to your code.</h1>
          <p className="lede">
            CodeTrawl reads repositories, so the only question that matters is
            where they go. This page answers it at the level an engineer would
            check — including the parts that are inconvenient for us.
          </p>
        </header>

        <Section eyebrow="Fetching" title="Two temporary copies, and what removes them">
          <P>
            Commit history comes from a metadata-only clone —{" "}
            <Mono>--bare --filter=blob:none</Mono> — so git sends us trees and
            commit metadata and never the contents of your files. Structure,
            security and dependency analysis needs the actual files, so for
            those we download the repository archive and extract it to a
            temporary directory on the server. The parsers read it there.
          </P>
          <Stack>
            <Fact label="deleted when the analysis is done">
              The analysis process removes the temporary directory as soon as it
              has finished with it, and on the failure paths — a refused
              download, a full disk, a malformed archive.
            </Fact>
            <Fact
              label="the gap we do not round off"
              limit="There is no shutdown handler and no reaper over the system temp directory. A redeploy in the middle of a sweep is the realistic case."
            >
              If the process itself is killed mid-analysis, whatever it had
              extracted stays until the host clears its temporary directory.
              Nothing sweeps it. We do not claim deletion is guaranteed on every
              path, because it is not.
            </Fact>
          </Stack>
        </Section>

        <Section eyebrow="Keeping" title="We keep the result, not your files">
          <P>
            A finished analysis is stored as one JSON file. It holds repository
            metadata, git-history summaries, file paths, symbol names, computed
            metrics, dependency and vulnerability lists, and the findings. That
            is enough to describe the shape of a codebase and not enough to
            reconstruct it.
          </P>
          <P>
            &ldquo;We never store your source code&rdquo; would be a cleaner
            sentence and it would be false. Some verbatim text from your
            repository is kept as the evidence behind a finding, because a
            finding you cannot check is worth nothing. Here is all of it:
          </P>
          <Stack>
            <Fact
              label="one source line per dynamic-execution finding"
              limit="Capped at 200 characters per line and 200 findings per analysis."
            >
              When we flag an <Mono>eval</Mono>, <Mono>new Function</Mono> or{" "}
              <Mono>exec</Mono> call, we store that single line so you can see
              what was matched instead of taking our word for it.
            </Fact>
            <Fact label="short strings your code declares">
              Function, class, field and enum names, type annotations, import
              paths, test-case descriptions, and the actions referenced in your
              CI workflows.
            </Fact>
            <Fact label="text your team wrote in git">
              Commit subjects with their author names and email addresses, and
              pull-request titles — as they appear in the repository&rsquo;s own
              history.
            </Fact>
            <Fact
              label="never the credential itself"
              limit="A credential sitting on a line we flagged for dynamic execution would still be captured by that check."
            >
              When the secret scanner matches a credential-shaped string it
              stores the file, the line number, and a redacted preview — first
              six characters and last four. The matched value is never written.
            </Fact>
            <Fact label="never a function body">
              For each function we keep its path, name, line range, complexity
              and container. The duplicate detector works from a structural
              fingerprint that hashes AST node types and operator tokens only —
              never identifiers, never literals.
            </Fact>
          </Stack>
          <P>
            Deleting an analysis removes that file. Two derived artifacts
            outlive it: a parse index of paths, symbol names and per-file hashes
            — no file contents — evicted on a size budget rather than a timer,
            and a small record of the last commit we saw.
          </P>
        </Section>

        <Section eyebrow="Sending" title="What reaches a model, and when">
          <P>
            The analysis engine calls no AI at all. Cloning, parsing, the call
            graph and every signal are computed by code; with no API key
            configured the AI features return nothing and the rest of the
            product is unchanged. The AI layer sits on top, in three shapes that
            are not the same as each other.
          </P>
          <Stack>
            <Fact label="computed signals only">
              The health check, the grade narrative and the &ldquo;where to
              start&rdquo; note receive the signal JSON — paths, counts,
              percentages, contributor names — and are instructed to add nothing
              to it. No file contents, no commit messages.
            </Fact>
            <Fact
              label="metadata, plus up to 18 commit messages"
              limit="Commit messages are free text your team wrote; they can carry ticket ids, customer names and unreleased feature names."
            >
              The repository briefing also sends the description and topics,
              language mix, contributor logins with commit counts, hotspot
              paths, and up to eighteen recent commit messages as written. It
              draws on the model&rsquo;s own knowledge of well-known projects
              too, which is why we call it a briefing and not a finding.
            </Fact>
            <Fact
              label="one function's source, on your click"
              limit="Capped at 400 lines or 16,000 characters. This is the only path in the product that sends file contents to a model."
            >
              Asking for a plain-English explanation of a function sends that
              function to Anthropic for that one request. It is not written to
              your analysis; the returned explanation is held in server memory
              and cleared on restart.
            </Fact>
          </Stack>
          <P>
            AI features run on Anthropic&rsquo;s standard commercial API. What
            Anthropic does with what it receives is governed by{" "}
            <a
              href="https://www.anthropic.com/legal/privacy"
              target="_blank"
              rel="noopener"
              style={{ color: BONE, textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              Anthropic&rsquo;s own terms
            </a>
            , not by anything we can promise on their behalf. We hold no
            zero-retention or enterprise agreement with them.
          </P>
        </Section>

        <Section eyebrow="Reading" title="Who can open an analysis">
          <Stack>
            <Fact
              label="private repositories — the account that ran it"
              limit="Visibility is recorded at sweep time, not checked live: if a repository becomes private after you analyzed it, re-run the sweep so the lock applies."
            >
              Every page, API route and export for that analysis returns
              &ldquo;not found&rdquo; to anyone else.
            </Fact>
            <Fact
              label="public repositories — anyone with the link"
              limit="Plan limits control what the interface renders, not who can fetch the data. If a result should be restricted, analyze the repository privately."
            >
              A public-repo analysis is shareable the way the repository itself
              is: no sign-in needed, and the whole report is readable by anyone
              holding the URL.
            </Fact>
            <Fact label="the list is not public">
              Listing analyses requires signing in and returns only your own. It
              did not always: until recently the endpoint returned every
              public-repo analysis on the instance to anyone, with an identifier
              for the account that created each one. That is fixed, and it is
              the kind of thing this page exists to make us check.
            </Fact>
          </Stack>
        </Section>

        <Section eyebrow="Access" title="What we ask GitHub for">
          <P>
            Public repositories need no authorization at all. Signing in with
            GitHub requests the <Mono>repo</Mono> scope so private repositories
            can be read — and GitHub issues that scope as read <em>and</em>{" "}
            write, because it publishes no read-only equivalent. We only ever
            read. You can revoke it at any time from your GitHub application
            settings, and a per-repository install with read-only access is on
            the roadmap.
          </P>
          <P>
            The token is stored server-side and is never sent to the browser.
            The full picture of what we collect and why is in the{" "}
            <Link
              href="/privacy"
              style={{ color: BONE, textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              privacy policy
            </Link>
            .
          </P>
        </Section>

        <Section eyebrow="Honestly" title="What CodeTrawl is not">
          <P>
            Every claim above is checkable. These are not, so we are not making
            them:
          </P>
          <Stack>
            <Fact label="no certifications">
              No SOC 2, no ISO 27001, no penetration test, no external audit. If
              your procurement process requires one, CodeTrawl does not clear it
              today.
            </Fact>
            <Fact label="no data processing agreement">
              We cannot sign a DPA, and we hold no sub-processor agreements
              beyond each provider&rsquo;s standard terms.
            </Fact>
            <Fact label="one operator">
              CodeTrawl is built and run by one person. There is no on-call
              rotation and no security team. Ownership of the code is
              deliberately narrow for the same reason.
            </Fact>
            <Fact label="not yet a registered company">
              The{" "}
              <Link
                href="/terms"
                style={{ color: BONE, textDecoration: "underline", textUnderlineOffset: 3 }}
              >
                terms
              </Link>{" "}
              say so plainly, and this page will say so until it changes.
            </Fact>
          </Stack>
          <P>
            If something here is wrong, or you need a detail this page does not
            cover, write to{" "}
            <a
              href="mailto:support@codetrawl.com"
              style={{ color: BONE, textDecoration: "underline", textUnderlineOffset: 3 }}
            >
              support@codetrawl.com
            </a>
            .
          </P>
        </Section>
      </main>

      <CTFooter />
    </CTSurface>
  );
}
