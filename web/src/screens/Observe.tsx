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
  mailtoLink,
  makeReport,
  nearestPlace,
  NOTE_MAX,
  OTHER_ITEM,
  OWN,
  OWN_KINDS,
  OWN_NAME_MAX,
  OWN_WHERE_MAX,
  type OwnKind,
  reportFileName,
  reportProblems,
  telLink,
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
  name: { key: "own.needName", focus: "own-name" },
  what: { key: "report.needWhat", focus: "report-item-0" },
  where: { key: "report.needWhere", focus: "report-place-0" },
  when: { key: "report.needWhen", focus: "report-day" },
};

export function Observe({ data, report, setReport, mapApi, announce, onBack }: Props) {
  const { t, pick, number, date } = useI18n();
  const monuments = useMemo(() => data.monuments.filter(isPlayable), [data]);
  // "Your own monument": a building of the visitor's own neighbourhood, not one of the game's.
  const own = report.pilot === OWN;
  const mon = own ? null : (monuments.find((m) => m.pilot_key === report.pilot) ?? monuments[0]);
  const [ownName, setOwnName] = useState("");
  const [ownKind, setOwnKind] = useState<OwnKind>("other");
  const [ownWhere, setOwnWhere] = useState("");
  const [locating, setLocating] = useState<"idle" | "busy" | "failed">("idle");
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

  const where = (m: Monument | null, at: LatLng) => {
    const place = m && nearestPlace(m, at);
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
    const draft = {
      monument: mon ? mon.pilot_key : OWN,
      item,
      note,
      at: report.at,
      day,
      hasPhoto: !!photo,
      ...(mon ? {} : { own: { name: ownName, kind: ownKind, where: ownWhere } }),
    };
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
    setOwnName("");
    setOwnKind("other");
    setOwnWhere("");
    setLocating("idle");
    setReport({ at: null, editable: true });
  };

  // "Add my location", for a building of the visitor's own: asked of the browser only when pressed.
  const locate = () => {
    if (!navigator.geolocation) {
      setLocating("failed");
      return;
    }
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating("idle");
        setReport({ at: [pos.coords.latitude, pos.coords.longitude] });
        setProblems((p) => p.filter((x) => x !== "where"));
      },
      () => setLocating("failed"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const show = (r: ObservationReport) => {
    setCard(r);
    setStatus("");
    const at: LatLng | null = r.lat !== null && r.lng !== null ? [r.lat, r.lng] : null;
    setReport({ pilot: r.monument, at, editable: false });
    if (at && r.monument !== OWN) mapApi.current?.focus(at);
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
    const cardMon = card.own ? null : (monuments.find((m) => m.pilot_key === card.monument) ?? mon ?? monuments[0]);
    const cardPhoto = photo?.forCard === card.id ? photo.url : null;
    const reportTo = cardMon?.report_to;
    const monName = card.own ? card.own.name : pick(cardMon!.display_name);
    const cardAt: LatLng | null = card.lat !== null && card.lng !== null ? [card.lat, card.lng] : null;
    const cardWhere = [card.own?.where, cardAt && where(cardMon, cardAt)].filter(Boolean).join(" · ");
    // The email the visitor's own app opens with: the card in words, and the exact spot.
    const mailLines = [
      card.own ? t("own.mailHello", { name: monName }) : t("report.mailHello", { name: monName }),
      "",
      `${t("report.cardWhat")}: ${itemText(card.item)}`,
      ...(card.note ? [`${t("report.cardNote")}: ${card.note}`] : []),
      `${t("report.cardWhere")}: ${cardWhere}`,
      `${t("report.cardWhen")}: ${date(card.day)}`,
      t("report.cardId", { id: card.id }),
      "",
      t("report.mailOutro"),
    ];
    const mailSubject = t("report.mailSubject", { name: monName, id: card.id });
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
                {card.own ? `${card.own.name} (${t(`own.kind.${card.own.kind}` as MessageKey)})` : `${pick(cardMon!.display_name)}, ${pick(cardMon!.place)}`}
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
              <dd>{cardWhere}</dd>
            </div>
            <div>
              <dt>{t("report.cardWhen")}</dt>
              <dd>{date(card.day)}</dd>
            </div>
            {/* On the printed card too: who to give it to when no guard is there. */}
            {reportTo && (
              <div>
                <dt>{t("report.cardTo")}</dt>
                <dd>
                  {reportTo.contacts.map((c) => (
                    <span key={c.email} className="report-card-to">
                      {pick(c.name)} · {c.email}
                      {c.phone && ` · ${c.phone}`}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
          {cardPhoto && <img className="report-photo" src={cardPhoto} alt={t("report.photoAlt")} />}
          <p className="report-card-staff">{t(card.own ? "own.cardStaff" : "report.cardStaff")}</p>
        </section>

        {reportTo && (
          <section className="report-to" aria-labelledby="report-to-title">
            <h2 id="report-to-title">{t("report.toTitle")}</h2>
            <p>{t("report.toFirst")}</p>
            <ul className="report-to-list">
              {reportTo.contacts.map((c) => (
                <li key={c.email} className="report-contact">
                  <h3 data-needs-review={reportTo.needs_review}>{pick(c.name)}</h3>
                  <p data-needs-review={reportTo.needs_review}>{pick(c.role)}</p>
                  <div className="actions report-contact-actions">
                    <a className="btn btn-primary" href={mailtoLink(c.email, mailSubject, mailLines)}>
                      {t("report.toEmail")}
                    </a>
                    {c.phone && (
                      <a className="btn btn-secondary" href={telLink(c.phone)}>
                        {t("report.toCall", { phone: c.phone })}
                      </a>
                    )}
                    <a className="btn btn-quiet" href={c.url} target="_blank" rel="noopener noreferrer">
                      {t("report.toSite")}
                    </a>
                  </div>
                  <p className="small report-contact-email">{c.email}</p>
                </li>
              ))}
            </ul>
            <p className="small">{t("report.toEmailHelp")}</p>
            <p className="note">
              <strong>{t("report.toSafety")}</strong>
            </p>
            <p className="small">{t("report.toChecked", { date: date(reportTo.checked) })}</p>
          </section>
        )}

        {/* A building of the visitor's own: no contacts of ours for it, so who to give the card to. */}
        {card.own && (
          <section className="report-to" aria-labelledby="own-to-title">
            <h2 id="own-to-title">{t("own.toTitle")}</h2>
            <ol className="own-to">
              <li>{t("own.to1")}</li>
              <li>{t("own.to2")}</li>
              <li>{t("own.to3")}</li>
            </ol>
            <div className="actions">
              <a className="btn btn-primary" href={mailtoLink("", mailSubject, mailLines)}>
                {t("own.email")}
              </a>
            </div>
            <p className="small">{t("report.toEmailHelp")}</p>
            <p className="note">
              <strong>{t("report.toSafety")}</strong>
            </p>
          </section>
        )}

        <p className="citizen-report" data-needs-review={data.checklist.needs_review}>
          <strong>{pick(data.checklist.report)}</strong>
        </p>
        <div className="actions actions-split">
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            {t("report.print")}
          </button>
          {/* The data file is in ARGUS's format for ARGUS's monuments only. */}
          {cardMon && (
            <button type="button" className="btn btn-secondary" onClick={() => saveFile(card, cardMon)}>
              {t("report.save")}
            </button>
          )}
        </div>
        {cardMon && <p className="small">{t("report.saveHelp")}</p>}
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
      <h1 tabIndex={-1}>{own ? t("own.title") : t("report.title")}</h1>
      <p className="lead">{own ? t("own.intro") : t("report.intro")}</p>

      {/* The button itself reads "Which monument?: Delos", so this visible label is for the eye. */}
      <p className="field-label" aria-hidden="true">
        {t("report.monument")}
      </p>
      <Dropdown
        id="report-monument"
        className="menu-field"
        label={t("report.monument")}
        options={[...monuments.map((m) => ({ id: m.pilot_key, name: pick(m.display_name) })), { id: OWN, name: t("own.option") }]}
        value={mon ? mon.pilot_key : OWN}
        onChange={(pilot) => setReport({ pilot, at: null })}
      />

      {own && (
        <>
          <label className="field-label" htmlFor="own-name">
            {t("own.name")}
          </label>
          <input
            id="own-name"
            className="input"
            type="text"
            maxLength={OWN_NAME_MAX}
            value={ownName}
            aria-invalid={has("name")}
            aria-describedby={has("name") ? "own-name-error own-name-help" : "own-name-help"}
            onChange={(e) => {
              setOwnName(e.target.value);
              setProblems((p) => p.filter((x) => x !== "name"));
            }}
          />
          <p id="own-name-help" className="hint">
            {t("own.nameHelp")}
          </p>
          {has("name") && (
            <p id="own-name-error" className="field-error">
              {t("own.needName")}
            </p>
          )}
          <fieldset className="choices own-kinds">
            <legend>
              <h2>{t("own.kind")}</h2>
            </legend>
            {OWN_KINDS.map((k) => (
              <label key={k} className="chip-choice">
                <input type="radio" name="own-kind" checked={ownKind === k} onChange={() => setOwnKind(k)} />
                <span>{t(`own.kind.${k}` as MessageKey)}</span>
              </label>
            ))}
          </fieldset>
        </>
      )}

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

      {own ? (
        <section aria-labelledby="own-where-title">
          <h2 id="own-where-title">{t("own.where")}</h2>
          <label className="sr-only" htmlFor="report-place-0">
            {t("own.where")}
          </label>
          <input
            id="report-place-0"
            className="input"
            type="text"
            maxLength={OWN_WHERE_MAX}
            value={ownWhere}
            aria-describedby={has("where") ? "report-where-error own-where-help" : "own-where-help"}
            onChange={(e) => {
              setOwnWhere(e.target.value);
              setProblems((p) => p.filter((x) => x !== "where"));
            }}
          />
          <p id="own-where-help" className="hint">
            {t("own.whereHelp")}
          </p>
          <button type="button" className="btn btn-secondary" aria-disabled={locating === "busy" || undefined} onClick={locate}>
            {t("own.locate")}
          </button>
          <p className="small" role="status">
            {locating === "failed" ? t("own.locateFailed") : report.at ? t("own.located", { where: where(null, report.at) }) : ""}
          </p>
          {has("where") && !ownWhere.trim() && (
            <p id="report-where-error" className="field-error">
              {t("own.needWhere")}
            </p>
          )}
        </section>
      ) : (
      <section aria-labelledby="report-where-title">
        <h2 id="report-where-title">{t("report.where")}</h2>
        <p className="hint">{t("report.whereHelp")}</p>
        <ol className="place-rows report-places">
          {(mon?.places ?? []).map((place, i) => (
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
      )}

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
              const name = `${date(r.day)} · ${r.own ? r.own.name : m ? pick(m.display_name) : r.monument} · ${itemText(r.item)}`;
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
