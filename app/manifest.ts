import type { MetadataRoute } from "next";

// PWA manifest — CodeTrawl brand name + icons + bitumen chrome. Next auto-adds
// the <link rel="manifest"> and serves this at /manifest.webmanifest. Icons are
// the orange swirl from public/icon; theme/background match the app's bitumen
// black so the mobile chrome + splash don't flash a light frame.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CodeTrawl",
    short_name: "CodeTrawl",
    description:
      "Deterministic repository intelligence with evidence attached to every finding.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c0b0a",
    theme_color: "#0c0b0a",
    icons: [
      {
        src: "/icon/CodeTrawl-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon/CodeTrawl-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
