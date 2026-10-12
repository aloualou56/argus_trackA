/**
 * The game's own mark: a guardian's shield holding the survey target you place sensors with
 * (the ring and four ticks of the cross on the map), with a brass centre. Decorative: the name
 * next to it carries the meaning.
 */
export function BrandMark({ size = 30 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 2.4l8.6 3.2v6.4c0 5.4-3.7 8.7-8.6 9.8-4.9-1.1-8.6-4.4-8.6-9.8V5.6z" strokeWidth="2" />
      <circle cx="12" cy="11.4" r="3.2" strokeWidth="1.5" />
      <path d="M12 6.2v1.7M12 14.9v1.7M6.8 11.4h1.7M15.5 11.4h1.7" strokeWidth="1.5" />
      <circle className="brand-dot" cx="12" cy="11.4" r="1.25" stroke="none" />
    </svg>
  );
}
