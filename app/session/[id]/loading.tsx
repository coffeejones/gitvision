// The skeleton shown while a session tab is being rendered on the server.
//
// There was none. Clicking a tab left the PREVIOUS page on screen, unchanged
// and unresponsive, until the new one arrived — measured at 99-185ms on a
// 12.6 MB session and 263-446ms on the 55 MB one. Nothing told the reader the
// click had landed, which is most of what "it doesn't feel snappy" means.
//
// This sits beside layout.tsx, so it replaces only the PAGE slot: the sidebar,
// the toolbar and the scroll position all stay put and only the content area
// swaps. That is the honest shape of the wait — the shell really is still
// there, and pretending otherwise (a full-screen spinner) would be a bigger
// visual jump than the wait it covers.
//
// Deliberately generic. The seventeen tabs have different layouts, and a
// skeleton that mimicked one of them would be wrong on the other sixteen; an
// eyebrow, a title and a few blocks is what they all share. The frame matches
// the pages' own `px-8 pt-12 pb-16 … max-w-7xl mx-auto` so nothing shifts
// sideways when the real content lands.

import { TOK } from "@/lib/sessionTheme";

/** One shimmering block. Sized in px so the skeleton keeps its shape before
 *  any font has loaded.
 *
 *  surfaceElevated, not surface: the first version used TOK.surface (#171615)
 *  on TOK.bg (#0c0b0b) and the blocks were almost invisible — which defeats the
 *  only job a skeleton has, which is to say "your click landed". */
function Bar({
  w,
  h = 14,
  delay = 0,
}: {
  w: number | string;
  h?: number;
  delay?: number;
}) {
  return (
    <div
      className="ct-skeleton"
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: h,
        borderRadius: h >= 40 ? 10 : 4,
        background: TOK.surfaceElevated,
        animationDelay: `${delay}ms`,
      }}
    />
  );
}

export default function SessionLoading() {
  return (
    <main
      className="px-8 pt-12 pb-16 flex flex-col gap-10 max-w-7xl mx-auto w-full"
      aria-busy="true"
      aria-live="polite"
    >
      {/* Screen readers get a word; sighted readers get the shape. */}
      <span className="sr-only">Loading</span>

      <header className="flex flex-col gap-4" aria-hidden>
        <Bar w={90} h={10} />
        <Bar w={280} h={30} delay={60} />
        <Bar w={420} h={14} delay={120} />
      </header>

      <div className="flex flex-col gap-3" aria-hidden>
        <Bar w="100%" h={92} delay={180} />
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Bar key={i} w="100%" h={76} delay={220 + i * 40} />
          ))}
        </div>
      </div>
    </main>
  );
}
