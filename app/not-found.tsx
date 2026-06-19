// Global 404. Every notFound() call (a missing/deleted session, a
// private-repo session viewed by a non-owner, a mistyped URL) lands
// here. This is routine, not exceptional: Free accounts keep one saved
// survey, so a shared or bookmarked session URL 404s the moment the
// owner runs their next sweep — the copy says so plainly instead of
// reading like a hard error. Inline-styled bitumen + bone so it renders
// even if a stylesheet is the thing that's missing.

import Link from "next/link";

export const metadata = {
  title: "Not found — CodeTrawl",
};

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: "80vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0c0b0a",
        color: "#f2efea",
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 11,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "rgba(242,239,234,0.4)",
          }}
        >
          404
        </div>
        <h1
          style={{
            margin: "14px 0 0",
            fontSize: 26,
            fontWeight: 600,
            letterSpacing: "-0.02em",
          }}
        >
          Nothing here
        </h1>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 14.5,
            lineHeight: 1.55,
            color: "rgba(242,239,234,0.6)",
          }}
        >
          This survey may have been replaced, belong to someone else, or never
          existed. Free accounts keep one saved survey at a time, so older links
          stop resolving after a new sweep.
        </p>
        <div
          style={{
            marginTop: 24,
            display: "flex",
            gap: 10,
            justifyContent: "center",
          }}
        >
          <Link
            href="/cases"
            style={{
              background: "#f2efea",
              color: "#0c0b0a",
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Go to surveys
          </Link>
          <Link
            href="/"
            style={{
              background: "transparent",
              color: "#f2efea",
              border: "1px solid rgba(242,239,234,0.18)",
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 13.5,
              fontWeight: 500,
              textDecoration: "none",
            }}
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
