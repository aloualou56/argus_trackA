// Line icons (24x24, stroke = currentColor). Always decorative: every icon sits next to
// visible text or inside an element with its own label, so they are hidden from screen readers.
// Kept as static SVG strings so map pins (plain DOM, see GameMap) can use the same icons.

const PATHS: Record<string, string> = {
  humidity: '<path d="M12 3c-3 4.5-6 7.6-6 11a6 6 0 0 0 12 0c0-3.4-3-6.5-6-11z"/>',
  temperature: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v8"/>',
  airflow: '<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h6"/>',
  air_quality:
    '<path d="M7 16h10a4 4 0 0 0 .4-8A6 6 0 0 0 6 9a3.5 3.5 0 0 0 1 7z"/><circle cx="8" cy="20" r="1"/><circle cx="12" cy="21" r="1"/><circle cx="16" cy="20" r="1"/>',
  light_uv:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  rain_gauge: '<path d="M7 4h10l-1.5 15a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2z"/><path d="M8 12h8M10 8h4M10 16h4"/>',
  soil_moisture:
    '<path d="M3 20h18"/><path d="M12 20v-7"/><path d="M12 13c0-3 2-5 5-5 0 3-2 5-5 5zM12 15c0-2.5-1.8-4-4-4 0 2.2 1.6 4 4 4z"/><path d="M6 4c-1 1.5-2 2.6-2 3.6a2 2 0 0 0 4 0C8 6.6 7 5.5 6 4z"/>',
  weather_station:
    '<path d="M12 22V8M8 22h8"/><path d="M12 8 6 5M12 8l6-3M12 8V3"/><circle cx="5" cy="4.5" r="1.5"/><circle cx="19" cy="4.5" r="1.5"/><circle cx="12" cy="2.5" r="1"/>',
  crackmeter: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M12 4l-2 4 3 3-2 4 2 5"/><path d="M6 12h3M15 12h3"/>',
  tiltmeter: '<path d="M4 21h16"/><path d="M9 21 13 4l3 1-4 16"/><path d="M7 21V9" stroke-dasharray="2 2"/>',
  vibration: '<path d="M2 12h3l2-6 3 12 3-12 3 12 2-6h4"/>',
  gnss: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  acoustic: '<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>',
  visitor_counter:
    '<circle cx="9" cy="7" r="3"/><path d="M3 21v-1a6 6 0 0 1 12 0v1"/><circle cx="17" cy="8" r="2.5"/><path d="M17.5 13.5A4.5 4.5 0 0 1 21 18v3"/>',
  camera:
    '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
  satellite:
    '<rect x="10" y="6" width="5" height="5" rx="1" transform="rotate(45 12.5 8.5)"/><path d="M8.2 6.4 5 3.2 2.5 5.7l3.2 3.2zM16.8 10.6l3.2 3.2-2.5 2.5-3.2-3.2z"/><path d="M11 12l-2 2"/><path d="M4 15a5 5 0 0 0 5 5M4 19a1 1 0 0 0 1 1"/>',
  observer:
    '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
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
