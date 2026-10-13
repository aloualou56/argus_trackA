import type { ReactNode } from "react";
import type { Monument } from "../game/types";
import { useI18n } from "../i18n";

// The imaginary guardian of a monument: hands the watch over on the story screen and comes back on
// the score screen. A drawn portrait (decorative), the name and role, and what they say. The note
// under it says the character is imaginary, so the real data is never confused with the story.

type Hat = "cap" | "beret" | "ranger" | "none" | "beanie";

/** Each guardian dresses for their place: a guard's cap on Delos, a ranger's hat in the park... */
const HATS: Record<string, Hat> = {
  delos: "cap",
  baltanas: "beret",
  lucretili: "ranger",
  ranverso: "none",
  schenkenberg: "beanie",
};

function Portrait({ hat }: { hat: Hat }) {
  return (
    <svg className="guardian-portrait" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <circle className="gp-bg" cx="32" cy="32" r="31" />
      <path className="gp-body" d="M10 60c2-12 11-18 22-18s20 6 22 18" />
      <circle className="gp-face" cx="32" cy="28" r="11" />
      <circle className="gp-eye" cx="28" cy="28" r="1.3" />
      <circle className="gp-eye" cx="36" cy="28" r="1.3" />
      <path className="gp-line" d="M28.5 33.5c2 1.6 5 1.6 7 0" />
      {hat === "cap" && <path className="gp-hat" d="M20 22c1-7 6-10 12-10s11 3 12 10zM18 22h28l-2 3H20z" />}
      {hat === "beret" && <path className="gp-hat" d="M19 21c0-6 7-9 14-9s12 3 12 7c0 2-3 3-6 3H22c-2 0-3-0.5-3-1zM32 12v-3" />}
      {hat === "ranger" && <path className="gp-hat" d="M14 23c4-1 8-1.5 10-2 0-6 3-10 8-10s8 4 8 10c2 .5 6 1 10 2-6 2-30 2-36 0z" />}
      {hat === "beanie" && <path className="gp-hat" d="M20 23c0-8 5-13 12-13s12 5 12 13zM20 23h24v3H20zM32 10a2.5 2.5 0 1 1 0-.1" />}
      {hat === "none" && <path className="gp-hair" d="M21 26c0-8 5-12 11-12s11 4 11 12c-2-4-6-6-11-6s-9 2-11 6z" />}
      <path className="gp-badge" d="M40 50l3 2-1 3.5h-4L37 52z" />
    </svg>
  );
}

export function GuardianSays({
  mon,
  title,
  eyebrow,
  text,
  headingId,
  children,
}: {
  mon: Monument;
  /** The section's heading (an h2). */
  title: string;
  eyebrow?: string;
  /** What the guardian says. */
  text: string;
  headingId: string;
  children?: ReactNode;
}) {
  const { t, pick } = useI18n();
  const g = mon.guardian;
  if (!g) return null;
  const name = pick(g.name);
  return (
    <section className="guardian" aria-labelledby={headingId}>
      <Portrait hat={HATS[mon.pilot_key] ?? "cap"} />
      <div className="guardian-body">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={headingId} className="guardian-title">
          {title}
        </h2>
        <p className="guardian-role" data-needs-review={g.needs_review}>
          {pick(g.role)}
        </p>
        <blockquote className="guardian-words" data-needs-review={g.needs_review}>
          <p>{text}</p>
        </blockquote>
        {children}
        <p className="small guardian-note">{t("guardian.imaginary", { name })}</p>
      </div>
    </section>
  );
}
