// Weekly metrics digest sender. Run on a schedule (a Railway cron service:
// `tsx scripts/send-digest.ts`) so the server PUSHES the digest to the admin
// inbox — no inbound endpoint, nothing to remember to open.
//
//   ADMIN_EMAIL=you@example.com RESEND_API_KEY=… tsx scripts/send-digest.ts
//   tsx scripts/send-digest.ts --dry        # print, don't send (safe local test)
//
// Reuses the same PII-free metrics + the app's email infra.

import fs from "node:fs";
import path from "node:path";
import { computeMetrics } from "../lib/metrics";
import { metricsDigestEmail } from "../lib/email/templates/metricsDigest";
import { sendEmail } from "../lib/email/send";

// tsx doesn't read .env.local either — load it so a local run picks up
// ADMIN_EMAIL / RESEND_API_KEY. On Railway the cron has real env vars; this is
// a harmless no-op there. Shell env still wins.
function loadEnv(file: string) {
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (line.trimStart().startsWith("#")) continue;
      const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const val = m[2].replace(/^(['"])(.*)\1$/, "$2");
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
  } catch {
    // No env file — fine.
  }
}
loadEnv(path.join(process.cwd(), ".env.local"));
loadEnv(path.join(process.cwd(), ".env"));

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
