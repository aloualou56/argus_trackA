import mark from "../assets/brand-mark.png";

// The emblem's width to its height (src/assets/brand-mark.png, cut from docs/brand/logo.png).
const ASPECT = 0.853;

/**
 * The game's mark: a guardian's shield over a classical temple on the survey grid. The picture is
 * a mask painted in the text colour, so it is white on the green band and green on a report card.
 * Decorative: the name next to it carries the meaning.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      aria-hidden="true"
      style={{ width: Math.round(size * ASPECT), height: size, WebkitMaskImage: `url(${mark})`, maskImage: `url(${mark})` }}
    />
  );
}
