import type { ScreenProps } from "../App";
import { Icon } from "../components/Icon";
import { LevelBadge } from "../components/LevelBadge";
import { useI18n } from "../i18n";

export function Story({ mon, go }: ScreenProps) {
  const { t, tn, pick } = useI18n();
  const hook = mon.scenarios.find((s) => s.scenario_key === mon.story.hook_scenario);

  return (
    <article className="screen story">
      <h1 tabIndex={-1}>{pick(mon.display_name)}</h1>
      <p className="place">{pick(mon.place)}</p>
      <p className="lead" data-needs-review={mon.story.needs_review}>
        {pick(mon.story.text)}
      </p>

      {hook && (
        <section className="panel threat-hook" aria-labelledby="hook-title">
          <Icon name="bell" className="panel-icon" />
          <div>
            <h2 id="hook-title" data-needs-review={hook.plain.needs_review}>
              {pick(hook.plain.title)}
            </h2>
            <p data-needs-review={hook.plain.needs_review}>{pick(hook.plain.text)}</p>
            <LevelBadge id={hook.level} template="story.experts" />
          </div>
        </section>
      )}

      <section className="panel mission-brief" aria-labelledby="brief-title">
        <h2 id="brief-title">{t("story.missionTitle")}</h2>
        <p>{t("story.mission", { coins: tn("unit.coins", mon.budget) })}</p>
      </section>

      <div className="actions">
        <button type="button" className="btn btn-primary btn-big" onClick={() => go("mission")}>
          {t("story.continue")}
          <Icon name="arrow" />
        </button>
      </div>
    </article>
  );
}
