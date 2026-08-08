import Link from "next/link";
import { Check } from "lucide-react";

import { TOK } from "@/lib/sessionTheme";

import styles from "./GuidedProgress.module.css";

const STEPS = ["Answer", "Evidence", "Workspace"] as const;

interface Props {
  current: 1 | 2 | 3;
  answerHref?: string;
}

export function GuidedProgress({ current, answerHref }: Props) {
  return (
    <nav className={styles.root} aria-label="Guided analysis progress">
      {STEPS.map((label, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const complete = step < current;
        const active = step === current;
        const content = (
          <>
            <span
              className={styles.marker}
              style={{
                borderColor: active || complete ? TOK.borderStrong : TOK.border,
                background: active ? TOK.textPrimary : TOK.surfaceElevated,
                color: active
                  ? TOK.bg
                  : complete
                    ? TOK.textPrimary
                    : TOK.textMuted,
              }}
            >
              {complete ? <Check size={9} aria-hidden="true" /> : step}
            </span>
            <span
              className={styles.label}
              style={{ color: active ? TOK.textPrimary : TOK.textMuted }}
            >
              {label}
            </span>
          </>
        );

        return (
          <span className={styles.stepWrap} key={label}>
            {step === 1 && complete && answerHref ? (
              <Link href={answerHref} className={styles.step}>
                {content}
              </Link>
            ) : (
              <span
                className={styles.step}
                aria-current={active ? "step" : undefined}
              >
                {content}
              </span>
            )}
            {step < 3 && (
              <span
                className={styles.connector}
                style={{ background: complete ? TOK.borderStrong : TOK.border }}
                aria-hidden="true"
              />
            )}
          </span>
        );
      })}
    </nav>
  );
}
