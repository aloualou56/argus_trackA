// Pure game rules. No React, no DOM: everything here is unit-tested in tests/logic.test.ts.
// The scoring and detection rules are game-design assumptions listed in docs/data_notes.md.
import type {
  Alarm,
  Basemap,
  Card,
  ChecklistItem,
  DecisionOption,
  GameData,
  LatLng,
  Level,
  LevelId,
  MapPoint,
  MapView,
  Monument,
  Picks,
  Placement,
  QuizQuestion,
  RuleEntry,
  Scenario,
} from "./types";

// Points per part of the score. The total is scaled to 100 over the parts that apply.
export const THREAT_POINTS = 20; // a mission threat watched by a primary card
export const PARTIAL_THREAT_POINTS = 8; // only supporting cards: they help, but do not watch the threat directly
export const ALARM_POINTS = 25; // the network would have caught the replayed real alarm
export const EFFICIENCY_POINTS = 15; // share of coins spent on cards that help

export function isPlayable(m: GameData["monuments"][number]): m is Monument {
  return m.playable;
}

export function cardById(data: GameData): Map<string, Card> {
  return new Map(data.cards.cards.map((c) => [c.id, c]));
}

/** Cards that stand for people (the observer), not instruments. */
export function humanCards(data: GameData): Set<string> {
  return new Set(data.cards.cards.filter((c) => c.kind === "human").map((c) => c.id));
}

export function level(mon: Monument, levelId: LevelId): Level {
  const found = mon.levels.find((l) => l.id === levelId);
  if (!found || !found.available) throw new Error(`level ${levelId} is not available for ${mon.pilot_key}`);
  return found;
}

/** Coins for a level: the same at every monument, more for more serious dangers (content/coins.json). */
export function budgetFor(mon: Monument, levelId: LevelId): number {
  const budget = level(mon, levelId).budget;
  if (!budget) throw new Error(`no coins for ${mon.pilot_key} ${levelId}`);
  return budget;
}

/** The three dangers of a mission: the given keys (a drawn mission), else the level's own mission. */
export function missionScenarios(mon: Monument, levelId: LevelId, keys?: string[]): Scenario[] {
  const byKey = new Map(mon.scenarios.map((s) => [s.scenario_key, s]));
  return (keys ?? level(mon, levelId).mission ?? []).map((key) => {
    const s = byKey.get(key);
    if (!s) throw new Error(`unknown scenario ${key}`);
    return s;
  });
}

export function featuredAlarm(mon: Monument, levelId: LevelId): Alarm | null {
  const id = level(mon, levelId).featured_alarm;
  return mon.alarms.find((a) => a.id === id) ?? null;
}

export function ruleFor(data: GameData, mon: Monument, alarm: Alarm): RuleEntry | null {
  return data.rule_sensor_map[`${mon.pilot_key}:${alarm.rule}`] ?? null;
}

// ---------------------------------------------------------------- budget

export function spent(picks: Picks, cards: Map<string, Card>): number {
  return Object.entries(picks).reduce((sum, [id, n]) => sum + (cards.get(id)?.cost ?? 0) * n, 0);
}

export function coinsLeft(budget: number, picks: Picks, cards: Map<string, Card>): number {
  return budget - spent(picks, cards);
}

export function canAdd(card: Card, budget: number, picks: Picks, cards: Map<string, Card>): boolean {
  return coinsLeft(budget, picks, cards) >= card.cost;
}

export function withChange(picks: Picks, cardId: string, delta: number): Picks {
  const next = { ...picks, [cardId]: Math.max(0, (picks[cardId] ?? 0) + delta) };
  if (next[cardId] === 0) delete next[cardId];
  return next;
}

export function owned(picks: Picks): Set<string> {
  return new Set(Object.entries(picks).filter(([, n]) => n > 0).map(([id]) => id));
}

export function totalSensors(picks: Picks): number {
  return Object.values(picks).reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------- coverage and detection

/** full: a primary card watches the threat; partial: only supporting cards; none: nothing helps. */
export type CoverLevel = "full" | "partial" | "none";

export interface Coverage {
  scenario: Scenario;
  level: CoverLevel;
  /** Player's cards that help with this threat (primary first). */
  by: string[];
}

export function coverage(scenario: Scenario, picks: Picks): Coverage {
  const mine = owned(picks);
  const primary = scenario.primary_cards.filter((c) => mine.has(c));
  const support = scenario.capable_cards.filter((c) => mine.has(c) && !primary.includes(c));
  const level: CoverLevel = primary.length ? "full" : support.length ? "partial" : "none";
  return { scenario, level, by: [...primary, ...support] };
}

export interface Detection {
  detected: boolean;
  /** Player cards that satisfied the rule (one per group, may repeat). */
  matched: string[];
  /** Groups the player had nothing for. */
  missing: string[][];
}

export function detects(rule: RuleEntry, picks: Picks): Detection {
  const mine = owned(picks);
  const matched: string[] = [];
  const missing: string[][] = [];
  for (const group of rule.detect_with) {
    const hit = group.filter((c) => mine.has(c));
    if (hit.length) matched.push(...hit);
    else missing.push(group);
  }
  return { detected: missing.length === 0 && rule.detect_with.length > 0, matched: [...new Set(matched)], missing };
}

/** ARGUS cards that actually caught the alarm, from the instruments linked to it. */
export function argusCards(alarm: Alarm): string[] {
  return [...new Set(alarm.instruments.map((i) => i.card).filter((c): c is string => !!c))];
}

// ---------------------------------------------------------------- score

export type Verdict = "excellent" | "good" | "learning" | "start";

export interface Part {
  points: number;
  max: number;
}

export interface Score {
  coverage: Coverage[];
  full: number;
  partial: number;
  threats: Part;
  /** null when the level has no replayable alarm: that part then does not count. */
  alarm: (Part & { detected: boolean }) | null;
  efficiency: Part;
  spentCoins: number;
  usefulCoins: number;
  /** Out of 100, scaled over the parts that apply. */
  total: number;
  verdict: Verdict;
}

/** Cards that help: with a mission danger, with today's alarm, or with an alarm of an earlier day on duty. */
export function usefulCards(threats: Scenario[], rule: RuleEntry | null, earlier: RuleEntry[] = []): Set<string> {
  const useful = new Set<string>();
  threats.forEach((s) => s.capable_cards.forEach((c) => useful.add(c)));
  for (const r of [rule, ...earlier]) r?.detect_with.forEach((g) => g.forEach((c) => useful.add(c)));
  return useful;
}

/**
 * `rule` is the alarm being replayed (today's, in a week on duty). `earlier` are the rules of the
 * alarms of the days before: a sensor kept for those is not wasted coins.
 */
export function score(
  threats: Scenario[],
  rule: RuleEntry | null,
  picks: Picks,
  cards: Map<string, Card>,
  earlier: RuleEntry[] = [],
): Score {
  const cov = threats.map((s) => coverage(s, picks));
  const full = cov.filter((c) => c.level === "full").length;
  const partial = cov.filter((c) => c.level === "partial").length;
  // A threat no card can warn about (needs people or lab tests) is taught, not scored.
  const scorable = threats.filter((s) => s.capable_cards.length > 0).length;
  const threatPart: Part = { points: full * THREAT_POINTS + partial * PARTIAL_THREAT_POINTS, max: scorable * THREAT_POINTS };
  const detected = rule ? detects(rule, picks).detected : false;
  const alarm = rule ? { points: detected ? ALARM_POINTS : 0, max: ALARM_POINTS, detected } : null;

  const useful = usefulCards(threats, rule, earlier);
  const spentCoins = spent(picks, cards);
  const usefulCoins = Object.entries(picks)
    .filter(([id]) => useful.has(id))
    .reduce((sum, [id, n]) => sum + (cards.get(id)?.cost ?? 0) * n, 0);
  const efficiency: Part = {
    points: spentCoins ? Math.round((EFFICIENCY_POINTS * usefulCoins) / spentCoins) : 0,
    max: EFFICIENCY_POINTS,
  };

  const parts = [threatPart, efficiency, ...(alarm ? [alarm] : [])];
  const earned = parts.reduce((sum, p) => sum + p.points, 0);
  const max = parts.reduce((sum, p) => sum + p.max, 0);
  const total = max ? Math.round((100 * earned) / max) : 0;
  const verdict: Verdict = total >= 85 ? "excellent" : total >= 60 ? "good" : total >= 30 ? "learning" : "start";
  return { coverage: cov, full, partial, threats: threatPart, alarm, efficiency, spentCoins, usefulCoins, total, verdict };
}

// ---------------------------------------------------------------- reveal

export interface MixRow {
  card: string;
  player: number;
  argus: number;
}

/** Player's network next to the real ARGUS network, one row per card used by either.
 *  Human cards are left out: ARGUS lists instruments only, so "ARGUS: 0 observers" would mislead. */
export function compareMix(mon: Monument, picks: Picks, human: Set<string> = new Set()): MixRow[] {
  const argus = new Map(mon.installed.by_card.map((r) => [r.card, r.count]));
  const ids = new Set([...argus.keys(), ...owned(picks)].filter((c) => !human.has(c)));
  return [...ids]
    .map((card) => ({ card, player: picks[card] ?? 0, argus: argus.get(card) ?? 0 }))
    .sort((a, b) => b.argus - a.argus || b.player - a.player || a.card.localeCompare(b.card));
}

export type PromptKind = "many" | "onlyYou" | "onlyArgus" | "distance";

export interface AutoPrompt {
  kind: PromptKind;
  card: string;
  /** A count, or metres for "distance". */
  n: number;
}

/** Up to one discussion prompt of each kind, built from the differences. Never a penalty. */
export function autoPrompts(rows: MixRow[], distances: Map<string, number> = new Map()): AutoPrompt[] {
  const out: AutoPrompt[] = [];
  const near = rows.find((r) => distances.has(r.card));
  if (near) out.push({ kind: "distance", card: near.card, n: Math.round(distances.get(near.card)!) });
  const many = rows.find((r) => r.argus >= 2 && r.player < r.argus);
  if (many) out.push({ kind: "many", card: many.card, n: many.argus });
  const onlyYou = rows.find((r) => r.player > 0 && r.argus === 0);
  if (onlyYou) out.push({ kind: "onlyYou", card: onlyYou.card, n: onlyYou.player });
  const onlyArgus = rows.find((r) => r.argus > 0 && r.player === 0 && r.card !== many?.card);
  if (onlyArgus) out.push({ kind: "onlyArgus", card: onlyArgus.card, n: onlyArgus.argus });
  return out;
}

// ---------------------------------------------------------------- a week on duty

/** At most this many days; fewer where the monument has fewer real alarms to replay. */
export const WEEK_DAYS = 7;

/** How one day on duty went, kept once the player has moved on to the next day. */
export interface DayResult {
  /** Alarm id. */
  alarm: string;
  detected: boolean;
  /** That day's score out of 100. */
  total: number;
}

/**
 * The real alarms of a week on duty at this level, one per day. Day 1 is the level's own alarm
 * (the one every player and class sees). The days after take the monument's other replayable
 * alarms, turning to a different kind of alarm each day while there is one, oldest first within a
 * kind: "can your network handle tomorrow?" is only a question if tomorrow is different.
 * The same for everyone, so a class compares the same week. Empty where no alarm can be replayed.
 */
export function weekAlarms(mon: Monument, levelId: LevelId, days = WEEK_DAYS): Alarm[] {
  const first = featuredAlarm(mon, levelId);
  if (!first) return [];
  const byRule = new Map<string, Alarm[]>();
  const rest = mon.alarms
    .filter((a) => a.id !== first.id)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
  for (const alarm of rest) byRule.set(alarm.rule, [...(byRule.get(alarm.rule) ?? []), alarm]);
  // Kinds of alarm the player has not met yet come first; day 1's own kind comes last in each round.
  const queues = [...byRule.keys()].sort((a, b) => Number(a === first.rule) - Number(b === first.rule)).map((rule) => byRule.get(rule)!);
  const week = [first];
  while (week.length < days && queues.some((q) => q.length)) {
    for (const queue of queues) if (queue.length && week.length < days) week.push(queue.shift()!);
  }
  return week;
}

/** The rules of the alarms of the days before `day` (0 = the first day). */
export function earlierRules(data: GameData, mon: Monument, week: Alarm[], day: number): RuleEntry[] {
  return week
    .slice(0, day)
    .map((alarm) => ruleFor(data, mon, alarm))
    .filter((rule): rule is RuleEntry => !!rule);
}

// ---------------------------------------------------------------- what would you do next?

/** first: where experts start; fair: defensible; risky: likely to lose time; early: acting before looking. */
export type DecisionVerdict = "first" | "fair" | "risky" | "early";

/** An alarm at least this many times its limit is too strong to sit on. */
export const STRONG_ALARM = 2;

/**
 * How a choice after the alarm compares with what ARGUS records for every alarm ("review alarm
 * evidence and affected asset context before intervention"). Never scored: it feeds the discussion.
 * `alarm` is null where a monument has no alarm to replay.
 */
export function judgeDecision(option: DecisionOption, alarm: Alarm | null): DecisionVerdict {
  if (option.stance === "review") return "first";
  if (option.stance === "act") return "early";
  const cameBack = (alarm?.episode.alarm_count ?? 1) > 1;
  const strong = (alarm?.times_threshold ?? 1) >= STRONG_ALARM;
  return cameBack || strong ? "risky" : "fair";
}

// ---------------------------------------------------------------- citizen checklist

/** Checklist items, the ones about this mission's dangers first; `forMission` marks those. */
export function checklistFor(items: ChecklistItem[], threats: Scenario[]): { item: ChecklistItem; forMission: boolean }[] {
  const categories = new Set(threats.map((s) => s.risk_category));
  const rows = items.map((item) => ({ item, forMission: item.categories.some((c) => categories.has(c)) }));
  return [...rows.filter((r) => r.forMission), ...rows.filter((r) => !r.forMission)];
}

// ---------------------------------------------------------------- quiz

/** Right or wrong per question; an unanswered question counts as wrong. */
export function markQuiz(questions: QuizQuestion[], answers: (number | null)[]): boolean[] {
  return questions.map((q, i) => answers[i] === q.correct);
}

export const countRight = (marks: boolean[]) => marks.filter(Boolean).length;

// ---------------------------------------------------------------- map

const METRES_PER_DEGREE = 111_320;

export function countPicks(placements: Placement[]): Picks {
  const picks: Picks = {};
  for (const p of placements) picks[p.card] = (picks[p.card] ?? 0) + 1;
  return picks;
}

/** Ground distance in metres (equirectangular; exact enough within a few km). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const x = (b[1] - a[1]) * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  const y = b[0] - a[0];
  return Math.hypot(x, y) * METRES_PER_DEGREE;
}

/** Where a new pin goes: at `base`, or spiralled out a little so pins never hide each other. */
export function placeNear(base: LatLng, placements: Placement[], spacing = 3.5): LatLng {
  const pins = placements.filter((p) => p.lat !== null && p.lng !== null).map((p) => [p.lat, p.lng] as LatLng);
  // Walk out along a sunflower spiral until a spot is at least half a spacing from every pin.
  for (let k = 0; k < 500; k++) {
    const r = spacing * Math.sqrt(k);
    const angle = k * 2.39996; // golden angle
    const candidate: LatLng = [
      base[0] + (r * Math.cos(angle)) / METRES_PER_DEGREE,
      base[1] + (r * Math.sin(angle)) / (METRES_PER_DEGREE * Math.cos((base[0] * Math.PI) / 180)),
    ];
    if (pins.every((pin) => distanceMeters(candidate, pin) >= spacing / 2)) return candidate;
  }
  return base;
}

/** Per card: metres from the player's nearest pin to the nearest ARGUS sensor of the same card. */
export function nearestToArgus(mon: Monument, placements: Placement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of placements) {
    if (p.lat === null || p.lng === null) continue;
    for (const point of mon.installed.points) {
      if (!point.instruments.some((i) => i.card === p.card)) continue;
      const d = distanceMeters([p.lat, p.lng], [point.lat, point.lon]);
      if (!out.has(p.card) || d < out.get(p.card)!) out.set(p.card, d);
    }
  }
  return out;
}

/** Display only: ARGUS points closer than `metres` share one marker (data keeps exact positions). */
export function clusterPoints(points: MapPoint[], metres = 2.5): MapPoint[] {
  const clusters: { lat: number; lon: number; members: MapPoint[] }[] = [];
  for (const p of points) {
    const near = clusters.find((c) => distanceMeters([c.lat, c.lon], [p.lat, p.lon]) < metres);
    if (!near) {
      clusters.push({ lat: p.lat, lon: p.lon, members: [p] });
      continue;
    }
    near.members.push(p);
    near.lat = near.members.reduce((s, m) => s + m.lat, 0) / near.members.length;
    near.lon = near.members.reduce((s, m) => s + m.lon, 0) / near.members.length;
  }
  return clusters.map((c) => ({
    lat: c.lat,
    lon: c.lon,
    height: null,
    label: c.members.find((m) => m.label)?.label ?? null,
    instruments: c.members.flatMap((m) => m.instruments),
    flags: [...new Set(c.members.flatMap((m) => m.flags))],
  }));
}

let nextId = 0;
export function newPlacementId(): string {
  nextId += 1;
  return `p${Date.now().toString(36)}${nextId}`;
}

/**
 * The data pack for a game that must not ask anything from outside its own server: only the drawn
 * plan (shipped with the game) stays as a base map. Unchanged when the pack has no drawn plan.
 */
export function withoutOnlineMaps(data: GameData): GameData {
  const drawn = data.basemaps.layers.filter((l) => l.type === "vector");
  if (!drawn.length) return data;
  return { ...data, basemaps: { ...data.basemaps, default: drawn[0].id, layers: drawn } };
}

/**
 * Deepest zoom with real imagery for a raster layer: the open monument's measured value
 * (content/imagery_zoom.json) or, with no monument open, the layer's default. Deeper tiles from
 * the provider are "Map data not yet available" pictures, so the map stretches this level instead.
 */
export function nativeZoom(layer: Basemap, mon: { map: MapView | null } | null): number | undefined {
  return mon?.map?.max_native_zoom?.[layer.id] ?? layer.max_native_zoom;
}

/** What the real ARGUS network would cost at the game's coin prices (instruments with a card only). */
export function argusCost(mon: Monument, cards: Map<string, Card>): number {
  return mon.installed.by_card.reduce((sum, row) => sum + row.count * (cards.get(row.card)?.cost ?? 0), 0);
}

// ---------------------------------------------------------------- drawn missions ("play again with new dangers")

/** Spare coins every mission keeps beyond its cheapest full score (balance rule, tested). */
export const SPARE_COINS = 4;
/** A level needs at least this many usable dangers to draw new missions from. */
export const MIN_POOL = 4;

/** Cheapest set of cards (one of each) that scores 100 for these dangers and alarm; Infinity if none. */
export function cheapestFullScore(threats: Scenario[], rule: RuleEntry | null, cards: Map<string, Card>): number {
  const relevant = [...new Set([...threats.flatMap((s) => s.primary_cards), ...(rule?.detect_with.flat() ?? [])])];
  let best = Infinity;
  for (let mask = 0; mask < 1 << relevant.length; mask++) {
    const picks = Object.fromEntries(relevant.filter((_, i) => mask & (1 << i)).map((c) => [c, 1]));
    const s = score(threats, rule, picks, cards);
    if (s.total === 100) best = Math.min(best, s.spentCoins);
  }
  return best;
}

/** The level's own dangers a drawn mission may use: a card can warn about them, one per name. */
export function missionPool(mon: Monument, levelId: LevelId): Scenario[] {
  const seen = new Set<string>();
  return mon.scenarios.filter((s) => {
    if (s.level !== levelId || s.capable_cards.length === 0) return false;
    const name = s.plain.title.en.trim().toLowerCase();
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export function canDrawMission(mon: Monument, levelId: LevelId): boolean {
  return missionPool(mon, levelId).length >= MIN_POOL;
}

/**
 * Three dangers drawn from the level's pool for "play again": different from the last mission
 * where the pool allows, and only sets whose cheapest full score leaves SPARE_COINS. Null when the
 * level has too few dangers to draw from (the player then replays the level's own mission).
 */
export function drawMission(
  data: GameData,
  mon: Monument,
  levelId: LevelId,
  previous: string[],
  random: () => number = Math.random,
): string[] | null {
  const pool = missionPool(mon, levelId);
  if (pool.length < MIN_POOL) return null;
  const alarm = featuredAlarm(mon, levelId);
  const rule = alarm ? ruleFor(data, mon, alarm) : null;
  const room = budgetFor(mon, levelId) - SPARE_COINS;
  const cards = cardById(data);
  const fresh = pool.filter((s) => !previous.includes(s.scenario_key));
  const same = (keys: string[]) => keys.length === previous.length && keys.every((k) => previous.includes(k));
  for (let attempt = 0; attempt < 60; attempt++) {
    const source = fresh.length >= 3 && attempt < 40 ? fresh : pool;
    const bag = [...source];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const picked = bag.slice(0, 3).sort((a, b) => b.abc.mr - a.abc.mr || a.threat_id - b.threat_id);
    const keys = picked.map((s) => s.scenario_key);
    if (same(keys)) continue;
    if (cheapestFullScore(picked, rule, cards) <= room) return keys;
  }
  return null;
}
