// The newest from ARGUS, for the first screen: last night's check of each danger by its risk model,
// and the newest sensor alarm the game can explain. The Raspberry Pi reads them from the ARGUS API
// every 15 minutes and serves them as live/argus-now.json (tools/pi/guardian_live.py); this file
// decides what of that to show. Everything shown is ARGUS's own data with its date: with no file, an
// old one, or nothing the game can explain, nothing is shown.
import type { AlarmFilter, GameData, Monument, RuleEntry, Scenario } from "./types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A check this recent is "live"; older ones show their date only. */
export const FRESH = 36 * HOUR;
/** Older than this, the risk model's checks are not shown at all (it stopped for this monument). */
export const RISK_MAX_AGE = 14 * DAY;
/** Older than this, the last sensor alarm is not news any more. */
export const ALARM_MAX_AGE = 60 * DAY;
/** The file is read again after this long (the Pi writes it every 15 minutes). */
const REREAD = 10 * 60_000;

export type RaisedState = "watch" | "active" | "escalated";
const RAISED: RaisedState[] = ["escalated", "active", "watch"]; // most serious first

export interface LiveCheck {
  key: string;
  state: string;
  probability: number;
  thresholds: { watch: number; active: number; escalated: number } | null;
  previous_state: string | null;
  evaluated_at: string;
}

export interface LiveAlarm {
  /** As ARGUS gives it, UTC without a zone ("2026-10-02T20:30:00"), like the game's alarms. */
  timestamp: string;
  type: string;
  rule: string | null;
  variables: { name: string | null; value: number | null; threshold: number | null }[];
  score: number | null;
  threshold: number | null;
  top_feature: { name: string; share: number } | null;
}

export interface LiveSite {
  risk?: { evaluated_at: string; scenarios: LiveCheck[] };
  /** Newest first. */
  alarms?: LiveAlarm[];
}

export interface LiveFile {
  schema: 1;
  checked_at: string;
  sites: Record<string, LiveSite>;
}

/** What the first screen shows for one monument. */
export interface LiveView {
  /** The risk model's latest run here, or null when there is none in the last two weeks. */
  risk: {
    at: Date;
    fresh: boolean;
    checked: number;
    /** Dangers above "inactive", most serious first (scenario null: not in the game's list). */
    raised: { scenario: Scenario | null; state: RaisedState; probability: number }[];
    /** With nothing raised: the danger nearest its watch level. */
    closest: { scenario: Scenario; probability: number; watch: number } | null;
  } | null;
  /** The newest sensor alarm here that the game can explain, or null. */
  alarm: { timestamp: string; ai: boolean; rule: RuleEntry; value: number; threshold: number } | null;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function parseCheck(raw: unknown): LiveCheck | null {
  const c = raw as Partial<LiveCheck> | null;
  if (!c || !isText(c.key) || !isText(c.state) || !isNumber(c.probability) || !isText(c.evaluated_at)) return null;
  const t = c.thresholds;
  const thresholds = t && isNumber(t.watch) && isNumber(t.active) && isNumber(t.escalated) && t.watch > 0 ? t : null;
  return { key: c.key, state: c.state, probability: c.probability, thresholds, previous_state: c.previous_state ?? null, evaluated_at: c.evaluated_at };
}

function parseAlarm(raw: unknown): LiveAlarm | null {
  const a = raw as Partial<LiveAlarm> | null;
  if (!a || !isText(a.timestamp) || !isText(a.type) || !Array.isArray(a.variables)) return null;
  const num = (v: unknown) => (isNumber(v) ? v : null);
  const top = a.top_feature && isText(a.top_feature.name) && isNumber(a.top_feature.share) ? a.top_feature : null;
  return {
    timestamp: a.timestamp,
    type: a.type,
    rule: isText(a.rule) ? a.rule : null,
    variables: a.variables.map((v) => ({ name: isText(v?.name) ? v.name : null, value: num(v?.value), threshold: num(v?.threshold) })),
    score: num(a.score),
    threshold: num(a.threshold),
    top_feature: top,
  };
}

/** The file as the Pi wrote it, checked; anything it cannot use is left out. null if unusable. */
export function parseLive(raw: unknown): LiveFile | null {
  const file = raw as { schema?: unknown; checked_at?: unknown; sites?: unknown } | null;
  if (!file || file.schema !== 1 || !file.sites || typeof file.sites !== "object") return null;
  const sites: Record<string, LiveSite> = {};
  for (const [pilot, value] of Object.entries(file.sites as Record<string, LiveSite>)) {
    const site: LiveSite = {};
    const risk = value?.risk;
    if (risk && isText(risk.evaluated_at) && Array.isArray(risk.scenarios)) {
      site.risk = { evaluated_at: risk.evaluated_at, scenarios: risk.scenarios.map(parseCheck).filter((c): c is LiveCheck => !!c) };
    }
    if (Array.isArray(value?.alarms)) site.alarms = value.alarms.map(parseAlarm).filter((a): a is LiveAlarm => !!a);
    sites[pilot] = site;
  }
  return { schema: 1, checked_at: isText(file.checked_at) ? file.checked_at : "", sites };
}

let cached: { at: number; file: Promise<LiveFile | null> } | null = null;

/** live/argus-now.json, read at most every 10 minutes; null when it is missing, offline or odd. */
export function loadLive(now = Date.now()): Promise<LiveFile | null> {
  if (cached && now - cached.at < REREAD) return cached.file;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const file = fetch(`${import.meta.env.BASE_URL}live/argus-now.json`, { cache: "no-cache", signal: controller.signal })
    .then((res) => (res.ok ? res.json() : null))
    .then(parseLive)
    .catch(() => null)
    .finally(() => clearTimeout(timer));
  cached = { at: now, file };
  return file;
}

/**
 * Would the game show this alarm, and how: the same rules as the data build's (build_alarms, step 2,
 * published as data.alarm_filter). An AI alarm becomes the pseudo-rule of the signal that drove it.
 */
export function explainAlarm(
  alarm: LiveAlarm,
  pilot: string,
  data: Pick<GameData, "rule_sensor_map" | "alarm_filter">,
): { rule: string; entry: RuleEntry; value: number; threshold: number } | null {
  const filter: AlarmFilter = data.alarm_filter;
  let rule = alarm.rule;
  let variables = alarm.variables;
  if (alarm.type === "DL") {
    const top = alarm.top_feature;
    if (!top || top.share < filter.dl_min_share) return null;
    rule = filter.dl_features.find((p) => new RegExp(p.match).test(top.name))?.rule ?? null;
    if (!rule) return null;
    variables = [{ name: top.name, value: alarm.score, threshold: alarm.threshold }];
  } else if (!rule) {
    return null;
  }
  const entry = data.rule_sensor_map[`${pilot}:${rule}`];
  if (!entry || variables.length !== 1) return null;
  const { value, threshold } = variables[0];
  if (value === null || threshold === null || threshold === 0) return null;
  const card = entry.detect_with[0]?.[0];
  // An AI alarm's value is the model's score, not a physical quantity: only a rule's own range applies.
  const range = alarm.type === "EK" && card ? filter.plausible[card] : undefined;
  if (range && !(range[0] <= value && value <= range[1])) return null;
  if (entry.plausible && !(entry.plausible[0] <= value && value <= entry.plausible[1])) return null;
  if (card && filter.zero_is_suspect.includes(card) && value === 0) return null;
  return { rule, entry, value, threshold };
}

/** What to show for this monument now, or null for nothing. */
export function liveView(file: LiveFile | null, data: GameData, mon: Monument, now: Date): LiveView | null {
  const site = file?.sites[mon.pilot_key];
  if (!site) return null;
  const at = site.risk ? Date.parse(site.risk.evaluated_at) : NaN;
  let risk: LiveView["risk"] = null;
  // (a check "from the future" is a clock problem somewhere: not shown)
  if (site.risk?.scenarios.length && Number.isFinite(at) && now.getTime() - at <= RISK_MAX_AGE && at - now.getTime() < HOUR) {
    const scenarios = new Map(mon.scenarios.map((s) => [s.scenario_key, s]));
    const checks = site.risk.scenarios;
    const raised = checks
      .filter((c): c is LiveCheck & { state: RaisedState } => (RAISED as string[]).includes(c.state))
      .map((c) => ({ scenario: scenarios.get(c.key) ?? null, state: c.state, probability: c.probability }))
      .sort((a, b) => RAISED.indexOf(a.state) - RAISED.indexOf(b.state) || b.probability - a.probability);
    const nearest = raised.length
      ? undefined
      : checks
          .filter((c) => c.thresholds && scenarios.has(c.key))
          .sort((a, b) => b.probability / b.thresholds!.watch - a.probability / a.thresholds!.watch)[0];
    risk = {
      at: new Date(at),
      fresh: now.getTime() - at <= FRESH,
      checked: checks.length,
      raised,
      closest: nearest ? { scenario: scenarios.get(nearest.key)!, probability: nearest.probability, watch: nearest.thresholds!.watch } : null,
    };
  }
  let alarm: LiveView["alarm"] = null;
  for (const a of site.alarms ?? []) {
    const when = Date.parse(`${a.timestamp}Z`);
    if (!Number.isFinite(when) || now.getTime() - when > ALARM_MAX_AGE || when - now.getTime() > HOUR) continue;
    const explained = explainAlarm(a, mon.pilot_key, data);
    if (explained) {
      alarm = { timestamp: a.timestamp, ai: a.type === "DL", rule: explained.entry, value: explained.value, threshold: explained.threshold };
      break;
    }
  }
  return risk || alarm ? { risk, alarm } : null;
}

/** "today, 00:00" / "yesterday, 23:00" / "29 September, 23:02" in the visitor's own time and language
 *  (a 24-hour clock everywhere: ARGUS checks around midnight, where "12:00 a.m." is easy to misread). */
export function formatWhen(at: Date, now: Date, locale: string): string {
  const day = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  const diff = day(at) - day(now);
  const date =
    diff === 0 || diff === -1
      ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(diff, "day")
      : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(at);
  return `${date}, ${time}`;
}
