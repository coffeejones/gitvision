"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

const STEPS = [
  {
    key: "overview",
    eyebrow: "01 / Orient",
    label: "Overview",
    title: "Know where to start.",
    detail:
      "Turn a repository into a shared map of health, history and the findings that deserve attention first.",
    evidence: ["Computed top finding", "Health across every analysis lens"],
    src: "/CT_UpdatedImages/CT_Overview.png",
    alt: "CodeTrawl repository overview for pallets/flask",
  },
  {
    key: "source",
    eyebrow: "02 / Change",
    label: "Source",
    title: "See what the edit can touch.",
    detail:
      "Follow callers, dependents, complexity and untested paths before a local change becomes a system-wide surprise.",
    evidence: ["Function-level blast radius", "Evidence attached to the source"],
    src: "/CT_UpdatedImages/CT_Code.png",
    alt: "CodeTrawl source and blast-radius analysis",
  },
  {
    key: "security",
    eyebrow: "03 / Review",
    label: "Security",
    title: "Inspect the exact risk.",
    detail:
      "Security findings name the pattern, location and evidence. Your team reviews the same facts the product used.",
    evidence: ["Named deterministic rules", "File and line-level evidence"],
    src: "/CT_UpdatedImages/CT_SecurityReview.png",
    alt: "CodeTrawl deterministic security review",
  },
  {
    key: "supply",
    eyebrow: "04 / Maintain",
    label: "Supply",
    title: "Keep dependency drift visible.",
    detail:
      "Find vulnerable, outdated and deprecated packages across every detected ecosystem without losing registry context.",
    evidence: ["CVE-aware package health", "Multi-ecosystem analysis"],
    src: "/CT_UpdatedImages/CT_Packages.png",
    alt: "CodeTrawl dependency health analysis",
  },
] as const;

export function CTProductTour() {
  const [active, setActive] = useState(0);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);

  useEffect(() => {
    let frame = 0;

    // Intersection ratios oscillate around section boundaries during smooth
    // scroll. Pick the chapter whose centre is closest to one fixed viewport
    // focal line instead — one scroll position can now produce only one state.
    const updateActive = () => {
      frame = 0;
      const focalY = window.innerHeight * 0.47;
      let next = 0;
      let nearest = Number.POSITIVE_INFINITY;

      stepRefs.current.forEach((step, index) => {
        if (!step) return;
        const rect = step.getBoundingClientRect();
        const distance = Math.abs(rect.top + rect.height / 2 - focalY);
        if (distance < nearest) {
          nearest = distance;
          next = index;
        }
      });

      setActive((current) => current === next ? current : next);
    };

    const requestUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(updateActive);
    };

    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    requestUpdate();

    return () => {
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="ct-tour">
      {/* The adjacent step copy carries the full narrative. The sticky desktop
          screenshot is supporting visual proof, so keep chapter changes out of
          the screen-reader announcement queue; mobile gets the same images with
          descriptive alt text inside each linear chapter below. */}
      <div className="ct-tour-visual" aria-hidden="true">
        <div className="ct-tour-window">
          <div className="ct-tour-chrome">
            <span>CODETRAWL / PALLETS-FLASK</span>
            <span>0{active + 1} / 04 · {STEPS[active].label}</span>
          </div>
          <div className="ct-tour-images">
            {STEPS.map((step, index) => (
              <Image
                key={step.key}
                className={`ct-tour-image${index === active ? " active" : ""}`}
                src={step.src}
                alt=""
                width={2940}
                height={1508}
              />
            ))}
            <span key={STEPS[active].key} className="ct-tour-transition-light" aria-hidden />
          </div>
        </div>
        <div className="ct-tour-progress" aria-hidden>
          {STEPS.map((step, index) => (
            <span
              key={step.key}
              className={index === active ? "active" : index < active ? "complete" : ""}
            />
          ))}
        </div>
      </div>

      <div className="ct-tour-steps">
        {STEPS.map((step, index) => (
          <article
            key={step.key}
            ref={(node) => { stepRefs.current[index] = node; }}
            data-tour-step={index}
            className={`ct-tour-step${index === active ? " active" : ""}`}
          >
            <p>{step.eyebrow}</p>
            <h3>{step.title}</h3>
            <p>{step.detail}</p>
            <ul>
              {step.evidence.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <div className="ct-tour-mobile-window">
              <Image src={step.src} alt={step.alt} width={2940} height={1508} />
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
