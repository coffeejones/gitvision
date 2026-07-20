// CTStripe — the credibility line under the hero: one centered mono ledger
// line between hairlines. Names the actual techniques (the technical-depth
// proof) and closes with the positioning lockup. No orange — the stripe
// earns attention through specificity, not color.

export function CTStripe() {
  return (
    <section className="stripe">
      <div className="wrap">
        {/* Scoped, not absolute — the AI section two scrolls down says the
            model narrates, so the lockup must say WHAT is computed (grades +
            signals) or the page quotes itself into a contradiction. */}
        <p>
          <b>COMPUTED, NEVER GENERATED</b> — every grade and signal is
          deterministic: tree-sitter AST parsing · full-history git analysis ·
          resolved dependency graphs. The model narrates — it never decides
          the grade.
        </p>
      </div>
    </section>
  );
}
