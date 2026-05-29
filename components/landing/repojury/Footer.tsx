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
          <a href="#departments">Departments</a>
          <a href="#trial">How it works</a>
          <a href="#custody">Chain of custody</a>
          <a href="#pricing">Pricing</a>
        </div>
        <div className="copy">© 2026 REPOJURY · REPOJURY.COM</div>
      </div>
    </footer>
  );
}
