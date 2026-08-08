import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  GitPullRequestArrow,
  Map,
  ScanSearch,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";

import type { WorkspaceGoalGuidance } from "@/lib/brief/guidance";
import type { WorkspaceGoalId } from "@/lib/brief/goals";
import { TOK } from "@/lib/sessionTheme";

import styles from "./GuidedGoalPicker.module.css";

const ICONS: Record<WorkspaceGoalId, LucideIcon> = {
  security: ShieldCheck,
  understand: Map,
  improve: Wrench,
  change: GitPullRequestArrow,
};

interface Props {
  guidance: WorkspaceGoalGuidance;
  signalCount: number;
  functionCount: number;
  snapshotCount: number;
}

export function GuidedGoalPicker({
  guidance,
  signalCount,
  functionCount,
  snapshotCount,
}: Props) {
  const recommendation = guidance.recommendation;

  return (
    <section className={styles.root} aria-labelledby="guided-goal-heading">
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow} style={{ color: TOK.textMuted }}>
            Guided analysis
          </span>
          <h1 id="guided-goal-heading" style={{ color: TOK.textPrimary }}>
            What do you need from this repository?
          </h1>
          <p style={{ color: TOK.textSecondary }}>
            Pick the question you came to answer. CodeTrawl will compose the
            relevant workspace evidence without hiding the rest of the product.
          </p>
        </div>

        <div className={styles.analysisMeta} style={{ borderColor: TOK.border }}>
          <span className={styles.ready} style={{ color: TOK.textPrimary }}>
            <span style={{ background: TOK.accent }} aria-hidden="true" />
            Analysis ready
          </span>
          <span style={{ color: TOK.textMuted }}>
            Snapshot {snapshotCount} · {signalCount} deterministic signals
          </span>
          <span style={{ color: TOK.textMuted }}>
            {functionCount > 0
              ? `${functionCount.toLocaleString()} functions mapped`
              : "Code map unavailable"}
          </span>
          <span className={styles.workspaceNote} style={{ color: TOK.textSecondary }}>
            The full workspace remains available.
          </span>
        </div>
      </header>

      {recommendation ? (
        <article
          className={styles.recommendation}
          style={{
            borderColor:
              recommendation.kind === "action" ? TOK.rose : TOK.borderStrong,
          }}
          aria-label={`${recommendation.label}: ${recommendation.title}`}
        >
          <div className={styles.recommendationHeading}>
            <span
              className={styles.recommendationLabel}
              style={{
                color:
                  recommendation.kind === "action" ? TOK.rose : TOK.textPrimary,
              }}
            >
              <span
                style={{
                  background:
                    recommendation.kind === "action" ? TOK.rose : TOK.accent,
                }}
                aria-hidden="true"
              />
              {recommendation.label}
            </span>
            <span style={{ color: TOK.textMuted }}>
              Suggested starting point · not required
            </span>
          </div>

          <div className={styles.recommendationGrid}>
            <div className={styles.finding}>
              <span className={styles.kicker} style={{ color: TOK.textMuted }}>
                What CodeTrawl found
              </span>
              <h2 style={{ color: TOK.textPrimary }}>
                {recommendation.title}
              </h2>
              <p style={{ color: TOK.textSecondary }}>
                {recommendation.finding}
              </p>
            </div>

            <div className={styles.reason} style={{ borderColor: TOK.border }}>
              <span className={styles.kicker} style={{ color: TOK.textMuted }}>
                Why it earned attention
              </span>
              <p style={{ color: TOK.textSecondary }}>{recommendation.why}</p>
            </div>

            <div className={styles.nextStep}>
              <span className={styles.kicker} style={{ color: TOK.textMuted }}>
                Sensible next step
              </span>
              <p style={{ color: TOK.textSecondary }}>
                {recommendation.suggestedAction}
              </p>
              <div className={styles.recommendationActions}>
                <Link
                  href={recommendation.evidenceHref}
                  className={styles.primaryAction}
                  style={{
                    background: TOK.accent,
                    color: TOK.accentOn,
                    borderColor: TOK.accent,
                  }}
                >
                  <ScanSearch size={14} aria-hidden="true" />
                  Review evidence
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
                <Link
                  href={recommendation.answerHref}
                className={styles.secondaryAction}
                style={{
                  borderColor: TOK.border,
                  color: TOK.textPrimary,
                  background: TOK.surfaceElevated,
                }}
                >
                  <BookOpenText size={14} aria-hidden="true" />
                  Read answer
                </Link>
              </div>
            </div>
          </div>
        </article>
      ) : (
        <div className={styles.neutral} style={{ borderColor: TOK.border }}>
          <span className={styles.neutralMark} style={{ color: TOK.textMuted }}>
            —
          </span>
          <div>
            <strong style={{ color: TOK.textPrimary }}>
              No single issue outranks your goal.
            </strong>
            <p style={{ color: TOK.textMuted }}>
              The workspace may still contain findings, but none met the rule
              for steering your starting point.
            </p>
          </div>
        </div>
      )}

      <section className={styles.goals} aria-labelledby="goal-list-heading">
        <div className={styles.goalHeading}>
          <div>
            <span className={styles.eyebrow} style={{ color: TOK.textMuted }}>
              Four ways in
            </span>
            <h2 id="goal-list-heading" style={{ color: TOK.textPrimary }}>
              Choose a direction
            </h2>
          </div>
          <p style={{ color: TOK.textMuted }}>
            Each goal opens a focused answer, then lets you continue into its
            underlying workspace evidence.
          </p>
        </div>

        <div className={styles.goalGrid} aria-label="Choose an analysis goal">
          {guidance.goals.map((goal, index) => {
            const Icon = ICONS[goal.id];
            return (
              <Link
                key={goal.id}
                href={goal.href}
                className={styles.goalCard}
                style={{ borderColor: TOK.border, background: TOK.surface }}
              >
                <span className={styles.goalCardTop}>
                  <span
                    className={styles.icon}
                    style={{
                      borderColor: TOK.border,
                      background: TOK.surfaceElevated,
                      color: TOK.textSecondary,
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className={styles.goalNumber} style={{ color: TOK.textMuted }}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </span>

                <span className={styles.goalCategory} style={{ color: TOK.textMuted }}>
                  {goal.category}
                </span>
                <strong style={{ color: TOK.textPrimary }}>{goal.title}</strong>
                <span className={styles.goalDescription} style={{ color: TOK.textSecondary }}>
                  {goal.description}
                </span>

                <span className={styles.goalEvidence} style={{ borderColor: TOK.border }}>
                  <span className={styles.kicker} style={{ color: TOK.textMuted }}>
                    In this snapshot
                  </span>
                  <span style={{ color: TOK.textSecondary }}>{goal.insight}</span>
                </span>

                <span className={styles.goalFoot}>
                  <span style={{ color: TOK.textMuted }}>{goal.footnote}</span>
                  <span style={{ color: TOK.textPrimary }}>
                    Start here <ArrowRight size={14} aria-hidden="true" />
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <p className={styles.footer} style={{ color: TOK.textMuted }}>
        A recommendation is evidence, not intent. You can leave guided analysis
        through the workspace navigation at any time.
      </p>
    </section>
  );
}
