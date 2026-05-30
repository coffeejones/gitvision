// /refunds — Refund & Cancellation Policy (Phase P).
//
// Covers the paid plans (billed via Polar), the trial, cancellation,
// and — importantly for EU consumers — the 14-day right of withdrawal
// and the condition under which it's waived for digital services that
// start immediately. Contact is a Placeholder; not lawyer-reviewed.

import type { Metadata } from "next";
import {
  LegalShell,
  DraftNotice,
  Section,
  Intro,
  P,
  UL,
  LI,
  Placeholder,
} from "@/components/legal/LegalShell";

export const metadata: Metadata = {
  title: "Refund & Cancellation — RepoJury",
  description:
    "How RepoJury subscriptions, trials, cancellations, and refunds work, including EU withdrawal rights.",
};

const TOC: [string, string][] = [
  ["plans", "1. Plans & trials"],
  ["cancel", "2. Cancelling"],
  ["withdrawal", "3. EU right of withdrawal"],
  ["refunds", "4. Refunds"],
  ["contact", "5. Contact"],
];

export default function RefundsPage() {
  return (
    <LegalShell
      title="Refund & Cancellation Policy"
      updated="2026-05-30"
      toc={TOC}
    >
      <Intro>
        This explains how our paid plans, trials, cancellations, and refunds
        work. Payments are processed by our provider, Polar.
      </Intro>
      <DraftNotice />

      <Section id="plans" num="1." title="Plans & trials">
        <UL>
          <LI>
            <strong>Open case</strong> is free, forever. There&rsquo;s nothing to
            cancel and nothing to refund.
          </LI>
          <LI>
            <strong>Standing docket</strong> and <strong>Full bench</strong> are
            subscriptions, billed monthly or annually. They renew automatically
            until you cancel.
          </LI>
          <LI>
            Paid plans may start with a free trial. We won&rsquo;t charge you
            during the trial. If you don&rsquo;t cancel before it ends, your paid
            subscription begins and the first payment is taken.
          </LI>
        </UL>
      </Section>

      <Section id="cancel" num="2." title="Cancelling">
        <P>
          You can cancel any time from your account billing settings, or by
          emailing <Placeholder>CONTACT_EMAIL</Placeholder>. When you cancel:
        </P>
        <UL>
          <LI>
            you keep paid access until the end of the period you&rsquo;ve already
            paid for;
          </LI>
          <LI>you&rsquo;re not charged again;</LI>
          <LI>
            after the period ends, your account moves to the free Open case plan
            — your saved cases beyond the free limit may become inaccessible, so
            export anything you need first.
          </LI>
        </UL>
      </Section>

      <Section id="withdrawal" num="3." title="EU right of withdrawal">
        <P>
          If you&rsquo;re a consumer in the EU/EEA, you normally have a{" "}
          <strong>14-day right to withdraw</strong> from a purchase of digital
          services, without giving a reason.
        </P>
        <P>
          Because RepoJury is a digital service that starts immediately, by
          starting a paid subscription you ask us to begin the service during the
          14-day period and acknowledge that you lose the right of withdrawal
          once it has been fully performed. Where the service has only partly
          been performed, you may still withdraw and we&rsquo;ll charge only for
          what you&rsquo;ve used. Nothing here removes mandatory consumer rights
          you have where you live.
        </P>
      </Section>

      <Section id="refunds" num="4." title="Refunds">
        <UL>
          <LI>
            <strong>Within 14 days</strong>, if you&rsquo;re an eligible EU
            consumer and the withdrawal right applies, we&rsquo;ll refund the
            unused portion as described above.
          </LI>
          <LI>
            <strong>Outside that window</strong>, subscriptions are generally
            non-refundable for the current period — but if something went wrong
            on our side (a billing error, a service we couldn&rsquo;t deliver),
            contact us and we&rsquo;ll make it right.
          </LI>
          <LI>
            Refunds are issued to your original payment method via Polar and may
            take a few business days to appear.
          </LI>
        </UL>
      </Section>

      <Section id="contact" num="5." title="Contact">
        <P>
          For cancellations, refunds, or billing questions, email{" "}
          <Placeholder>CONTACT_EMAIL</Placeholder>.
        </P>
      </Section>
    </LegalShell>
  );
}
