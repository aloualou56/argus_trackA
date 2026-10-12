// Citizen observation report: a visitor says what they saw, where (a pin on the same map) and when,
// may add a photo, and gets a card to print or show to a guard. Everything stays on the device:
// nothing here is sent anywhere, and the photo is not even stored (it lives while the page is open).
import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { ReportStore } from "../community/reports";
import type { MapApi } from "../components/GameMap";
import { BrandMark } from "../components/BrandMark";
import { Dropdown } from "../components/Dropdown";
import { Icon } from "../components/Icon";
import { isPlayable } from "../game/logic";
import {
  localDay,
  makeReport,
  nearestPlace,
  NOTE_MAX,
  OTHER_ITEM,
  reportFileName,
  reportProblems,
  toArgusDocumentation,
  type ObservationReport,
  type ReportProblem,
} from "../game/report";
import type { GameData, LatLng, Monument } from "../game/types";
import { useI18n, type MessageKey } from "../i18n";

/** What the map needs to know about the report in hand (kept by App, next to the map). */
export interface ReportOnMap {
  pilot: string;
  at: LatLng | null;
  /** false while a finished card is shown: its pin can no longer be moved. */
  editable: boolean;
}

interface Props {
  data: GameData;
  report: ReportOnMap;
  setReport: (change: Partial<ReportOnMap>) => void;
  mapApi: MutableRefObject<MapApi | null>;
  announce: (message: string) => void;
  onBack: () => void;
}

const PROBLEM: Record<ReportProblem, { key: MessageKey; focus: string }> = {
  what: { key: "report.needWhat", focus: "report-item-0" },
  where: { key: "report.needWhere", focus: "report-place-0" },
  when: { key: "report.needWhen", focus: "report-day" },
};

export function Observe({ data, report, setReport, mapApi, announce, onBack }: Props) {
  const { t, pick, number, date } = useI18n();
  const monuments = useMemo(() => data.monuments.filter(isPlayable), [data]);
  const mon = monuments.find((m) => m.pilot_key === report.pilot) ?? monuments[0];
  const store = useMemo(() => new ReportStore(), []);
  const [saved, setSaved] = useState<ObservationReport[]>(() => store.list());
  const [item, setItem] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [day, setDay] = useState(localDay);
  // The photo of the card being made. Only an address inside this page: never stored, never sent.
  const [photo, setPhoto] = useState<{ url: string; forCard: string | null } | null>(null);
  const [problems, setProblems] = useState<ReportProblem[]>([]);
  const [card, setCard] = useState<ObservationReport | null>(null);
  const [status, setStatus] = useState("");
  const cardTitle = useRef<HTMLHeadingElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Give the browser its memory back when the photo is replaced, removed, or the screen is left.
  useEffect(() => {
    const url = photo?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo?.url]);

  useEffect(() => {
    if (card) cardTitle.current?.focus();
  }, [card]);

  const where = (m: Monument, at: LatLng) => {
    const place = nearestPlace(m, at);
    const spot = `${number(at[0], 5)}, ${number(at[1], 5)}`;
    return place ? `${t("report.near", { name: pick(place.name) })} (${spot})` : spot;
  };

  const choosePlace = (lat: number, lon: number) => {
    setReport({ at: [lat, lon] });
    mapApi.current?.focus([lat, lon]);
  };

  // Say where the pin is whenever it moves: by a tap or a drag on the map, or by choosing a place.
  const spot = report.editable && report.at ? where(mon, report.at) : null;
  useEffect(() => {
    if (spot) announce(t("report.whereSet", { where: spot }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spot]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const draft = { monument: mon.pilot_key, item, note, at: report.at, day, hasPhoto: !!photo };
    const missing = reportProblems(draft);
    setProblems(missing);
    if (missing.length) {
      announce(missing.map((p) => t(PROBLEM[p].key)).join(" "));
      document.getElementById(PROBLEM[missing[0]].focus)?.focus();
      return;
    }
    const made = makeReport(draft, mon);
    store.add(made);
    setSaved(store.list());
    setPhoto((p) => p && { ...p, forCard: made.id });
    setCard(made);
    setReport({ editable: false });
    setStatus("");
    announce(t("report.ready"));
  };

  const startAgain = () => {
    setCard(null);
    setItem(null);
    setNote("");
    setDay(localDay());
    setPhoto(null);
    setProblems([]);
    setStatus("");
    setReport({ at: null, editable: true });
  };

  const show = (r: ObservationReport) => {
    setCard(r);
    setStatus("");
    setReport({ pilot: r.monument, at: [r.lat, r.lng], editable: false });
    mapApi.current?.focus([r.lat, r.lng]);
  };

  const remove = (r: ObservationReport) => {
    store.remove(r.id);
    setSaved(store.list());
    announce(t("report.deleted"));
  };

  const saveFile = (r: ObservationReport, m: Monument) => {
    const text = `${JSON.stringify(toArgusDocumentation(r, m, data.checklist.items), null, 2)}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = reportFileName(r);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(t("report.saved"));
  };

  const itemText = (id: string) => {
    const found = data.checklist.items.find((i) => i.id === id);
    return found ? pick(found.text) : t("report.other");
  };

  // ---------------------------------------------------------------- the finished card
  if (card) {
    const cardMon = monuments.find((m) => m.pilot_key === card.monument) ?? mon;
    const cardPhoto = photo?.forCard === card.id ? photo.url : null;
    return (
      <div className="screen observe">
        <h1 tabIndex={-1}>{t("report.title")}</h1>
        <section className="panel report-card printable" aria-labelledby="card-title">
          <p className="report-card-brand">
            <BrandMark size={22} />
            {t("app.title")}
          </p>
          <h2 id="card-title" tabIndex={-1} ref={cardTitle}>
            {t("report.cardTitle")}
          </h2>
          <p className="report-card-id">{t("report.cardId", { id: card.id })}</p>
          <dl className="report-facts">
            <div>
              <dt>{t("report.cardMonument")}</dt>
              <dd>
                {pick(cardMon.display_name)}, {pick(cardMon.place)}
              </dd>
            </div>
            <div>
              <dt>{t("report.cardWhat")}</dt>
              <dd>{itemText(card.item)}</dd>
            </div>
            {card.note && (
              <div>
                <dt>{t("report.cardNote")}</dt>
                <dd>{card.note}</dd>
              </div>
            )}
            <div>
              <dt>{t("report.cardWhere")}</dt>
              <dd>{where(cardMon, [card.lat, card.lng])}</dd>
            </div>
            <div>
              <dt>{t("report.cardWhen")}</dt>
              <dd>{date(card.day)}</dd>
            </div>
          </dl>
          {cardPhoto && <img className="report-photo" src={cardPhoto} alt={t("report.photoAlt")} />}
          <p className="report-card-staff">{t("report.cardStaff")}</p>
        </section>

        <p className="citizen-report" data-needs-review={data.checklist.needs_review}>
          <strong>{pick(data.checklist.report)}</strong>
        </p>
        <div className="actions actions-split">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            {t("report.print")}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => saveFile(card, cardMon)}>
            {t("report.save")}
          </button>
        </div>
        <p className="small">{t("report.saveHelp")}</p>
        <p className="small" role="status">
          {status}
        </p>
        <div className="actions actions-split">
          <button type="button" className="btn btn-secondary btn-big" onClick={startAgain}>
            {t("report.again")}
          </button>
          <button type="button" className="btn btn-secondary btn-big" onClick={onBack}>
            {t("report.back")}
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- the form
  // "Where" stops being a problem the moment a spot is marked on the map.
  const has = (p: ReportProblem) => problems.includes(p) && !(p === "where" && report.at);
  const options = [...data.checklist.items.map((i) => ({ id: i.id, icon: i.icon, text: pick(i.text) })), { id: OTHER_ITEM, icon: "other", text: t("report.other") }];

  return (
    <form className="screen observe" onSubmit={submit} noValidate>
      <h1 tabIndex={-1}>{t("report.title")}</h1>
      <p className="lead">{t("report.intro")}</p>

      {/* The button itself reads "Which monument?: Delos", so this visible label is for the eye. */}
      <p className="field-label" aria-hidden="true">
        {t("report.monument")}
      </p>
      <Dropdown
        id="report-monument"
        className="menu-field"
        label={t("report.monument")}
        options={monuments.map((m) => ({ id: m.pilot_key, name: pick(m.display_name) }))}
        value={mon.pilot_key}
        onChange={(pilot) => setReport({ pilot, at: null })}
      />

      <fieldset className="choices choices-ladder" aria-describedby={has("what") ? "report-what-error" : undefined}>
        <legend>
          <h2>{t("report.what")}</h2>
        </legend>
        {options.map((o, i) => (
          <label key={o.id} className="choice">
            <input
              type="radio"
              id={`report-item-${i}`}
              name="report-item"
              checked={item === o.id}
              onChange={() => {
                setItem(o.id);
                setProblems((p) => p.filter((x) => x !== "what"));
              }}
            />
            <span className="choice-body">
              <span className="choice-title report-option" data-needs-review={o.id !== OTHER_ITEM && data.checklist.needs_review}>
                <Icon name={o.icon} size={20} />
                {o.text}
              </span>
            </span>
          </label>
        ))}
        {has("what") && (
          <p id="report-what-error" className="field-error">
            {t("report.needWhat")}
          </p>
        )}
      </fieldset>

      <label className="field-label" htmlFor="report-note">
        {t("report.note")}
      </label>
      <textarea
        id="report-note"
        className="input"
        rows={3}
        maxLength={NOTE_MAX}
        value={note}
        aria-describedby="report-note-help"
        onChange={(e) => setNote(e.target.value)}
      />
      <p id="report-note-help" className="hint">
        {t("report.noteHelp")}
      </p>

      <section aria-labelledby="report-where-title">
        <h2 id="report-where-title">{t("report.where")}</h2>
        <p className="hint">{t("report.whereHelp")}</p>
        <ol className="place-rows report-places">
          {(mon.places ?? []).map((place, i) => (
            <li key={place.id}>
              <button
                type="button"
                id={`report-place-${i}`}
                className="place-row"
                aria-describedby={has("where") ? "report-where-error" : undefined}
                onClick={() => choosePlace(place.lat, place.lon)}
              >
                <span className="place-num" aria-hidden="true">
                  {place.n}
                </span>
                <span className="place-row-text">
                  <span data-needs-review={place.needs_review}>{pick(place.name)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className={report.at ? "report-where is-set" : "report-where"}>
          <Icon name="pin" size={20} />
          {report.at ? t("report.whereSet", { where: where(mon, report.at) }) : t("report.whereNone")}
        </p>
        {has("where") && (
          <p id="report-where-error" className="field-error">
            {t("report.needWhere")}
          </p>
        )}
      </section>

      <label className="field-label" htmlFor="report-day">
        {t("report.when")}
      </label>
      <input
        id="report-day"
        className="input input-date"
        type="date"
        max={localDay()}
        value={day}
        aria-invalid={has("when")}
        aria-describedby={has("when") ? "report-when-error" : undefined}
        onChange={(e) => {
          setDay(e.target.value);
          setProblems((p) => p.filter((x) => x !== "when"));
        }}
      />
      {has("when") && (
        <p id="report-when-error" className="field-error">
          {t("report.needWhen")}
        </p>
      )}

      <p className="field-label" aria-hidden="true">
        {t("report.photo")}
      </p>
      {/* The browser's own file control stays (hidden to the eye) and does the work: keyboards
          focus it, and the button below is its label, so pressing either opens the picker. */}
      <input
        id="report-photo"
        ref={fileInput}
        className="file-input"
        type="file"
        accept="image/*"
        aria-label={t("report.photo")}
        aria-describedby="report-photo-help"
        onChange={(e) => {
          const file = e.target.files?.[0];
          setPhoto(file && file.type.startsWith("image/") ? { url: URL.createObjectURL(file), forCard: null } : null);
        }}
      />
      <label htmlFor="report-photo" className="btn btn-secondary file-btn">
        <Icon name="camera" size={20} />
        {t(photo ? "report.photoChange" : "report.photoPick")}
      </label>
      <p id="report-photo-help" className="hint">
        {t("report.photoHelp")}
      </p>
      {photo && (
        <>
          <img className="report-photo" src={photo.url} alt={t("report.photoAlt")} />
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setPhoto(null);
              if (fileInput.current) fileInput.current.value = "";
            }}
          >
            {t("report.photoRemove")}
          </button>
        </>
      )}

      <div className="actions actions-split">
        <button type="submit" className="btn btn-primary btn-big">
          {t("report.make")}
          <Icon name="arrow" />
        </button>
        <button type="button" className="btn btn-secondary btn-big" onClick={onBack}>
          {t("report.back")}
        </button>
      </div>

      {saved.length > 0 && (
        <section className="panel" aria-labelledby="report-mine-title">
          <h2 id="report-mine-title">{t("report.mine")}</h2>
          <p className="small">{t("report.mineHelp")}</p>
          <ul className="report-list">
            {saved.map((r) => {
              const m = monuments.find((x) => x.pilot_key === r.monument);
              const name = `${date(r.day)} · ${m ? pick(m.display_name) : r.monument} · ${itemText(r.item)}`;
              return (
                <li key={r.id}>
                  <span>{name}</span>
                  <span className="report-list-actions">
                    <button type="button" className="btn btn-quiet" aria-label={`${t("report.show")}: ${name}`} onClick={() => show(r)}>
                      {t("report.show")}
                    </button>
                    <button type="button" className="btn btn-quiet" aria-label={`${t("report.delete")}: ${name}`} onClick={() => remove(r)}>
                      {t("report.delete")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </form>
  );
}
