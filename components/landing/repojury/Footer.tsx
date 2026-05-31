import Link from "next/link";
import { CrestSeal } from "./seals";

export function RJFooter() {
  return (
    <footer>
      <div className="wrap foot">
        <div className="brand">
          <CrestSeal className="seal-sm" />
          <span>
            <b>Repo</b>Jury
          </span>
        </div>
        <div className="foot-links">
          <a href="#process">How it works</a>
          <a href="#custody">Chain of custody</a>
          <Link href="/pricing">Pricing</Link>
        </div>
        <div className="copy">© 2026 REPOJURY · REPOJURY.COM</div>
      </div>
      <div className="wrap foot-legal">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        <Link href="/cookies">Cookies</Link>
        <Link href="/refunds">Refunds</Link>
      </div>
    </footer>
  );
}
