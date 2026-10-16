// What the pin on one of ARGUS's sensors in the 3D view says (view3d/house.ts, `sensorPin`): the sensor's
// drawing, its name for screen readers, and the card that opens when it is pressed. The sensor is the
// game's own (its name and what it tells, as on the map's pins), found by ARGUS's name for the instrument's
// type, the table the game's cards carry; a type the game has no sensor of is named as ARGUS names it.
import type { Card, Text } from "../game/types";
import type { MessageKey } from "../i18n";
import type { SensorPinFace, SensorRef } from "../view3d/house";
import { iconSvg } from "./Icon";

/** The game's sensor for the 3D data's own grouping, where a sensor has no ARGUS type given. */
const CARD_OF_KIND: Record<string, string> = {
  humidity: "humidity",
  temperature: "temperature",
  light_uv: "light_uv",
  airflow: "airflow",
  tiltmeter: "tiltmeter",
  crackmeter: "crackmeter",
  vibration: "vibration",
  rain_gauge: "rain_gauge",
  soil_moisture: "soil_moisture",
  weather_station: "weather_station",
  people_counter: "visitor_counter",
  acoustic: "acoustic",
  gnss: "gnss",
};

interface Words {
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  pick: (text: Text | undefined) => string;
}

export function sensorPinFace(sensors: SensorRef[], cards: Card[], { t, pick }: Words): SensorPinFace {
  // (one instrument ARGUS measures several things with stands there as several records: said once)
  const once = sensors.filter((s, i) => !s.serial || sensors.findIndex((o) => o.serial === s.serial && o.type === s.type && o.where === s.where) === i);
  const known = once.map((s) => {
    const card = (s.type ? cards.find((c) => c.instrument_types.includes(s.type!)) : undefined) ?? cards.find((c) => c.id === CARD_OF_KIND[s.kind]);
    return { s, card, name: card ? pick(card.name) : (s.type?.replace(/ Sensor$/, "") ?? t("view3d.sensorUnknown")) }; // (ARGUS's own name, without its closing "Sensor")
  });
  const card = document.createElement("div");
  card.className = "map-popup view3d-sensor";
  const title = document.createElement("p");
  title.className = "map-popup-title";
  title.textContent = "ARGUS";
  card.append(title);
  // One section for each device (what ARGUS measures with it may be several things: each named in a line)
  const devices = new Map<string, typeof known>();
  known.forEach((k, i) => {
    const key = k.s.serial ? `${k.s.serial}|${k.s.where ?? ""}` : String(i);
    devices.set(key, [...(devices.get(key) ?? []), k]);
  });
  for (const device of devices.values()) {
    const part = document.createElement("section");
    const line = (className: string, text: string) => {
      const p = document.createElement("p");
      if (className) p.className = className;
      p.textContent = text;
      part.append(p);
    };
    for (const { name } of device) line("view3d-sensor-name", name);
    const first = device[0];
    if (first.card && known.length === 1) line("", pick(first.card.tells)); // (the names are enough where there are several)
    const roomKey = `view3d.room${first.s.room}` as MessageKey;
    const place = first.s.room && t(roomKey) !== roomKey ? t(roomKey) : first.s.where; // (a room has its name in every language)
    if (place) line("map-popup-meta", place);
    if (first.s.serial) line("map-popup-meta", t("view3d.sensorSerial", { serial: first.s.serial }));
    if (device.some((d) => d.s.alarm)) line("view3d-sensor-alarm", t("view3d.sensorAlarm"));
    card.append(part);
  }
  return {
    icon: known.length > 1 ? `<span class="pin-num">${known.length}</span>` : iconSvg(known[0].card?.id ?? "other", 16),
    name: t("map.argus", { names: known.map((k) => k.name).join(", ") }),
    card,
  };
}
