// Shared HTML scaffolding for email templates.
//
// Why we hand-write HTML instead of React Email:
//   - We only ship 2-3 templates. React Email + render-to-HTML adds
//     a build-time dep we don't otherwise need.
//   - Email-client CSS support is messy enough that "compose with
//     React components" doesn't really translate — every template
//     ends up being mostly inline styles anyway.
//   - Plain HTML is more grep-able and easier to debug when an
//     email lands looking weird in Outlook 2007.
//
// If we grow to 10+ templates with shared headers/footers and
// dynamic blocks, revisit React Email.
//
// Design choice: light theme. Modern clients invert dark CSS in
// unpredictable ways (Gmail's auto-darken), so a light email is
// safest for cross-client consistency. We lean on a single accent
// color (emerald, matching the brand) for the CTA button and the
// "RepoBaron" wordmark so the visual identity carries through.

export interface EmailLayoutOptions {
  /** The bold accented brand line at the top — usually "RepoBaron". */
  brand?: string;
  /** Main heading inside the card. */
  heading: string;
  /** One or more <p> bodies between heading and CTA. Plain text only;
   *  helper escapes & links them. */
  paragraphs: string[];
  /** Primary action — usually a verification or reset link. Optional
   *  for notification-style emails with no CTA. */
  cta?: { label: string; href: string };
  /** Small print at the bottom — privacy reassurance, "didn't ask
   *  for this?" etc. Plain text. */
  footnote?: string;
}

const BRAND_ACCENT = "#10b981"; // emerald-500, matches TOK.accent
const TEXT_PRIMARY = "#1a1a1a";
const TEXT_SECONDARY = "#555";
const TEXT_MUTED = "#888";
const BG_PAGE = "#f5f5f7"; // off-white, easier on the eye than pure white
const BG_CARD = "#ffffff";
const BORDER = "#e5e5ea";

/** Render a full <!DOCTYPE html> email body. The fixed 560px max-width
 *  matches what Gmail / Apple Mail render comfortably on desktop without
 *  feeling cramped on phones. */
export function renderEmailLayout(opts: EmailLayoutOptions): string {
  const brand = opts.brand ?? "RepoBaron";
  const paragraphsHtml = opts.paragraphs
    .map(
      (p) =>
        `<p style="margin: 0 0 16px; color: ${TEXT_SECONDARY}; font-size: 15px; line-height: 1.55;">${escapeHtml(
          p
        )}</p>`
    )
    .join("\n");

  const ctaHtml = opts.cta
    ? `
      <div style="text-align: center; margin: 28px 0;">
        <a href="${escapeAttr(opts.cta.href)}" style="display: inline-block; background: ${BRAND_ACCENT}; color: #fff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 14px;">
          ${escapeHtml(opts.cta.label)}
        </a>
      </div>
      <p style="margin: 0 0 16px; color: ${TEXT_MUTED}; font-size: 12px; line-height: 1.5; text-align: center;">
        If the button doesn&rsquo;t work, copy this link into your browser:<br>
        <a href="${escapeAttr(opts.cta.href)}" style="color: ${BRAND_ACCENT}; word-break: break-all;">${escapeHtml(opts.cta.href)}</a>
      </p>
    `
    : "";

  const footnoteHtml = opts.footnote
    ? `<p style="margin: 24px 0 0; color: ${TEXT_MUTED}; font-size: 12px; line-height: 1.55; padding-top: 16px; border-top: 1px solid ${BORDER};">${escapeHtml(opts.footnote)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin: 0; padding: 0; background: ${BG_PAGE}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <div style="max-width: 560px; margin: 0 auto; padding: 32px 16px;">
    <div style="text-align: center; margin-bottom: 20px;">
      <span style="font-size: 14px; font-weight: 600; letter-spacing: 0.04em; color: ${BRAND_ACCENT};">${escapeHtml(brand)}</span>
    </div>
    <div style="background: ${BG_CARD}; border-radius: 14px; border: 1px solid ${BORDER}; padding: 32px;">
      <h1 style="margin: 0 0 16px; color: ${TEXT_PRIMARY}; font-size: 22px; font-weight: 600; line-height: 1.3;">
        ${escapeHtml(opts.heading)}
      </h1>
      ${paragraphsHtml}
      ${ctaHtml}
      ${footnoteHtml}
    </div>
    <p style="margin: 16px 0 0; text-align: center; color: ${TEXT_MUTED}; font-size: 11px; line-height: 1.5;">
      RepoBaron &middot; made by coffeejones &middot;
      <a href="https://repobaron.com" style="color: ${TEXT_MUTED}; text-decoration: underline;">repobaron.com</a>
    </p>
  </div>
</body>
</html>`;
}

/** Render the plain-text fallback that mirrors the HTML structure.
 *  Spam filters score lower when there's a real text alternative,
 *  and Slack / Outlook 2007 / accessibility tools all benefit. */
export function renderEmailText(opts: EmailLayoutOptions): string {
  const lines: string[] = [];
  lines.push(opts.brand ?? "RepoBaron");
  lines.push("");
  lines.push(opts.heading);
  lines.push("");
  for (const p of opts.paragraphs) {
    lines.push(p);
    lines.push("");
  }
  if (opts.cta) {
    lines.push(`${opts.cta.label}: ${opts.cta.href}`);
    lines.push("");
  }
  if (opts.footnote) {
    lines.push("---");
    lines.push(opts.footnote);
  }
  return lines.join("\n");
}

// ─── HTML escapers (tiny, no deps) ──────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  // URLs in href attributes need at minimum quote-escaping. We trust
  // the call site to have built a valid URL; this is the last-mile
  // safety net for stray quotes.
  return s.replace(/"/g, "%22");
}
