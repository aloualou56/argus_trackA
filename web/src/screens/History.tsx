import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { ScreenProps } from "../App";
import type { MapApi } from "../components/GameMap";
import { Icon } from "../components/Icon";
import { useI18n } from "../i18n";

interface Props extends ScreenProps {
  mapApi: MutableRefObject<MapApi | null>;
  /** Back to the story screen, at its danger (the end of the story, or leaving it early). */
  onBack: () => void;
}

/**
 * The whole story of the site (content/history/<pilot>.json), one chapter at a time, opened from the
 * story screen. A chapter about one part of the site moves the map there. It ends by going back to
 * the danger on the story screen, where the mission starts.
 */
export function History({ mon, onBack, mapApi, announce }: Props) {
  const { t, pick } = useI18n();
  const chapters = mon.history?.chapters ?? [];
  const [index, setIndex] = useState(0);
  const chapter = chapters[index];
  const title = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // A chapter about one part of the site shows it on the map.
  useEffect(() => {
    const place = chapter?.place ? mon.places.find((p) => p.id === chapter.place) : null;
    if (!place) return;
    mapApi.current?.focus([place.lat, place.lon]);
    announce(t("map.movedTo", { name: pick(place.name) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // A new chapter starts at its title, for the eye and for the keyboard (the screen's own heading
  // takes the focus when the screen opens).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    title.current?.closest(".board-panel")?.scrollTo({ top: 0 });
    title.current?.focus();
  }, [index]);

  if (!chapter) return null;
  const last = index === chapters.length - 1;

  return (
    <article className="screen history">
      <h1 tabIndex={-1}>{t("history.heading")}</h1>
      <p className="place">{pick(mon.display_name)}</p>

      <section className="history-chapter" aria-labelledby="chapter-title">
        <p className="eyebrow">{t("history.chapter", { n: index + 1, total: chapters.length })}</p>
        <h2 id="chapter-title" tabIndex={-1} ref={title} data-needs-review={mon.history?.needs_review}>
          {pick(chapter.title)}
        </h2>
        {pick(chapter.text)
          .split("\n\n")
          .map((paragraph, i) => (
            <p key={i} data-needs-review={mon.history?.needs_review}>
              {paragraph}
            </p>
          ))}
      </section>

      {/* The chapters as dots: which one this is, and how many are left. */}
      <ol className="history-dots" aria-hidden="true">
        {chapters.map((_, i) => (
          <li key={i} className={i === index ? "is-now" : i < index ? "is-done" : ""} />
        ))}
      </ol>

      <div className="actions history-actions">
        {index > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => setIndex(index - 1)}>
            {t("history.previous")}
          </button>
        )}
        {last ? (
          <button type="button" className="btn btn-primary btn-big" onClick={onBack}>
            {t("history.done")}
            <Icon name="arrow" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-big" onClick={() => setIndex(index + 1)}>
            {t("history.next")}
            <Icon name="arrow" />
          </button>
        )}
      </div>
      {!last && (
        <p className="history-leave">
          <button type="button" className="btn btn-quiet" onClick={onBack}>
            {t("history.done")}
          </button>
        </p>
      )}
    </article>
  );
}
