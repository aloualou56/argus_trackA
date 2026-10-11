// Types for public/data/game_data.json, written by tools/build_game_data.py.
// Fields marked "authored" come from content/*.json (game team), the rest from the ARGUS snapshot.

export type Lang = "el" | "en";
export type Text = Record<Lang, string>;
export type LevelId = "low" | "medium" | "high" | "extreme" | "catastrophic";
export type Picks = Record<string, number>;
export type LatLng = [number, number];

/** One sensor the player put in their network. lat/lng are null for cards with on_map=false. */
export interface Placement {
  id: string;
  card: string;
  lat: number | null;
  lng: number | null;
}

export interface Card {
  id: string;
  group: string;
  cost: number;
  name: Text;
  tells: Text;
  instrument_types: string[];
  needs_review: boolean;
  /** false: covers the whole area (satellite), so it gets no pin on the map. */
  on_map: boolean;
  /** "human": people, not an instrument (observer). Never in the ARGUS comparison, never detects an alarm. */
  kind: "instrument" | "human";
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
  /** Every card that helps with this threat. */
  capable_cards: string[];
  /** The subset that watches the threat directly; the others only support. */
  primary_cards: string[];
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
  lat: number | null;
  lon: number | null;
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
  /** AI alarms only: share (0..1) of the model's top feature contributions taken by `variable`. */
  feature_share: number | null;
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

export interface PointInstrument {
  instrument_id: number;
  card: string | null;
  instrument_type: string;
  node: string;
}

/** ARGUS instruments that share one position (installed-devices coordinates). */
export interface MapPoint {
  lat: number;
  lon: number;
  height: number | null;
  label: string | null;
  instruments: PointInstrument[];
  /** "temporary_position" | "position_from_sibling_sensor" */
  flags: string[];
}

export interface Installed {
  asset_state_ids: number[];
  records: number;
  distinct_instruments: number;
  physical_instruments: number;
  by_card: InstalledByCard[];
  other: { instrument_type: string; count: number }[];
  points: MapPoint[];
  unplaced: (PointInstrument & { reason: string })[];
}

export interface MapView {
  center: LatLng;
  bounds: [LatLng, LatLng];
}

export interface Basemap {
  id: string;
  /** "vector" = the drawn plan from data/backdrops; otherwise raster tiles from `url`. */
  type?: "raster" | "vector";
  name: Text;
  url?: string;
  attribution: string;
  attribution_url?: string;
  max_native_zoom: number;
  needs_review: boolean;
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
  /** From the ARGUS sensor positions; null if none have coordinates. */
  map: MapView | null;
  /** OpenStreetMap outlines around the monument for the drawn plan (relative URL), if fetched. */
  backdrop: string | null;
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
  /** Why this monument has no alarm to replay, when it has none. */
  no_alarm_note?: Prompt;
}

export interface GameData {
  schema_version: number;
  snapshot: { fetched_at: string[] };
  level_order: { key: string; id: LevelId }[];
  mission_size: number;
  cards: { currency: string; groups: CardGroup[]; cards: Card[] };
  rule_sensor_map: Record<string, RuleEntry>;
  basemaps: { default: string; layers: Basemap[]; world: string | null };
  monuments: (Monument | MonumentStub)[];
}
