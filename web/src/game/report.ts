// Citizen observation report: what a visitor saw, where and when. Pure rules, no React, no DOM:
// tested in tests/report.test.ts. A report lives on the visitor's device only; nothing here sends it.
//
// The export follows the format ARGUS itself uses for a visual condition assessment
// (cultural-documentations in the snapshot: schema "argus_cultural_documentation_v1", CIDOC CRM
// E14 Condition Assessment). What a visitor cannot know stays empty (asset state, severity), and
// what ARGUS has no field for (the spot, the checklist item) sits apart under "citizen_observation".
import { distanceMeters } from "./logic";
import type { ChecklistItem, LatLng, Monument, Place } from "./types";

/** "Something else": the visitor saw something the checklist does not name. */
export const OTHER_ITEM = "other";
export const NOTE_MAX = 400;
/** A pin this close to a named part of the site is described as "near" it. */
export const NEAR_METRES = 120;

export interface ObservationReport {
  v: 1;
  /** Short code printed on the card, e.g. "OBS-7K3Q9A". Random: it identifies the card, not the person. */
  id: string;
  /** pilot_key of the monument. */
  monument: string;
  /** A checklist item id (content/citizen_checklist.json), or OTHER_ITEM. */
  item: string;
  /** The visitor's own words. May be empty. */
  note: string;
  lat: number;
  lng: number;
  /** Id of the named part of the site the pin is near, if any. */
  place: string | null;
  /** The day it was seen (YYYY-MM-DD). */
  day: string;
  /** Whether a photo is on the card. The photo itself is never stored or exported. */
  hasPhoto: boolean;
}

/** What the form holds before it is a report. */
export interface ReportDraft {
  monument: string;
  item: string | null;
  note: string;
  at: LatLng | null;
  day: string;
  hasPhoto: boolean;
}

export type ReportProblem = "what" | "where" | "when";

const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes (0/O, 1/I), as in class codes

export function newReportId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return `OBS-${Array.from(random(6), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("")}`;
}

/** Today as YYYY-MM-DD in the visitor's own time zone (a report at 23:30 is still "today"). */
export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** What is still missing before the card can be made, in the order of the form. */
export function reportProblems(draft: ReportDraft, today: string = localDay()): ReportProblem[] {
  const problems: ReportProblem[] = [];
  if (!draft.item) problems.push("what");
  if (!draft.at) problems.push("where");
  if (!isRealDay(draft.day) || draft.day > today) problems.push("when");
  return problems;
}

/** The named part of the site nearest to a spot, if one is within `within` metres. */
export function nearestPlace(mon: Monument, at: LatLng, within = NEAR_METRES): Place | null {
  let best: Place | null = null;
  let bestDistance = within;
  for (const place of mon.places ?? []) {
    const d = distanceMeters(at, [place.lat, place.lon]);
    if (d <= bestDistance) {
      best = place;
      bestDistance = d;
    }
  }
  return best;
}

/** Tidy the visitor's words: no line breaks or runs of spaces, at most NOTE_MAX characters. */
export function cleanNote(note: string): string {
  return note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
}

/** A finished report from a complete draft; throws if something is still missing. */
export function makeReport(draft: ReportDraft, mon: Monument, id: string = newReportId(), today: string = localDay()): ObservationReport {
  const problems = reportProblems(draft, today);
  if (problems.length || !draft.item || !draft.at) throw new Error(`report is not complete: ${problems.join(", ")}`);
  return {
    v: 1,
    id,
    monument: mon.pilot_key,
    item: draft.item,
    note: cleanNote(draft.note),
    // About one metre: finer than anyone can point on a phone, and no false precision on the card.
    lat: Number(draft.at[0].toFixed(5)),
    lng: Number(draft.at[1].toFixed(5)),
    place: nearestPlace(mon, draft.at)?.id ?? null,
    day: draft.day,
    hasPhoto: draft.hasPhoto,
  };
}

// ---------------------------------------------------------------- ARGUS format

/**
 * ARGUS names the parts of a monument by "site key", the first part of every scenario key
 * ("delos-masks.salinity.site" -> "delos-masks"). A report near a named place takes the site key that
 * contains that place's id (place "masks" -> "delos-masks"); otherwise the monument's own key.
 */
export function siteKey(mon: Monument, placeId: string | null): string {
  const keys = [...new Set(mon.scenarios.map((s) => s.scenario_key.split(".")[0]))];
  if (keys.length === 1) return keys[0];
  const match = placeId ? keys.find((key) => key.split("-").includes(placeId)) : undefined;
  return match ?? mon.pilot_key;
}

export const ARGUS_SCHEMA = "argus_cultural_documentation_v1";
export const ARGUS_SCHEMA_VERSION = "1.0.0";

/** One cultural-documentation record in ARGUS's own shape; the texts are in English, as ARGUS's are. */
export interface ArgusDocumentation {
  name: string;
  description: string;
  metadata: {
    schema: string;
    schema_version: string;
    cidoc_crm: { primary_class: string; documents: string; documented_asset_state_id: number | null };
    documentation_type: string;
    site_key: string;
    revision: number;
    supersedes_documentation_id: number | null;
    activity: { responsible_actor: string; time_span: { begin: string | null; end: string | null } };
    condition: { summary: string; severity: string | null };
    intervention: { method: string; materials: string | null };
    source_references: string[];
    citizen_observation: {
      report_id: string;
      pilot: string;
      checklist_item: string;
      visitor_note: string | null;
      position: { reference: "wgs84"; latitude: number; longitude: number };
      near_place: string | null;
      photo_on_card: boolean;
      reviewed_by_staff: false;
    };
  };
  uri: null;
  asset_state_id: number | null;
}

/**
 * The report as an ARGUS cultural-documentation record (a visual condition assessment), ready for
 * site staff to load or copy. It says plainly that it is a visitor's observation, not a diagnosis.
 */
export function toArgusDocumentation(report: ObservationReport, mon: Monument, items: ChecklistItem[]): ArgusDocumentation {
  const item = items.find((i) => i.id === report.item);
  const place = (mon.places ?? []).find((p) => p.id === report.place) ?? null;
  const seen = item ? item.text.en : "Something not on the visitor checklist.";
  const [y, m, d] = report.day.split("-");
  return {
    name: "Visitor observation of visible condition",
    description:
      "Visual observation by a visitor, recorded on the visitor's own device with the Prototype 3 game. " +
      "It has not been checked by site staff. This is a citizen observation and does not constitute an approved conservation diagnosis.",
    metadata: {
      schema: ARGUS_SCHEMA,
      schema_version: ARGUS_SCHEMA_VERSION,
      cidoc_crm: { primary_class: "E14 Condition Assessment", documents: "E3 Condition State", documented_asset_state_id: null },
      documentation_type: "condition_assessment",
      site_key: siteKey(mon, report.place),
      revision: 1,
      supersedes_documentation_id: null,
      activity: { responsible_actor: "Visitor (anonymous citizen observer)", time_span: { begin: report.day, end: report.day } },
      // A visitor notices; only a conservator rates how serious it is.
      condition: { summary: report.note ? `${seen} Visitor's note: ${report.note}` : seen, severity: null },
      intervention: { method: "No intervention performed. Visual observation by a visitor only.", materials: null },
      source_references: [`Prototype 3 citizen observation ${report.id}, ${d}/${m}/${y}`],
      citizen_observation: {
        report_id: report.id,
        pilot: mon.pilot_key,
        checklist_item: report.item,
        visitor_note: report.note || null,
        position: { reference: "wgs84", latitude: report.lat, longitude: report.lng },
        near_place: place ? place.name.en : null,
        photo_on_card: report.hasPhoto,
        reviewed_by_staff: false,
      },
    },
    uri: null,
    asset_state_id: null,
  };
}

export function reportFileName(report: ObservationReport): string {
  return `observation-${report.monument}-${report.day}-${report.id}.json`;
}

/** Only what a report may hold, so an edited or damaged saved copy can never break the screen. */
export function isReport(value: unknown): value is ObservationReport {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    r.v === 1 &&
    typeof r.id === "string" &&
    /^OBS-[A-Z2-9]{6}$/.test(r.id) &&
    typeof r.monument === "string" &&
    typeof r.item === "string" &&
    typeof r.note === "string" &&
    typeof r.lat === "number" &&
    typeof r.lng === "number" &&
    (r.place === null || typeof r.place === "string") &&
    typeof r.day === "string" &&
    isRealDay(r.day) &&
    typeof r.hasPhoto === "boolean"
  );
}

// ---------------------------------------------------------------- telling the people responsible

/**
 * A mailto: link that opens the visitor's own email app with the card written in. The game sends
 * nothing itself: the visitor sees the message and decides whether to send it (and adds a photo).
 */
export function mailtoLink(to: string, subject: string, lines: string[]): string {
  // Line breaks as CRLF, the form email programs expect in a mailto body (RFC 6068).
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\r\n"))}`;
}

/** A tel: link for a number written in international format ("+30 210 3310966" -> "tel:+302103310966"). */
export function telLink(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
