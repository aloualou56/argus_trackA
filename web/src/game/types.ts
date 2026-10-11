// Types for public/data/game_data.json, written by tools/build_game_data.py.
// Fields marked "authored" come from content/*.json (game team), the rest from the ARGUS snapshot.

export type Lang = "el" | "en";
export type Text = Record<Lang, string>;
export type LevelId = "low" | "medium" | "high" | "extreme" | "catastrophic";
export type Picks = Record<string, number>;

export interface Card {
  id: string;
  group: string;
  cost: number;
  name: Text;
  tells: Text;
  instrument_types: string[];
  needs_review: boolean;
}

export interface CardGroup {
  id: string;
  name: Text;
}

export interface RuleEntry {
  /** Detected if, for every group, the network has at least one card from it. */
  detect_with: string[][];
  measures: Text;
  unit: string | null;
  unit_confirmed: boolean;
  needs_review: boolean;
}

export interface Scenario {
  threat_id: number;
  scenario_key: string;
  risk_category: string;
  description: string;
  heritage_asset: string;
  abc: { a: number; b: number; c: number; mr: number };
  priority_label: string;
  level: LevelId;
  source: { document?: string; section?: string };
  plain: { title: Text; text: Text; authored: true; needs_review: boolean };
  capable_cards: string[];
  capable_cards_source: "scenario" | "category" | "missing";
  capable_cards_needs_review: boolean;
}

export interface LevelSummary {
  key: string;
  id: LevelId;
  scenario_count: number;
  available: boolean;
}

export interface Level extends LevelSummary {
  mission?: string[];
  mission_source?: "curated" | "auto";
  featured_alarm?: string | null;
}

export interface AlarmInstrument {
  instrument_id: number;
  name: string;
  instrument_type: string;
  card: string | null;
}

export interface Alarm {
  id: string;
  event_ids: number[];
  timestamp: string;
  type: "EK" | "DL";
  rule: string;
  policy_id: number | null;
  policy_name: string | null;
  threat_name: string | null;
  score: number | null;
  variable: string;
  value: number;
  threshold: number;
  direction: "above" | "below";
  times_threshold: number | null;
  instruments: AlarmInstrument[];
  quality_flags: string[];
  roles: string[];
  episode: { rule: string; start: string; end: string; alarm_count: number; flat_signal: boolean };
  context: { links: string[]; why: Text; authored: true; needs_review: boolean } | null;
}

export interface InstalledByCard {
  card: string;
  count: number;
  instrument_types: Record<string, number>;
  nodes: string[];
}

export interface Installed {
  asset_state_ids: number[];
  records: number;
  distinct_instruments: number;
  physical_instruments: number;
  by_card: InstalledByCard[];
  other: { instrument_type: string; count: number }[];
}

export interface Prompt extends Text {
  authored: true;
  needs_review?: boolean;
}

interface MonumentBase {
  pilot_key: string;
  asset_id: number;
  name: string;
  country: string;
  asset_type: string;
  source_url: string;
  /** Present when content/monuments/<pilot>.json exists (also for draft packs). */
  display_name?: Text;
  place?: Text;
  scenario_count: number;
  installed_summary: { records: number; distinct_instruments: number; physical_instruments: number };
}

export interface MonumentStub extends MonumentBase {
  playable: false;
  levels: LevelSummary[];
}

export interface Monument extends MonumentBase {
  playable: true;
  display_name: Text;
  place: Text;
  story: { hook_scenario: string; text: Text; authored: true; needs_review: boolean };
  budget: number;
  levels: Level[];
  scenarios: Scenario[];
  installed: Installed;
  alarms: Alarm[];
  discussion_prompts: Prompt[];
}

export interface GameData {
  schema_version: number;
  snapshot: { fetched_at: string[] };
  level_order: { key: string; id: LevelId }[];
  mission_size: number;
  cards: { currency: string; groups: CardGroup[]; cards: Card[] };
  rule_sensor_map: Record<string, RuleEntry>;
  monuments: (Monument | MonumentStub)[];
}
