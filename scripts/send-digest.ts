// Weekly metrics digest sender. Run on a schedule (a Railway cron service:
// `tsx scripts/send-digest.ts`) so the server PUSHES the digest to the admin
// inbox — no inbound endpoint, nothing to remember to open.
//
//   ADMIN_EMAIL=you@example.com RESEND_API_KEY=… tsx scripts/send-digest.ts
//   tsx scripts/send-digest.ts --dry        # print, don't send (safe local test)
//
// Reuses the same PII-free metrics + the app's email infra.

import { computeMetrics } from "../lib/metrics";
import { metricsDigestEmail } from "../lib/email/templates/metricsDigest";
import { sendEmail } from "../lib/email/send";

async function main() {
  const dry = process.argv.includes("--dry");
  const metrics = await computeMetrics();
  const email = metricsDigestEmail(metrics);

  if (dry) {
    console.log("SUBJECT:", email.subject);
    console.log("---");
    console.log(email.text);
    return;
  }

  const to = process.env.ADMIN_EMAIL;
  if (!to) {
    console.error("Set ADMIN_EMAIL to send the digest (or pass --dry to preview).");
    process.exit(1);
  }
  const res = await sendEmail({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  if (res.ok) {
    console.log(`Digest sent to ${to} (${res.id})`);
  } else {
    console.error(`Digest send failed: ${res.reason}${res.error ? " — " + res.error : ""}`);
    process.exit(1);
  }
}

main();
