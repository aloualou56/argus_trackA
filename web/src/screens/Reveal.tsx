import { useMemo } from "react";
import type { ScreenProps } from "../App";
import { Icon } from "../components/Icon";
import { autoPrompts, cardById, compareMix, humanCards, nearestToArgus, owned, type AutoPrompt } from "../game/logic";
import { useI18n, type MessageKey } from "../i18n";

const MAX_PROMPTS = 4;

const PROMPT_KEYS: Record<AutoPrompt["kind"], MessageKey> = {
  distance: "reveal.promptDistance",
  many: "reveal.promptMany",
  onlyYou: "reveal.promptOnlyYou",
  onlyArgus: "reveal.promptOnlyArgus",
};

function Dots({ n, kind }: { n: number; kind: "you" | "argus" }) {
  return (
    <span className={`dots dots-${kind}`} aria-hidden="true">
      {Array.from({ length: Math.min(n, 8) }, (_, i) => (
        <span key={i} />
      ))}
    </span>
  );
}

export function Reveal({ data, mon, session, go }: ScreenProps) {
  const { t, pick, list } = useI18n();
  const cards = useMemo(() => cardById(data), [data]);
  const human = humanCards(data);
  const rows = compareMix(mon, session.picks, human);
  const pickedHuman = [...owned(session.picks)].filter((c) => human.has(c));
  const prompts = autoPrompts(rows, nearestToArgus(mon, session.placements));
  const cardName = (id: string) => pick(cards.get(id)?.name);
  const hasSatellite = mon.installed.by_card.some((r) => r.card === "satellite");
  // Alternate prompts from the player's choices with the monument's own, at most four.
  const autoItems = prompts.map((p) => ({
    key: p.kind,
    text: t(PROMPT_KEYS[p.kind], { n: p.n, name: cardName(p.card) }),
    review: false,
  }));
  const authoredItems = mon.discussion_prompts.map((p) => ({ key: p.en, text: pick(p), review: !!p.needs_review }));
  const promptItems = Array.from({ length: Math.max(autoItems.length, authoredItems.length) })
    .flatMap((_, i) => [autoItems[i], authoredItems[i]])
    .filter((p): p is NonNullable<typeof p> => !!p)
    .slice(0, MAX_PROMPTS);

  return (
    <div className="screen reveal">
      <h1 tabIndex={-1}>{t("reveal.heading")}</h1>
      <p className="lead">
        {t("reveal.intro", { n: mon.installed.distinct_instruments })}
        {hasSatellite && <> {t("reveal.satelliteNote")}</>}
      </p>

      <div className="table-wrap">
        <table className="mix">
          <caption>{t("reveal.tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("reveal.colSensor")}</th>
              <th scope="col" className="num">
                {t("reveal.colYou")}
              </th>
              <th scope="col" className="num">
                {t("reveal.colArgus")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.card} className={r.player > 0 && r.argus > 0 ? "match" : undefined}>
                <th scope="row">
                  <span className="row-label">
                    <Icon name={r.card} size={22} />
                    {cardName(r.card)}
                  </span>
                </th>
                <td className="num">
                  <Dots n={r.player} kind="you" />
                  <span className={r.player ? "count" : "count zero"}>{r.player}</span>
                </td>
                <td className="num">
                  <Dots n={r.argus} kind="argus" />
                  <span className={r.argus ? "count" : "count zero"}>{r.argus}</span>
                </td>
              </tr>
            ))}
            {mon.installed.other.map((o) => (
              <tr key={o.instrument_type}>
                <th scope="row">
                  <span className="row-label">
                    <Icon name="other" size={22} />
                    {t("reveal.other", { name: o.instrument_type })}
                  </span>
                </th>
                <td className="num">
                  <span className="count zero">0</span>
                </td>
                <td className="num">
                  <Dots n={o.count} kind="argus" />
                  <span className="count">{o.count}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pickedHuman.length > 0 && (
        <p className="note">
          <Icon name="observer" size={20} /> {t("reveal.human", { name: list(pickedHuman.map(cardName)) })}
        </p>
      )}
      <p className="note">{t("reveal.mapNote")}</p>
      <p className="note">{t("reveal.noWrong")}</p>

      <section className="panel discuss" aria-labelledby="discuss-title">
        <h2 id="discuss-title">
          <Icon name="talk" />
          {t("reveal.discuss")}
        </h2>
        <ul className="prompt-list">
          {promptItems.map((p) => (
            <li key={p.key} data-needs-review={p.review}>
              {p.text}
            </li>
          ))}
        </ul>
      </section>

      <div className="actions">
        <button type="button" className="btn btn-primary btn-big" onClick={() => go("event")}>
          {t("reveal.continue")}
          <Icon name="arrow" />
        </button>
      </div>
    </div>
  );
}
