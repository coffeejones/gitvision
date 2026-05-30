// /cookies — Cookie Policy (Phase P).
//
// Lists the ACTUAL cookies + browser storage the app uses, scanned
// from the code: Better Auth session cookie (strictly necessary),
// ownerId cookie + localStorage, has-visited localStorage, pending-repo
// sessionStorage. All strictly-necessary or functional — no analytics
// or tracking today. If that changes, this page + a consent mechanism
// need updating.

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
  title: "Cookie Policy — RepoJury",
  description:
    "The small set of cookies and browser storage RepoJury uses, and why. No tracking or advertising.",
};

const TOC: [string, string][] = [
  ["what", "1. What these are"],
  ["use", "2. What we use"],
  ["tracking", "3. No tracking"],
  ["manage", "4. Managing them"],
  ["changes", "5. Changes"],
];

export default function CookiesPage() {
  return (
    <LegalShell title="Cookie Policy" updated="2026-05-30" toc={TOC}>
      <Intro>
        RepoJury uses a small, deliberate set of cookies and browser storage —
        all of it either strictly necessary to run the service or functional to
        improve your experience. We don&rsquo;t use advertising cookies,
        tracking pixels, or fingerprinting.
      </Intro>
      <DraftNotice />

      <Section id="what" num="1." title="What these are">
        <P>
          &ldquo;Cookies&rdquo; are small files a site stores in your browser.
          We also use two related browser features — <code>localStorage</code>{" "}
          and <code>sessionStorage</code> — which keep small values on your
          device without sending them to us automatically. We group all three
          together below.
        </P>
      </Section>

      <Section id="use" num="2." title="What we use">
        <table className="legal-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Purpose</th>
              <th>Category</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Session cookie</td>
              <td>Cookie</td>
              <td>Keeps you signed in (set by our auth system)</td>
              <td>Strictly necessary</td>
            </tr>
            <tr>
              <td>owner-id</td>
              <td>Cookie + localStorage</td>
              <td>
                Links sessions you create in the browser, so the right ones show
                in your workspace
              </td>
              <td>Functional</td>
            </tr>
            <tr>
              <td>has-visited</td>
              <td>localStorage</td>
              <td>Hides the first-visit hint after you&rsquo;ve seen it</td>
              <td>Functional</td>
            </tr>
            <tr>
              <td>pending-repo</td>
              <td>sessionStorage</td>
              <td>
                Remembers the repo you typed before signing up, so we can resume
                it afterward
              </td>
              <td>Functional</td>
            </tr>
            <tr>
              <td>cookie-notice</td>
              <td>localStorage</td>
              <td>Remembers that you&rsquo;ve dismissed the cookie notice</td>
              <td>Functional</td>
            </tr>
          </tbody>
        </table>
        <P>
          The session cookie is essential — without it you can&rsquo;t stay
          logged in. The functional items aren&rsquo;t essential, but clearing
          them only means small conveniences reset (you&rsquo;ll see the
          first-visit hint again, for example).
        </P>
        <P>
          <strong>Your choice.</strong>{" "}
          When you first visit, a banner asks you to accept or decline the
          optional functional storage. Essential cookies always run (the
          service can&rsquo;t work without them), but if you decline, we
          don&rsquo;t write the functional items above. You can change your mind
          by clearing the <code>cookie-consent</code> value in your browser,
          which brings the banner back.
        </P>
      </Section>

      <Section id="tracking" num="3." title="No tracking, today">
        <P>
          We don&rsquo;t currently use any analytics, advertising, or
          cross-site tracking cookies. If we ever add privacy-friendly analytics
          (we&rsquo;re considering an IP-anonymized option), we&rsquo;ll update
          this page and add a proper consent step before any non-essential
          tracking runs.
        </P>
      </Section>

      <Section id="manage" num="4." title="Managing them">
        <UL>
          <LI>
            You can clear cookies and storage any time from your browser
            settings — usually under &ldquo;Privacy&rdquo; or &ldquo;Site
            data&rdquo;.
          </LI>
          <LI>
            Blocking the session cookie will sign you out and prevent login.
          </LI>
          <LI>
            Blocking functional storage is fine; you&rsquo;ll just lose the small
            conveniences above.
          </LI>
        </UL>
      </Section>

      <Section id="changes" num="5." title="Changes">
        <P>
          If our use of cookies changes, we&rsquo;ll update this page and the
          &ldquo;last updated&rdquo; date above. See our{" "}
          <a href="/privacy">Privacy Policy</a> for how we handle personal data
          more broadly.
        </P>
      </Section>
    </LegalShell>
  );
}
