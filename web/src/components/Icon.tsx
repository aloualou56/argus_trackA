// Line icons (24x24, stroke = currentColor). Always decorative: every icon sits next to
// visible text or inside an element with its own label, so they are hidden from screen readers.
// Kept as static SVG strings so map pins (plain DOM, see GameMap) can use the same icons.
//
// The sensor icons are the game's own drawings of the instruments themselves (a thermometer with
// its scale, a rain gauge with its funnel, a crack meter bridging a crack), not general symbols:
// the thin marks (stroke-width 1.5) are measuring ticks, the motif they share with the map sheet.

const TICK = 'stroke-width="1.5"';
const DOT = 'fill="currentColor" stroke="none"';

const PATHS: Record<string, string> = {
  // -- air and light
  // hygrometer: a drop with its level marks
  humidity: `<path d="M12 3c-3.2 4.6-6 7.7-6 11.2a6 6 0 0 0 12 0C18 10.7 15.2 7.6 12 3z"/><path d="M9.6 13h4.8M10.6 16.2h2.8" ${TICK}/>`,
  // thermometer with its scale
  temperature: `<path d="M8 14.6V5a2 2 0 0 1 4 0v9.6a4 4 0 1 1-4 0z"/><path d="M10 15.5V9.5"/><circle cx="10" cy="18" r="1.3" ${DOT}/><path d="M15.5 6h3.5M15.5 9.5h2.2M15.5 13h3.5" ${TICK}/>`,
  // vane anemometer: a small fan in its ring
  airflow: `<circle cx="12" cy="12" r="8.6"/><path d="M12 12c-1.2-3 .2-5.6 2.8-6.3M12 12c3.2-.5 5.4 1.3 5.7 4M12 12c-1.9 2.5-4.8 2.4-6.6.4" ${TICK}/><circle cx="12" cy="12" r="1.3" ${DOT}/>`,
  // gas sensor: the sensor head and the gas around it
  air_quality: `<rect x="5" y="12" width="14" height="8.5" rx="2"/><path d="M9 16.2h6" ${TICK}/><circle cx="7.5" cy="6.5" r="1.5"/><circle cx="12.6" cy="4.3" r="1"/><circle cx="16.8" cy="7.6" r="1.7"/>`,
  // light meter: the sensor dome and the rays reaching it
  light_uv: `<path d="M5 17.5a7 7 0 0 1 14 0z"/><path d="M3 20.5h18"/><path d="M12 3v3.4M4.8 6.4l2.4 2.4M19.2 6.4l-2.4 2.4" ${TICK}/>`,
  // -- water and weather
  // rain gauge: the funnel, the measuring tube and its marks
  rain_gauge: `<path d="M5.5 8h13l-2.3 4H7.8z"/><path d="M8.5 12v8.5h7V12"/><path d="M11 15h2.4M11 17.8h2.4" ${TICK}/><path d="M9 2.6v2M12 3.6v2M15 2.6v2" ${TICK}/>`,
  // soil probe: two prongs pushed into the ground
  soil_moisture: `<rect x="8" y="3" width="8" height="6" rx="1.5"/><path d="M10 9v10.5M14 9v10.5"/><path d="M3 13h4M17 13h4"/><path d="M5.5 17.4h.01M18.5 17.4h.01M7 20.6h.01M17 20.6h.01" stroke-width="2.2"/>`,
  // weather mast: cup anemometer and wind vane
  weather_station: `<path d="M12 21.5V8.5M8 21.5h8"/><path d="M5 8.5h14"/><circle cx="5" cy="6.4" r="1.9"/><circle cx="19" cy="6.4" r="1.9"/><path d="M12 8.5V3l4.2 1.6L12 6.2" ${TICK}/>`,
  // -- walls and ground
  // crack meter: two anchors joined across a crack
  crackmeter: `<path d="M12 2l-1.6 3.6 2.6 3.2M12 15.2l-1.4 3.2 1.8 3.6" ${TICK}/><rect x="2.8" y="9" width="6.4" height="6" rx="1"/><rect x="14.8" y="9" width="6.4" height="6" rx="1"/><path d="M9.2 12h5.6"/><path d="M11 10.8v2.4M13 10.8v2.4" ${TICK}/>`,
  // tilt meter: a leaning wall against the plumb line
  tiltmeter: `<path d="M3.5 21h17"/><path d="M8.5 21 12 4.5h4L12.5 21"/><path d="M8.5 21V5" stroke-dasharray="2 2.6" ${TICK}/><path d="M8.5 11.5c.8 0 1.5.1 2.1.3" ${TICK}/>`,
  // geophone: a box on the ground, its spring, and the shaking
  vibration: `<path d="M3 20.5h18"/><rect x="8" y="12.5" width="8" height="8" rx="1"/><path d="M12 12.5v-2l-2.2-1.4 4.4-1.7-4.4-1.7L12 4.3V3" ${TICK}/><path d="M5 14.5c-1 1.2-1 2.8 0 4M19 14.5c1 1.2 1 2.8 0 4" ${TICK}/>`,
  // satellite positioning: the antenna on its tripod
  gnss: `<path d="M12 12v4M8 21.5l4-5.5 4 5.5"/><path d="M6.5 12a5.5 5.5 0 0 1 11 0z"/><path d="M12 2.5v2.4M6.4 3.8l1.4 2M17.6 3.8l-1.4 2" ${TICK}/>`,
  // acoustic sensor: a pick-up on a beam, listening
  acoustic: `<rect x="3" y="15" width="18" height="5.5" rx="1"/><path d="M9 15v-2.5a3 3 0 0 1 6 0V15"/><path d="M8.2 7.2a5.4 5.4 0 0 1 7.6 0M5.6 4.6a9 9 0 0 1 12.8 0" ${TICK}/>`,
  // -- eyes and counters
  // people, not an instrument: a person with a checklist
  observer: `<circle cx="9" cy="6.5" r="3"/><path d="M3.5 20.5v-2a5.5 5.5 0 0 1 8-4.9"/><rect x="13.5" y="11.5" width="7.5" height="9" rx="1"/><path d="M15.6 16.2l1.3 1.3 2.1-2.7" ${TICK}/>`,
  // visitor counter: a person passing the counting post
  visitor_counter: `<circle cx="8.5" cy="6" r="2.5"/><path d="M4 20.5v-4.8a4.5 4.5 0 0 1 9 0v4.8"/><path d="M17.5 4v16.5"/><path d="M17.5 8.5h3.5M17.5 13h3.5" ${TICK}/>`,
  // multispectral camera: one body, several lenses
  camera: `<rect x="3" y="7" width="18" height="12.5" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="9.2" cy="13.2" r="2.6"/><circle cx="16" cy="11.2" r="1.3" ${TICK}/><circle cx="16" cy="15.4" r="1.3" ${TICK}/>`,
  // satellite images: the satellite and what it sends down
  satellite: `<rect x="9.5" y="3.5" width="5" height="7" rx="1"/><path d="M9.5 8.5H3.5v-3h6M14.5 8.5h6v-3h-6"/><path d="M12 10.5v2.6"/><path d="M8.4 17.6a5.2 5.2 0 0 1 7.2 0M10.2 20.6a2.6 2.6 0 0 1 3.6 0" ${TICK}/>`,

  // -- things to look out for, and the interface
  sprout: '<path d="M3 20.5h18"/><path d="M12 20.5v-7.5"/><path d="M12 13c0-3 2-5 5-5 0 3-2 5-5 5zM12 15.2c0-2.5-1.8-4-4-4 0 2.2 1.6 4 4 4z"/>',
  trace: '<path d="M2 12h3l2-6 3 12 3-12 3 12 2-6h4"/>',
  pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  half: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor"/>',
  other: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17.5v.01"/>',
  coin: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  cross: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  globe:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  talk: '<path d="M4 5h16v11H9l-5 4z"/>',
  layers: '<path d="M12 3 2 8l10 5 10-5z"/><path d="M2 13l10 5 10-5"/>',
};

const ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

/** SVG markup for map pins and other non-React DOM. */
export function iconSvg(name: string, size = 24): string {
  return `<svg width="${size}" height="${size}" ${ATTRS}>${PATHS[name] ?? PATHS.other}</svg>`;
}

export function Icon({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: PATHS[name] ?? PATHS.other }}
    />
  );
}

/** Every icon name, for the icon sheet check. */
export const ICON_NAMES = Object.keys(PATHS);
