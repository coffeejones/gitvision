// Shared brass crest used in the nav, verdict document, and footer.
// References the <linearGradient id="brass"> defined once in RepoJury.
// Pure SVG — safe to use from both server and client components.

export function CrestSeal({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      stroke="url(#brass)"
      strokeWidth={1.4}
      aria-hidden
    >
      <circle cx="20" cy="20" r="17" />
      <circle cx="20" cy="20" r="13" strokeWidth={0.8} />
      <path d="M20 9 L20 31 M11 14 h18 M13 24 a7 7 0 0 0 14 0" strokeWidth={1.2} />
      <path d="M11 14 l-2 5 h4 z M29 14 l-2 5 h4 z" fill="url(#brass)" stroke="none" />
    </svg>
  );
}
