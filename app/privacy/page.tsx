// /privacy — Privacy Policy (Phase P).
//
// GDPR-structured and written to match what the platform ACTUALLY does
// (scanned from the code: Better Auth accounts, session IP/user-agent
// logging, GitHub OAuth tokens, Anthropic/Polar/Resend/Railway
// processors). Replaces the previous /legal page, which described an
// older anonymous version of the product and was materially untrue.
//
// Contact + controller details are Placeholders — fill before relying
// on this document. Not a substitute for legal review.

import type { Metadata } from "next";
import {
  LegalShell,
  DraftNotice,
  Section,
  Intro,
  P,
  H3,
  UL,
  LI,
  Placeholder,
} from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Privacy Policy — RepoJury",
  description:
    "What personal data RepoJury collects, why, who we share it with, and your rights under GDPR.",
};

const TOC: [string, string][] = [
  ["controller", "1. Who we are"],
  ["data", "2. What we collect"],
  ["why", "3. Why we use it"],
  ["processors", "4. Who we share it with"],
  ["transfers", "5. International transfers"],
  ["retention", "6. How long we keep it"],
  ["rights", "7. Your rights"],
  ["security", "8. Security"],
  ["children", "9. Children"],
  ["changes", "10. Changes"],
  ["contact", "11. Contact"],
];

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="2026-05-30" toc={TOC}>
      <Intro>
        This policy explains what personal data RepoJury collects when you use
        it, why we collect it, who we share it with, and the rights you have
        over it. We&rsquo;ve written it to match what the service actually does
        — no vague boilerplate.
      </Intro>
      <DraftNotice />

      <Section id="controller" num="1." title="Who we are">
        <P>
          RepoJury (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is operated by{" "}
          <Placeholder>CONTROLLER_NAME</Placeholder>, an individual based in
          Denmark. For the purposes of the EU General Data Protection
          Regulation (GDPR), we are the <strong>data controller</strong> for
          the personal data described below. You can reach us at{" "}
          <a href="mailto:support@repojury.com">support@repojury.com</a>.
        </P>
      </Section>

      <Section id="data" num="2." title="What we collect">
        <P>
          We collect only what we need to run the service. Concretely:
        </P>
        <H3>Account data</H3>
        <UL>
          <LI>
            <strong>Your name and email address</strong> — provided when you
            sign up, or supplied by GitHub if you sign in with GitHub.
          </LI>
          <LI>
            <strong>Profile image URL</strong> — if you sign in with GitHub, the
            avatar URL from your GitHub profile.
          </LI>
          <LI>
            <strong>Password</strong> — if you sign up with email, stored only
            as a salted hash. We never see or store your plaintext password.
          </LI>
          <LI>
            <strong>Email-verification and password-reset tokens</strong> —
            short-lived, single-use.
          </LI>
        </UL>
        <H3>Session and security data</H3>
        <UL>
          <LI>
            <strong>IP address and browser user-agent</strong> — recorded with
            each login session, and used transiently to enforce per-IP rate
            limits that protect the service from abuse.
          </LI>
          <LI>
            <strong>Session cookies</strong> — see our{" "}
            <a href="/cookies">Cookie Policy</a>.
          </LI>
        </UL>
        <H3>GitHub authorization</H3>
        <UL>
          <LI>
            <strong>A GitHub access token</strong> — if you connect GitHub, we
            store the OAuth token so we can fetch the repositories you ask us to
            analyze on your behalf. You can revoke it any time from your GitHub
            settings.
          </LI>
        </UL>
        <H3>Analysis data</H3>
        <UL>
          <LI>
            <strong>Repository analysis results</strong> — the snapshots you
            create (metadata, file structure, git history summaries, dependency
            data). These describe code, not you, but a private repo&rsquo;s
            contents may be personal or confidential, so we treat them with the
            same care.
          </LI>
        </UL>
        <P>
          We do <strong>not</strong> collect special-category data (health,
          political opinions, etc.), and we don&rsquo;t use advertising
          networks, fingerprinting, or session-replay tools.
        </P>
      </Section>

      <Section id="why" num="3." title="Why we use it, and our legal basis">
        <UL>
          <LI>
            <strong>To provide the service</strong> (accounts, analysis, saved
            sessions) — legal basis: <em>performance of a contract</em>.
          </LI>
          <LI>
            <strong>To send transactional email</strong> (verification, password
            reset, billing notices) — legal basis: <em>contract</em>.
          </LI>
          <LI>
            <strong>To keep the service secure and available</strong> (rate
            limiting, abuse prevention via IP) — legal basis:{" "}
            <em>legitimate interests</em>.
          </LI>
          <LI>
            <strong>To take payment</strong> for paid plans — legal basis:{" "}
            <em>contract</em> and <em>legal obligation</em> (tax/accounting).
          </LI>
        </UL>
        <P>
          We don&rsquo;t sell your personal data, and we don&rsquo;t use it for
          automated decision-making that produces legal effects about you.
        </P>
      </Section>

      <Section id="processors" num="4." title="Who we share it with">
        <P>
          We share data only with the service providers we need to operate. Each
          processes data on our behalf under their own terms:
        </P>
        <table className="legal-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>What it processes</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>GitHub</td>
              <td>OAuth identity, repositories you analyze</td>
              <td>Sign-in + repo access</td>
            </tr>
            <tr>
              <td>Anthropic</td>
              <td>Repository snapshot (package names, paths, contributor logins)</td>
              <td>AI briefing + verdict narrative</td>
            </tr>
            <tr>
              <td>Polar</td>
              <td>Email, billing details</td>
              <td>Subscriptions + payment</td>
            </tr>
            <tr>
              <td>Resend</td>
              <td>Email address, message content</td>
              <td>Transactional email delivery</td>
            </tr>
            <tr>
              <td>Railway</td>
              <td>All of the above (hosting)</td>
              <td>Runs the app + database</td>
            </tr>
          </tbody>
        </table>
        <P>
          Card details for paid plans are handled by Polar and its payment
          processors — we never see or store full card numbers.
        </P>
      </Section>

      <Section id="transfers" num="5." title="International transfers">
        <P>
          Some of our providers (including Anthropic, Polar, Resend, and
          potentially Railway) are based in the United States. Where personal
          data is transferred outside the EU/EEA, it is protected by appropriate
          safeguards such as the EU Standard Contractual Clauses or the EU–U.S.
          Data Privacy Framework, as offered by each provider.
        </P>
      </Section>

      <Section id="retention" num="6." title="How long we keep it">
        <UL>
          <LI>
            <strong>Account data</strong> — for as long as your account exists.
            Delete your account and we delete it.
          </LI>
          <LI>
            <strong>Sessions / analysis</strong> — until you delete them, or
            until your account is removed.
          </LI>
          <LI>
            <strong>Security logs (IP, user-agent)</strong> — retained only as
            long as needed for the session and for abuse prevention, then
            expired.
          </LI>
          <LI>
            <strong>Billing records</strong> — retained as required by
            applicable tax and accounting law.
          </LI>
        </UL>
      </Section>

      <Section id="rights" num="7." title="Your rights">
        <P>Under GDPR you have the right to:</P>
        <UL>
          <LI>access the personal data we hold about you;</LI>
          <LI>have inaccurate data corrected;</LI>
          <LI>have your data deleted (&ldquo;right to be forgotten&rdquo;);</LI>
          <LI>restrict or object to certain processing;</LI>
          <LI>
            receive your data in a portable format;
          </LI>
          <LI>
            withdraw consent at any time, where we rely on consent;
          </LI>
          <LI>
            lodge a complaint with your local data protection authority. In
            Denmark this is Datatilsynet (the Danish Data Protection Agency); if
            you&rsquo;re elsewhere in the EU/EEA, your national authority can
            also help.
          </LI>
        </UL>
        <P>
          To exercise any of these, email{" "}
          <a href="mailto:support@repojury.com">support@repojury.com</a>.
          We&rsquo;ll respond within the timeframe the law requires.
        </P>
      </Section>

      <Section id="security" num="8." title="Security">
        <P>
          Passwords are hashed, transport is encrypted (HTTPS), GitHub tokens
          are stored server-side and never exposed to the browser, and access to
          production data is limited. No system is perfectly secure, but we take
          reasonable measures appropriate to the data we hold. If a breach
          affects your data, we&rsquo;ll notify you and the relevant authority
          as required by law.
        </P>
      </Section>

      <Section id="children" num="9." title="Children">
        <P>
          RepoJury is not directed at children under 16, and we don&rsquo;t
          knowingly collect their data. If you believe a child has given us
          personal data, contact us and we&rsquo;ll delete it.
        </P>
      </Section>

      <Section id="changes" num="10." title="Changes to this policy">
        <P>
          If we change how we handle personal data, we&rsquo;ll update this page
          and the &ldquo;last updated&rdquo; date above. For material changes
          affecting your rights, we&rsquo;ll give notice by email or in-app
          before they take effect.
        </P>
      </Section>

      <Section id="contact" num="11." title="Contact">
        <P>
          Questions about this policy or your data? Email{" "}
          <a href="mailto:support@repojury.com">support@repojury.com</a> and
          we&rsquo;ll get back to you.
        </P>
      </Section>
    </LegalShell>
  );
}
