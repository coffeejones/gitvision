// Shared PNG-export for the branded share cards (ShareCard / WallCard /
// DriftCard / ContributorWrapped / BlastCard). Every card modal was hand-rolling
// the identical html-to-image toPng + anchor-download block, drifting on the
// exact options — this is the single source of truth.
//
// Client-only: it touches `document` and rasterizes a live DOM node, so it must
// be called from a browser event handler, never during SSR.
//
// The `style: { transform: "none" }` override is load-bearing: the modals show
// the card scaled down via a CSS `transform: scale(...)`, and without cancelling
// it the capture would bake in the shrunken preview. Explicit width/height pin
// the true pixel box; pixelRatio 2 gives a crisp @2x asset; cacheBust dodges
// stale CORS-less cache hits on embedded images.

import * as htmlToImage from "html-to-image";

export interface DownloadCardPngOptions {
  /** True pixel width of the card (its unscaled box). */
  width: number;
  /** True pixel height of the card. */
  height: number;
  /** Download filename; a `.png` suffix is appended if missing. */
  filename: string;
}

/** Rasterize a fixed-dimension card node to a 2× PNG and trigger a download.
 *  Throws if the node isn't mounted or html-to-image fails (tainted canvas from
 *  a cross-origin image, insecure context, etc.) — callers surface the message. */
export async function downloadCardPng(
  el: HTMLElement | null,
  opts: DownloadCardPngOptions,
): Promise<void> {
  if (!el) throw new Error("Card not mounted");
  const dataUrl = await htmlToImage.toPng(el, {
    pixelRatio: 2,
    cacheBust: true,
    width: opts.width,
    height: opts.height,
    style: { transform: "none" }, // override the preview's scale() transform
  });
  const link = document.createElement("a");
  link.download = opts.filename.toLowerCase().endsWith(".png")
    ? opts.filename
    : `${opts.filename}.png`;
  link.href = dataUrl;
  link.click();
}
