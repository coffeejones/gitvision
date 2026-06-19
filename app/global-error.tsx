"use client";

// Root error boundary. This is the LAST line of defense: it only fires
// when the root layout itself throws (a normal page-tree error is caught
// by app/error.tsx, which keeps the layout). Because it replaces the
// root layout, it must render its own <html>/<body> and cannot rely on
// globals.css or any theme module — so everything here is inline-styled
// bitumen + bone, no imports beyond React/Next.
//
// Without this file, any root-layout exception in production shows a raw,
// unstyled "Application error" 500. Better Auth, font loading, or a bad
// env var at the root would all land here.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0c0b0a",
          color: "#f2efea",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
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
              color: "#FF4F00",
            }}
          >
            Something broke
          </div>
          <h1
            style={{
              margin: "14px 0 0",
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: "-0.02em",
            }}
          >
            CodeTrawl hit an unexpected error
          </h1>
          <p
            style={{
              margin: "12px 0 0",
              fontSize: 14.5,
              lineHeight: 1.55,
              color: "rgba(242,239,234,0.6)",
            }}
          >
            This one&rsquo;s on us, not your repo. Try again — if it keeps
            happening, the sweep you were on may need a fresh start.
          </p>
          {error?.digest && (
            <p
              style={{
                margin: "10px 0 0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 11,
                color: "rgba(242,239,234,0.35)",
              }}
            >
              ref {error.digest}
            </p>
          )}
          <div
            style={{
              marginTop: 24,
              display: "flex",
              gap: 10,
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: "#f2efea",
                color: "#0c0b0a",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 13.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Try again
            </button>
            <a
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
              Back to home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
