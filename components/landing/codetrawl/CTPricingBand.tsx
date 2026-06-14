// CTPricingBand — one sentence, one button, nothing else. The CTA fill is
// orange budget slot 6 (the last of the six).

import Link from "next/link";
import { CTReveal } from "./CTReveal";

export function CTPricingBand() {
  return (
    <section className="section priceband">
      <div className="wrap">
        <CTReveal className="rv-block">
          {/* Plain English — "Depth is the paid tier" named a tier that
              doesn't exist (the audit caught the collision with the real
              tier names one click away on /pricing). */}
          <p className="price-line">
            Free for public repositories. Paid plans unlock the full survey.
          </p>
          <Link href="/pricing" className="price-cta">
            See pricing
          </Link>
        </CTReveal>
      </div>
    </section>
  );
}
