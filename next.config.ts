import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Allow github avatar images via next/image (we use unoptimized for now, but this is safe too).
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  // web-tree-sitter dynamically loads its own WASM via createRequire and
  // fs.readFile. Don't let Next bundle these — they need to be resolved at
  // runtime against the deployed node_modules.
  serverExternalPackages: ["web-tree-sitter", "@vscode/tree-sitter-wasm"],
  // Make sure the WASM binaries actually land in the production trace. Without
  // these, Railway's serverless trace would skip the .wasm files in node_modules
  // and the route would fail at runtime with "ENOENT". The route key matches
  // the App-Router path of the debug endpoint.
  outputFileTracingIncludes: {
    "/api/debug/code-analysis": [
      "node_modules/web-tree-sitter/web-tree-sitter.wasm",
      "node_modules/@vscode/tree-sitter-wasm/wasm/*.wasm",
    ],
  },
  // A session URL is a capability: an ownerless analysis (every PR-bot run) is
  // readable by whoever holds the link, so the path must not travel to third
  // parties. Sessions link out to osv.dev, mermaid.live and advisory pages.
  //
  // BE PRECISE ABOUT WHAT THIS FIXES. Measured before adding it — a real
  // cross-origin navigation out of /session/<id>/architecture sent
  // `Referer: http://localhost:3011/`, origin only. Every current browser
  // already defaults to strict-origin-when-cross-origin, nothing in the app
  // overrides it, and no page loads a third-party script, image or beacon. So
  // this closes no open leak; it removes the RELIANCE on a default, for old
  // browsers and embedded webviews (the GitHub mobile app's in-app browser is
  // the realistic one) that predate it.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
