/// <reference types="node" />
// The citizen observation report: its rules, its on-device store, and its export, which is checked
// against the real ARGUS cultural-documentation record in the snapshot.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ReportStore } from "../src/community/reports";
import { isPlayable } from "../src/game/logic";
import {
  ARGUS_SCHEMA,
  cleanNote,
  isRealDay,
  isReport,
  localDay,
  makeReport,
  nearestPlace,
  newReportId,
  NOTE_MAX,
  OTHER_ITEM,
  reportFileName,
  reportProblems,
  siteKey,
  toArgusDocumentation,
  type ReportDraft,
} from "../src/game/report";
import type { GameData, Monument } from "../src/game/types";

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const data = read("../public/data/game_data.json") as GameData;
const monument = (pilot: string) => data.monuments.filter(isPlayable).find((m) => m.pilot_key === pilot) as Monument;
const delos = monument("delos");
const ranverso = monument("ranverso");
const masks = delos.places.find((p) => p.id === "masks")!;
const items = data.checklist.items;

const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
  monument: "delos",
  item: "damp",
  note: "  White powder low on the wall,\n left of the door.  ",
  at: [masks.lat, masks.lon],
  day: "2026-10-12",
  hasPhoto: true,
  ...over,
});

describe("observation report", () => {
  it("says what is still missing, in the order of the form", () => {
    expect(reportProblems(draft(), "2026-10-12")).toEqual([]);
    expect(reportProblems(draft({ item: null, at: null, day: "" }), "2026-10-12")).toEqual(["what", "where", "when"]);
    expect(reportProblems(draft({ day: "2026-10-13" }), "2026-10-12")).toEqual(["when"]); // tomorrow
    expect(reportProblems(draft({ day: "2026-02-30" }), "2026-10-12")).toEqual(["when"]); // not a date
    expect(reportProblems(draft({ note: "" }), "2026-10-12")).toEqual([]); // the note is optional
  });

  it("knows real days, and today in the visitor's own time zone", () => {
    expect(isRealDay("2026-10-12")).toBe(true);
    expect(isRealDay("2026-13-01")).toBe(false);
    expect(isRealDay("12/10/2026")).toBe(false);
    expect(localDay(new Date(2026, 9, 12, 23, 30))).toBe("2026-10-12");
    expect(localDay(new Date(2026, 0, 5, 0, 10))).toBe("2026-01-05");
  });

  it("makes a tidy report: one-line note, a spot to about a metre, the named place nearby", () => {
    const report = makeReport(draft(), delos, "OBS-ABC234", "2026-10-12");
    expect(report).toEqual({
      v: 1,
      id: "OBS-ABC234",
      monument: "delos",
      item: "damp",
      note: "White powder low on the wall, left of the door.",
      lat: Number(masks.lat.toFixed(5)),
      lng: Number(masks.lon.toFixed(5)),
      place: "masks",
      day: "2026-10-12",
      hasPhoto: true,
    });
    expect(isReport(report)).toBe(true);
    expect(cleanNote("x".repeat(NOTE_MAX + 50))).toHaveLength(NOTE_MAX);
    expect(() => makeReport(draft({ at: null }), delos)).toThrow(/where/);
  });

  it("gives every card its own short code without look-alike letters", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newReportId()));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^OBS-[A-HJ-NP-Z2-9]{6}$/);
    expect(newReportId(() => new Uint8Array([0, 31, 32, 255, 8, 23]))).toBe("OBS-A9A9JZ");
  });

  it("names a place only when the spot is near one", () => {
    expect(nearestPlace(delos, [masks.lat, masks.lon])?.id).toBe("masks");
    expect(nearestPlace(delos, [masks.lat + 0.05, masks.lon])).toBeNull(); // more than 5 km away
    const far = makeReport(draft({ at: [masks.lat + 0.05, masks.lon] }), delos, "OBS-ABC234", "2026-10-12");
    expect(far.place).toBeNull();
  });

  it("refuses a saved copy that is not a report", () => {
    const good = makeReport(draft(), delos, "OBS-ABC234", "2026-10-12");
    expect(isReport({ ...good, id: "<script>" })).toBe(false);
    expect(isReport({ ...good, lat: "37.4" })).toBe(false);
    expect(isReport({ ...good, day: "yesterday" })).toBe(false);
    expect(isReport(null)).toBe(false);
    expect(isReport("OBS-ABC234")).toBe(false);
  });
});

describe("ARGUS format", () => {
  const report = makeReport(draft(), delos, "OBS-ABC234", "2026-10-12");
  const doc = toArgusDocumentation(report, delos, items);

  it("uses ARGUS's own site keys", () => {
    expect(siteKey(delos, "masks")).toBe("delos-masks");
    expect(siteKey(delos, "fournoi")).toBe("delos-fournoi");
    expect(siteKey(delos, "theatre")).toBe("delos"); // ARGUS has no site key for the theatre
    expect(siteKey(delos, null)).toBe("delos");
    expect(siteKey(ranverso, "church")).toBe("ranverso"); // one site key for the whole monument
    expect(siteKey(monument("lucretili"), "villa")).toBe("lucretili-villa-orazio");
    expect(doc.metadata.site_key).toBe("delos-masks");
  });

  it("is a visual condition assessment that says it is a visitor's observation, not a diagnosis", () => {
    expect(doc.metadata.schema).toBe(ARGUS_SCHEMA);
    expect(doc.metadata.cidoc_crm.primary_class).toBe("E14 Condition Assessment");
    expect(doc.metadata.documentation_type).toBe("condition_assessment");
    expect(doc.description).toMatch(/does not constitute an approved conservation diagnosis/);
    expect(doc.metadata.activity.responsible_actor).toMatch(/anonymous/);
    expect(doc.metadata.activity.time_span).toEqual({ begin: "2026-10-12", end: "2026-10-12" });
    expect(doc.metadata.condition.severity).toBeNull(); // a visitor does not rate severity
    expect(doc.metadata.condition.summary).toBe(
      "Damp patches, or white powder on walls (salt coming out). Visitor's note: White powder low on the wall, left of the door.",
    );
    expect(doc.metadata.source_references).toEqual(["Prototype 3 citizen observation OBS-ABC234, 12/10/2026"]);
    expect(doc.metadata.citizen_observation.position).toEqual({ reference: "wgs84", latitude: report.lat, longitude: report.lng });
    expect(doc.metadata.citizen_observation.near_place).toBe(masks.name.en);
    expect(doc.metadata.citizen_observation.reviewed_by_staff).toBe(false);
  });

  it("carries no photo, no name and no device details", () => {
    const text = JSON.stringify(doc);
    expect(text).not.toMatch(/data:image|blob:|base64|userAgent|device_id|file_name/i);
    expect(doc.metadata.citizen_observation.photo_on_card).toBe(true); // only that there was one
  });

  it("handles 'something else' and an empty note", () => {
    const other = toArgusDocumentation(makeReport(draft({ item: OTHER_ITEM, note: "" }), delos, "OBS-ABC234", "2026-10-12"), delos, items);
    expect(other.metadata.condition.summary).toBe("Something not on the visitor checklist.");
    expect(other.metadata.citizen_observation.visitor_note).toBeNull();
    expect(reportFileName(report)).toBe("observation-delos-2026-10-12-OBS-ABC234.json");
  });

  // The first ARGUS snapshot holds a real cultural-documentation record (a test record for Delos).
  const snapshot = new URL("../../snapshot/cultural-documentations.json", import.meta.url);
  it.skipIf(!existsSync(snapshot))("has every field of the real ARGUS record, with values of the same kind", () => {
    const argus = JSON.parse(readFileSync(snapshot, "utf8")).records[0];
    const real = { ...argus, metadata: JSON.parse(argus.metadata) };
    expect(real.metadata.schema).toBe(doc.metadata.schema);
    expect(real.metadata.schema_version).toBe(doc.metadata.schema_version);
    expect(real.metadata.cidoc_crm.primary_class).toBe(doc.metadata.cidoc_crm.primary_class);
    expect(real.metadata.cidoc_crm.documents).toBe(doc.metadata.cidoc_crm.documents);
    expect(real.metadata.documentation_type).toBe(doc.metadata.documentation_type);
    expect(real.metadata.site_key).toBe("delos-masks"); // the same site key our Delos report gets

    /** Every key path of ARGUS's record must exist in ours; ours may add "citizen_observation". */
    const paths = (node: unknown, prefix = ""): string[] =>
      node && typeof node === "object" && !Array.isArray(node)
        ? Object.entries(node).flatMap(([key, value]) => [`${prefix}${key}`, ...paths(value, `${prefix}${key}.`)])
        : [];
    // ARGUS's own bookkeeping, set by its database when a record is stored.
    const serverSide = new Set(["id", "created_at", "updated_at"]);
    const ours = new Set(paths(doc));
    expect(paths(real).filter((path) => !serverSide.has(path) && !ours.has(path))).toEqual([]);
    expect([...ours].filter((path) => !paths(real).includes(path) && !path.startsWith("metadata.citizen_observation"))).toEqual([]);
  });
});

describe("reports on this device", () => {
  class MemoryStorage {
    data = new Map<string, string>();
    getItem = (k: string) => this.data.get(k) ?? null;
    setItem = (k: string, v: string) => void this.data.set(k, v);
  }
  const report = (id: string) => makeReport(draft(), delos, id, "2026-10-12");

  it("keeps the newest first, replaces a card saved twice, and deletes on request", () => {
    const store = new ReportStore(new MemoryStorage() as unknown as Storage);
    store.add(report("OBS-AAAAAA"));
    store.add(report("OBS-BBBBBB"));
    store.add(report("OBS-AAAAAA"));
    expect(store.list().map((r) => r.id)).toEqual(["OBS-AAAAAA", "OBS-BBBBBB"]);
    store.remove("OBS-AAAAAA");
    expect(store.list().map((r) => r.id)).toEqual(["OBS-BBBBBB"]);
  });

  it("keeps a limited number, drops damaged entries, and works when storage is blocked", () => {
    const storage = new MemoryStorage();
    const store = new ReportStore(storage as unknown as Storage, 2);
    for (const id of ["OBS-AAAAAA", "OBS-BBBBBB", "OBS-CCCCCC"]) store.add(report(id));
    expect(store.list().map((r) => r.id)).toEqual(["OBS-CCCCCC", "OBS-BBBBBB"]);
    storage.setItem("guardian.reports.v1", JSON.stringify([report("OBS-DDDDDD"), { v: 1, id: "nonsense" }, null]));
    expect(store.list().map((r) => r.id)).toEqual(["OBS-DDDDDD"]);

    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const inMemory = new ReportStore(blocked as unknown as Storage);
    inMemory.add(report("OBS-EEEEEE"));
    expect(inMemory.list().map((r) => r.id)).toEqual(["OBS-EEEEEE"]);
  });

  it("stores no photo", () => {
    const storage = new MemoryStorage();
    new ReportStore(storage as unknown as Storage).add(report("OBS-AAAAAA"));
    const saved = storage.getItem("guardian.reports.v1")!;
    expect(Object.keys(JSON.parse(saved)[0]).sort()).toEqual(["day", "hasPhoto", "id", "item", "lat", "lng", "monument", "note", "place", "v"]);
    expect(saved).not.toMatch(/data:|blob:/);
  });
});
