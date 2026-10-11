// Pure game rules. No React, no DOM: everything here is unit-tested in tests/logic.test.ts.
// The scoring and detection rules are game-design assumptions listed in docs/data_notes.md.
import type { Alarm, Card, GameData, Level, LevelId, Monument, Picks, RuleEntry, Scenario } from "./types";

export const COVERAGE_POINTS_PER_THREAT = 25;
export const EFFICIENCY_POINTS = 25;

export function isPlayable(m: GameData["monuments"][number]): m is Monument {
  return m.playable;
}

export function cardById(data: GameData): Map<string, Card> {
  return new Map(data.cards.cards.map((c) => [c.id, c]));
}

export function level(mon: Monument, levelId: LevelId): Level {
  const found = mon.levels.find((l) => l.id === levelId);
  if (!found || !found.available) throw new Error(`level ${levelId} is not available for ${mon.pilot_key}`);
  return found;
}

export function missionScenarios(mon: Monument, levelId: LevelId): Scenario[] {
  const byKey = new Map(mon.scenarios.map((s) => [s.scenario_key, s]));
  return (level(mon, levelId).mission ?? []).map((key) => {
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

export interface Coverage {
  scenario: Scenario;
  covered: boolean;
  /** Player's cards that can warn about this threat. */
  by: string[];
}

export function coverage(scenario: Scenario, picks: Picks): Coverage {
  const mine = owned(picks);
  const by = scenario.capable_cards.filter((c) => mine.has(c));
  return { scenario, covered: by.length > 0, by };
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

export interface Score {
  coverage: Coverage[];
  covered: number;
  coveragePoints: number;
  spentCoins: number;
  usefulCoins: number;
  efficiencyPoints: number;
  total: number;
  verdict: Verdict;
}

export function usefulCards(threats: Scenario[], rule: RuleEntry | null): Set<string> {
  const useful = new Set<string>();
  threats.forEach((s) => s.capable_cards.forEach((c) => useful.add(c)));
  rule?.detect_with.forEach((g) => g.forEach((c) => useful.add(c)));
  return useful;
}

export function score(threats: Scenario[], rule: RuleEntry | null, picks: Picks, cards: Map<string, Card>): Score {
  const cov = threats.map((s) => coverage(s, picks));
  const covered = cov.filter((c) => c.covered).length;
  const coveragePoints = covered * COVERAGE_POINTS_PER_THREAT;
  const useful = usefulCards(threats, rule);
  const spentCoins = spent(picks, cards);
  const usefulCoins = Object.entries(picks)
    .filter(([id]) => useful.has(id))
    .reduce((sum, [id, n]) => sum + (cards.get(id)?.cost ?? 0) * n, 0);
  const efficiencyPoints = spentCoins ? Math.round((EFFICIENCY_POINTS * usefulCoins) / spentCoins) : 0;
  const total = coveragePoints + efficiencyPoints;
  const verdict: Verdict = total >= 85 ? "excellent" : total >= 60 ? "good" : total >= 30 ? "learning" : "start";
  return { coverage: cov, covered, coveragePoints, spentCoins, usefulCoins, efficiencyPoints, total, verdict };
}

// ---------------------------------------------------------------- reveal

export interface MixRow {
  card: string;
  player: number;
  argus: number;
}

/** Player's network next to the real ARGUS network, one row per card used by either. */
export function compareMix(mon: Monument, picks: Picks): MixRow[] {
  const argus = new Map(mon.installed.by_card.map((r) => [r.card, r.count]));
  const ids = new Set([...argus.keys(), ...owned(picks)]);
  return [...ids]
    .map((card) => ({ card, player: picks[card] ?? 0, argus: argus.get(card) ?? 0 }))
    .sort((a, b) => b.argus - a.argus || b.player - a.player || a.card.localeCompare(b.card));
}

export type PromptKind = "many" | "onlyYou" | "onlyArgus";

export interface AutoPrompt {
  kind: PromptKind;
  card: string;
  n: number;
}

/** Up to one discussion prompt of each kind, built from the differences. Never a penalty. */
export function autoPrompts(rows: MixRow[]): AutoPrompt[] {
  const out: AutoPrompt[] = [];
  const many = rows.find((r) => r.argus >= 2 && r.player < r.argus);
  if (many) out.push({ kind: "many", card: many.card, n: many.argus });
  const onlyYou = rows.find((r) => r.player > 0 && r.argus === 0);
  if (onlyYou) out.push({ kind: "onlyYou", card: onlyYou.card, n: onlyYou.player });
  const onlyArgus = rows.find((r) => r.argus > 0 && r.player === 0 && r.card !== many?.card);
  if (onlyArgus) out.push({ kind: "onlyArgus", card: onlyArgus.card, n: onlyArgus.argus });
  return out;
}
