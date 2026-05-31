// /terms — Terms of Service (Phase P).
//
// Covers the service, accounts, acceptable use (incl. the real rate
// limits from lib/rateLimit.ts), subscriptions/billing via Polar, the
// PolyForm Noncommercial license on the source, the no-warranty
// disclaimer, and a liability cap. Governing-law + contact are
// Placeholders. Not lawyer-reviewed — see the draft notice.

import type { Metadata } from "next";
import {
  LegalShell,
  DraftNotice,
  Section,
  Intro,
  P,
  UL,
  LI,
} from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Terms of Service — RepoJury",
  description:
    "The terms you agree to when you use RepoJury — accounts, acceptable use, billing, and liability.",
};

const TOC: [string, string][] = [
  ["accept", "1. Agreement"],
  ["service", "2. The service"],
  ["accounts", "3. Your account"],
  ["use", "4. Acceptable use"],
  ["billing", "5. Plans & billing"],
  ["termination", "6. Termination"],
  ["ip", "7. Intellectual property"],
  ["warranty", "8. No warranty"],
  ["liability", "9. Liability"],
  ["law", "10. Governing law"],
  ["changes", "11. Changes"],
  ["contact", "12. Contact"],
];

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="2026-05-30" toc={TOC}>
      <Intro>
        These terms govern your use of RepoJury. By creating an account or using
        the service, you agree to them. If you don&rsquo;t agree, please
        don&rsquo;t use RepoJury.
      </Intro>
      <DraftNotice />

      <Section id="accept" num="1." title="Agreement">
        <P>
          RepoJury (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is an early proof of
          concept, not yet run by a registered company. These Terms of Service
          still form an agreement between you and us covering how you use the
          service. Our <a href="/privacy">Privacy Policy</a> and{" "}
          <a href="/cookies">Cookie Policy</a> are part of these terms.
        </P>
      </Section>

      <Section id="service" num="2." title="The service">
        <P>
          RepoJury analyzes GitHub repositories and returns a deterministic
          &ldquo;verdict&rdquo; across four areas — health, security, forensics,
          and supply — plus optional AI-generated commentary. Analysis is a
          best-effort estimate built from public signals and heuristics. It may
          be incomplete, out of date, or wrong. <strong>Don&rsquo;t treat a
          verdict as a guarantee</strong> — verify anything important against
          the source.
        </P>
      </Section>

      <Section id="accounts" num="3." title="Your account">
        <UL>
          <LI>
            You must provide accurate information and keep your credentials
            secure. You&rsquo;re responsible for activity under your account.
          </LI>
          <LI>
            You must be at least 16, or the age of digital consent in your
            country.
          </LI>
          <LI>
            If you connect GitHub, you authorize us to access the repositories
            you ask us to analyze. You can revoke that access from GitHub at any
            time.
          </LI>
        </UL>
      </Section>

      <Section id="use" num="4." title="Acceptable use">
        <P>You agree not to:</P>
        <UL>
          <LI>
            analyze repositories you have no right to access, or use RepoJury to
            infringe anyone&rsquo;s rights;
          </LI>
          <LI>
            attempt to break, overload, or circumvent the service&rsquo;s limits
            or security;
          </LI>
          <LI>resell or rebrand the hosted service without our permission.</LI>
        </UL>
        <P>
          The service enforces automated rate limits (per-IP caps on session
          creation, refreshes, and AI calls, plus a daily AI budget) to keep it
          available for everyone. If you hit a limit, slow down. Persistent abuse
          may lead to suspension.
        </P>
      </Section>

      <Section id="billing" num="5." title="Plans & billing">
        <UL>
          <LI>
            <strong>Open case</strong> is free. <strong>Standing docket</strong>{" "}
            and <strong>Full bench</strong> are paid subscriptions billed monthly
            or annually through our payment provider, Polar.
          </LI>
          <LI>
            Subscriptions renew automatically until cancelled. You can cancel any
            time; see our <a href="/refunds">Refund &amp; Cancellation Policy</a>{" "}
            for what happens then and your withdrawal rights.
          </LI>
          <LI>
            We may change prices with reasonable notice. Changes don&rsquo;t
            affect the current paid period.
          </LI>
        </UL>
      </Section>

      <Section id="termination" num="6." title="Termination">
        <P>
          You can stop using RepoJury and delete your account at any time. We may
          suspend or terminate access if you breach these terms, or if we need to
          for legal or security reasons. We may also discontinue the service with
          reasonable notice. On termination, your right to use the service ends;
          relevant sections (e.g. liability, IP) survive.
        </P>
      </Section>

      <Section id="ip" num="7." title="Intellectual property">
        <P>
          The RepoJury name, branding, and hosted service are ours. The RepoJury
          source code is licensed under{" "}
          <a
            href="https://polyformproject.org/licenses/noncommercial/1.0.0/"
            target="_blank"
            rel="noopener"
          >
            PolyForm Noncommercial 1.0.0
          </a>
          : you may use, modify, and self-host it for personal, educational, or
          nonprofit purposes, but not for commercial gain without a separate
          license. Your repositories and analysis results remain yours — using
          RepoJury doesn&rsquo;t transfer any rights in your code to us.
        </P>
      </Section>

      <Section id="warranty" num="8." title="No warranty">
        <P>
          RepoJury is provided <strong>&ldquo;as is&rdquo;</strong> and{" "}
          <strong>&ldquo;as available&rdquo;</strong>, without warranties of any
          kind, whether express or implied, including fitness for a particular
          purpose, accuracy, or uninterrupted availability. Nothing in these
          terms excludes liability that cannot be excluded under applicable law,
          including your statutory rights as a consumer.
        </P>
      </Section>

      <Section id="liability" num="9." title="Limitation of liability">
        <P>
          To the maximum extent permitted by law, we are not liable for indirect
          or consequential losses, lost profits, or lost data arising from your
          use of the service. Our total liability for any claim is limited to the
          amount you paid us in the 12 months before the claim. This does not
          limit liability for death, personal injury, fraud, or anything else
          that can&rsquo;t be limited by law.
        </P>
      </Section>

      <Section id="law" num="10." title="Governing law">
        <P>
          As a pre-launch project, RepoJury hasn&rsquo;t set a governing
          jurisdiction yet — that will be specified, along with the registered
          operator, before any commercial launch. Whatever is chosen, your
          mandatory local consumer-protection rights always apply.
        </P>
      </Section>

      <Section id="changes" num="11." title="Changes">
        <P>
          We may update these terms. We&rsquo;ll change the &ldquo;last
          updated&rdquo; date and, for material changes, give notice by email or
          in-app. Continuing to use RepoJury after changes take effect means you
          accept them.
        </P>
      </Section>

      <Section id="contact" num="12." title="Contact">
        <P>
          Questions about these terms? Email{" "}
          <a href="mailto:support@repojury.com">support@repojury.com</a>.
        </P>
      </Section>
    </LegalShell>
  );
}
