import type { ScreenProps } from "../App";
import { budgetFor, formatCoords, missionScenarios } from "../game/logic";
import { Icon } from "../components/Icon";
import { PhotoCredit } from "../components/PhotoCredit";
import { LevelBadge, LevelBars, levelKey } from "../components/LevelBadge";
import { useI18n } from "../i18n";

export function Story({ mon, session, go }: ScreenProps) {
  const { t, tn, pick } = useI18n();
  // The story card shows a danger of this mission, at the chosen level where it has one (the
  // monument's own hook when it is in the mission): a Low game never opens on a Catastrophic danger.
  const mission = missionScenarios(mon, session.level, session.mission);
  const hook =
    mission.find((s) => s.scenario_key === mon.story.hook_scenario) ??
    mission.find((s) => s.level === session.level) ??
    mission[0];
  const budget = budgetFor(mon, session.level);

  return (
    <article className="screen story">
      <h1 tabIndex={-1}>{pick(mon.display_name)}</h1>
      <p className="place">{pick(mon.place)}</p>
      {/* Where the ARGUS sensors are, as a map sheet would print it. */}
      {mon.map && <p className="coords">{formatCoords(mon.map.center)}</p>}
      {mon.photo && (
        <figure className="story-photo">
          {/* The caption beside it says what the photo shows, so the picture itself is not read out twice. */}
          <img src={`${import.meta.env.BASE_URL}${mon.photo.src}`} alt="" />
          <figcaption>
            <span data-needs-review={mon.photo.needs_review}>{pick(mon.photo.caption)}</span>
            <PhotoCredit photo={mon.photo} />
          </figcaption>
        </figure>
      )}
      <p className="lead" data-needs-review={mon.story.needs_review}>
        {pick(mon.story.text)}
      </p>

      {hook && (
        <section className="sheet-note threat-hook" aria-labelledby="hook-title">
          <p className="eyebrow">{t("story.dangerLabel")}</p>
          <h2 id="hook-title" data-needs-review={hook.plain.needs_review}>
            {pick(hook.plain.title)}
          </h2>
          <p data-needs-review={hook.plain.needs_review}>{pick(hook.plain.text)}</p>
          <LevelBadge id={hook.level} template="story.experts" />
        </section>
      )}

      {/* The player's orders, and the way on: the one inverted block of this screen. */}
      <section className="mission-brief" aria-labelledby="brief-title">
        <p className="eyebrow brief-level">
          <LevelBars id={session.level} />
          {t("level.badge", { level: t(levelKey(session.level)) })}
        </p>
        <h2 id="brief-title">{t("story.missionTitle")}</h2>
        <p>{t("story.mission", { coins: tn("unit.coins", budget) })}</p>
        {/* The coins themselves, in fives, to count: the sentence above already says how many. */}
        <p className="coin-row" aria-hidden="true">
          {Array.from({ length: Math.ceil(budget / 5) }, (_, five) => (
            <span key={five}>
              {Array.from({ length: Math.min(5, budget - five * 5) }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          ))}
        </p>
        <div className="actions">
          <button type="button" className="btn btn-primary btn-big" onClick={() => go("mission")}>
            {t("story.continue")}
            <Icon name="arrow" />
          </button>
        </div>
      </section>
    </article>
  );
}
