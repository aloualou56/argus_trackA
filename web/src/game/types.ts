// Types for public/data/game_data.json, written by tools/build_game_data.py.
// Fields marked "authored" come from content/*.json (game team), the rest from the ARGUS snapshot.

/** Languages the game's own text is written in (content/*.json). */
export type BaseLang = "el" | "en";
/** Every language of the interface. The others are translations: UI strings in src/i18n/<lang>.json,
 *  content in data/i18n/<lang>.json, keyed by the English text (content/translations/). */
export type Lang = BaseLang | "it" | "es" | "de";
export type Text = Record<BaseLang, string>;
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
  /** When ARGUS's risk model raised this danger above "inactive" (null if never). */
  risk?: RiskHistory | null;
}

export interface RiskPeriod {
  state: "watch" | "active" | "escalated";
  probability: number;
  from: string;
  until: string | null;
}

export interface RiskHistory {
  raised: RiskPeriod[];
  latest: { state: string; probability: number; at: string };
  thresholds: { watch: number; active: number; escalated: number } | null;
  evaluations: number;
}

export interface LevelSummary {
  key: string;
  id: LevelId;
  scenario_count: number;
  available: boolean;
}

export interface Level extends LevelSummary {
  /** Coins for this level (content/coins.json): more serious dangers come with more coins. */
  budget?: number;
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
  /** What ARGUS recorded as the decision for this alarm (its own English text); null for AI alarms. */
  decision: { decision_id: number; text: string; urgency: string | null } | null;
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

/** Site guide: a numbered part of the site. Position from real data, name and note authored. */
export interface Place {
  id: string;
  n: number;
  name: Text;
  note: Text;
  lat: number;
  lon: number;
  /** [lat, lon] outline from OpenStreetMap, when the place has one. */
  outline: LatLng[] | null;
  sources: string[];
  authored: true;
  needs_review: boolean;
}

export interface SiteTip {
  id: string;
  cards: string[];
  text: Text;
}

export interface MapView {
  center: LatLng;
  bounds: [LatLng, LatLng];
  /** Per raster layer: deepest zoom with real imagery here (tools/probe_imagery.py). */
  max_native_zoom?: Record<string, number>;
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

/** A real photograph of a monument (content/photos/credits.json), always shown with its credit. */
export interface Photo {
  /** Relative URLs of the photo and its small version. */
  src: string;
  thumb: string;
  /** What the photo shows, in plain words (authored). */
  caption: Text;
  author: string;
  license: string;
  license_url: string;
  /** The photo's own page (Wikimedia Commons). */
  source: string;
  changes: string;
  authored: true;
  needs_review: boolean;
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
  photo?: Photo;
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
  levels: Level[];
  scenarios: Scenario[];
  installed: Installed;
  alarms: Alarm[];
  discussion_prompts: Prompt[];
  /** Site guide, numbered on the map and listed in the mission. */
  places: Place[];
  /** Why this monument has no alarm to replay, when it has none. */
  no_alarm_note?: Prompt;
}

/** Pre/post quiz question (content/quiz.json). */
export interface QuizQuestion {
  id: string;
  question: Text;
  options: Text[];
  /** Index into options. */
  correct: number;
  explain: Text;
}

/** One thing visitors can watch for (content/citizen_checklist.json). */
export interface ChecklistItem {
  id: string;
  icon: string;
  /** ARGUS risk categories it relates to. */
  categories: string[];
  text: Text;
}

/** What kind of step a decision option is: look first, wait, or intervene at once. */
export type DecisionStance = "review" | "wait" | "act";

/** One answer to "what would you do next?" after the replayed alarm (content/decisions.json). */
export interface DecisionOption {
  id: string;
  icon: string;
  stance: DecisionStance;
  label: Text;
  feedback: Text;
  /** Shown instead of `feedback` when waiting is judged risky for this alarm. */
  feedback_risky?: Text;
}

export interface GameData {
  schema_version: number;
  /** The decision step after the alarm (authored; the choice is never scored). */
  decisions: {
    intro: Text;
    intro_no_alarm: Text;
    /** Our plain-language reading of the ARGUS decision record. */
    argus_plain: Text;
    options: DecisionOption[];
    authored: true;
    needs_review: boolean;
  };
  /** Where each kind of sensor usually goes (authored, shown with every site guide). */
  site_guide: { where: SiteTip[]; authored: true; needs_review: boolean };
  snapshot: { fetched_at: string[] };
  level_order: { key: string; id: LevelId }[];
  mission_size: number;
  cards: { currency: string; groups: CardGroup[]; cards: Card[] };
  rule_sensor_map: Record<string, RuleEntry>;
  quiz: { questions: QuizQuestion[]; authored: true; needs_review: boolean };
  checklist: { items: ChecklistItem[]; report: Text; authored: true; needs_review: boolean };
  basemaps: { default: string; layers: Basemap[]; world: string | null };
  monuments: (Monument | MonumentStub)[];
}
