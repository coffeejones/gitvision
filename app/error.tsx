"use client";

// Page-tree error boundary. Catches any exception thrown while rendering
// a route below the root layout — including layout throws like the
// session layout reading a corrupt snapshot. The root <html>/<body>
// stays mounted (that's global-error.tsx's job), so this only needs to
// fill the content area. Inline-styled bitumen + bone so it never
// depends on a stylesheet that may itself be the thing that failed.

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to server/Railway logs; replace with a Sentry capture if
    // error tracking lands later.
    console.error("[app/error]", error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "70vh",
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
          This page didn&rsquo;t load
        </h1>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 14.5,
            lineHeight: 1.55,
            color: "rgba(242,239,234,0.6)",
          }}
        >
          An unexpected error stopped this view from rendering. Try again, or
          head back to your surveys.
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
            href="/cases"
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
            Back to surveys
          </a>
        </div>
      </div>
    </div>
  );
}
