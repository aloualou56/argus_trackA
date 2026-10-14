import { useEffect, useMemo, useState } from "react";
import { formatWhen, liveView, loadLive, type LiveFile, type RaisedState } from "../game/live";
import { formatReading } from "../game/logic";
import type { GameData, Monument } from "../game/types";
import { useI18n, type MessageKey } from "../i18n";

const RAISED_KEY: Record<RaisedState, MessageKey> = { watch: "live.watch", active: "live.active", escalated: "live.escalated" };

/**
 * "Live from ARGUS" on the first screen: the monitoring goes on after the game's snapshot. For the
 * chosen monument, last night's check of its dangers by ARGUS's risk model and its newest sensor
 * alarm the game can explain (game/live.ts). Shows nothing when the Pi's file is missing or old.
 */
export function LiveArgus({ data, mon }: { data: GameData; mon: Monument }) {
  const { t, pick, number, date, list, locale } = useI18n();
  const [file, setFile] = useState<LiveFile | null>(null);
  useEffect(() => {
    let current = true;
    loadLive().then((loaded) => current && setFile(loaded));
    return () => {
      current = false;
    };
  }, []);
  const view = useMemo(() => liveView(file, data, mon, new Date()), [file, data, mon]);
  if (!view) return null;

  const name = mon.display_name ? pick(mon.display_name) : mon.name;
  const pct = (p: number) => number(p * 100, p < 0.1 ? 1 : 0);
  const risk = view.risk;
  const alarm = view.alarm;
  const withUnit = (v: number) => formatReading(v, alarm?.rule.unit ?? null, number);
  const one = risk?.checked === 1;

  return (
    <section className="panel live-argus" aria-labelledby="live-title">
      <h2 id="live-title">
        {risk?.fresh && <span className="live-dot" aria-hidden="true" />}
        {t(risk?.fresh ? "live.title" : "live.titleOld")}
      </h2>
      <p className="live-where">{risk ? t("live.checked", { name, when: formatWhen(risk.at, new Date(), locale) }) : name}</p>
      {risk && (
        <>
          <p>
            {risk.raised.length
              ? t(one ? "live.checkedOne" : "live.checkedN", { n: risk.checked })
              : t(one ? "live.quietOne" : "live.quiet", { n: risk.checked })}
          </p>
          {(["escalated", "active", "watch"] as RaisedState[]).map((state) => {
            const items = risk.raised.filter((r) => r.state === state);
            if (!items.length) return null;
            const names = items.map((r) => `${r.scenario ? pick(r.scenario.plain.title) : t("live.unnamed")} (${pct(r.probability)}%)`);
            return (
              <p key={state} className={`live-raised is-${state}`}>
                <strong>{t(RAISED_KEY[state], { names: list(names) })}</strong>
              </p>
            );
          })}
          {risk.closest && (
            <p>
              {t("live.closest", {
                name: pick(risk.closest.scenario.plain.title),
                pct: pct(risk.closest.probability),
                watch: pct(risk.closest.watch),
              })}
            </p>
          )}
        </>
      )}
      {alarm && (
        <p>
          {alarm.ai
            ? t("live.alarmAi", { date: date(alarm.timestamp), measures: pick(alarm.rule.measures) })
            : t("live.alarm", {
                date: date(alarm.timestamp),
                measures: pick(alarm.rule.measures),
                value: withUnit(alarm.value),
                limit: withUnit(alarm.threshold),
              })}
        </p>
      )}
      <p className="small live-source">{t("live.source")}</p>
    </section>
  );
}
