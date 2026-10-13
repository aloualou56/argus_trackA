import type { ReactNode } from "react";
import type { ConsequencePicture } from "../game/types";
import { useI18n } from "../i18n";

// "If nobody had noticed": the same thing drawn today and years later, side by side.
// The drawings explain a kind of damage; they are not pictures of the site (the caption says so).
// Decorative for screen readers: the text next to them says what they show.

type State = "before" | "after";

/** Every drawing there is (tools/build_game_data.py checks the content against the same list). */
export const CONSEQUENCE_PICTURES: readonly ConsequencePicture[] = ["mosaic", "floor", "stone", "lean", "tree", "fresco", "crack"];

const W = 200;
const H = 140;

/** A small fixed pseudo-random sequence, so a drawing is the same on every visit. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Rows of stones, offset like real masonry. `skip` leaves a stone out (fallen). */
function masonry(
  x: number,
  y: number,
  w: number,
  h: number,
  rows: number,
  seed: number,
  skip: (row: number, col: number) => boolean = () => false,
): ReactNode[] {
  const rnd = seeded(seed);
  const out: ReactNode[] = [];
  const rh = h / rows;
  for (let r = 0; r < rows; r++) {
    let cx = x - (r % 2 ? rh * 0.9 : 0);
    let c = 0;
    while (cx < x + w) {
      const sw = rh * (1.4 + rnd() * 0.9);
      const left = Math.max(cx, x);
      const right = Math.min(cx + sw, x + w);
      if (right - left > 3 && !skip(r, c)) {
        out.push(
          <rect
            key={`${r}-${c}`}
            className="cq-stone"
            x={left + 0.6}
            y={y + r * rh + 0.6}
            width={right - left - 1.2}
            height={rh - 1.2}
            rx={1.5}
            style={{ fillOpacity: 0.75 + rnd() * 0.25 }}
          />,
        );
      }
      cx += sw;
      c++;
    }
  }
  return out;
}

/** A mosaic floor seen from above: a dark border, a light field and a mask in the middle. */
function Mosaic({ state, wear }: { state: State; wear: "salt" | "path" }) {
  const cell = 8;
  const x0 = 12;
  const y0 = 10;
  const cols = 22;
  const rows = 15;
  const rnd = seeded(7);
  const cells: ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const border = r < 2 || c < 2 || r >= rows - 2 || c >= cols - 2;
      const band = !border && (r === 2 || c === 2 || r === rows - 3 || c === cols - 3);
      // The mask: a face (ellipse) with two eyes and a mouth.
      const dx = (c - cols / 2 + 0.5) / 3.6;
      const dy = (r - rows / 2 + 0.5) / 4.2;
      const face = dx * dx + dy * dy < 1;
      const eye = (r === 6 && (c === 9 || c === 12)) || (r === 9 && c >= 10 && c <= 11);
      let cls = border ? "cq-t-dark" : band ? "cq-t-red" : face ? (eye ? "cq-t-dark" : "cq-t-ochre") : "cq-t-light";
      const n = rnd();
      let missing = false;
      if (state === "after") {
        if (wear === "salt") {
          // Damp rises from the lower left: tesserae are lost there first.
          const damp = (c + (rows - r) * 1.3) / (cols + rows * 1.3);
          missing = n > 0.35 + damp * 0.9;
        } else {
          // Everyone walks the same diagonal: the pattern fades along it.
          const d = Math.abs(r - (rows - 1) + c * (rows / cols));
          if (d < 2.4) {
            cls = "cq-t-worn";
            missing = n > 0.75;
          }
        }
      }
      if (missing) continue;
      cells.push(
        <rect key={`${r}-${c}`} className={cls} x={x0 + c * cell + 0.6} y={y0 + r * cell + 0.6} width={cell - 1.2} height={cell - 1.2} rx={0.8} />,
      );
    }
  }
  return (
    <>
      <rect className="cq-bed" x={x0} y={y0} width={cols * cell} height={rows * cell} />
      {cells}
      {state === "after" && wear === "salt" && <SaltCrust />}
    </>
  );
}

/** White salt crystals where the damp comes up (lower left), and a crack through the floor. */
function SaltCrust() {
  const rnd = seeded(21);
  const crystals: ReactNode[] = [];
  for (let i = 0; i < 170; i++) {
    // Denser towards the lower left, where the water rises.
    const x = 14 + Math.pow(rnd(), 1.8) * 120;
    const y = 128 - Math.pow(rnd(), 1.6) * 90;
    const r = 0.9 + rnd() * 1.8;
    crystals.push(<rect key={i} x={x - r} y={y - r} width={r * 2} height={r * 2} transform={`rotate(45 ${x} ${y})`} />);
  }
  return (
    <g className="cq-salt">
      {crystals}
      <path className="cq-crack" d="M70 24l8 18-6 14 10 16-4 20 8 18" />
    </g>
  );
}

/** A carved stone block with a rosette, crisp today, rounded and pitted later. */
function Stone({ state }: { state: State }) {
  const worn = state === "after";
  const rnd = seeded(3);
  return (
    <>
      <path className="cq-ground" d="M0 124H200" />
      <rect className="cq-stone" x={40} y={worn ? 32 : 28} width={120} height={worn ? 92 : 96} rx={worn ? 18 : 2} />
      <rect className="cq-carve" x={52} y={40} width={96} height={72} rx={worn ? 14 : 1} style={{ opacity: worn ? 0.35 : 1 }} />
      <g className="cq-carve" style={{ opacity: worn ? 0.25 : 1 }}>
        <circle cx={100} cy={76} r={22} />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return <ellipse key={i} cx={100 + Math.cos(a) * 13} cy={76 + Math.sin(a) * 13} rx={6} ry={3.2} transform={`rotate(${(i * 45) % 180} ${100 + Math.cos(a) * 13} ${76 + Math.sin(a) * 13})`} />;
        })}
        <circle cx={100} cy={76} r={4} />
      </g>
      {worn && (
        <g className="cq-pits">
          {Array.from({ length: 26 }, (_, i) => (
            <circle key={i} cx={46 + rnd() * 108} cy={36 + rnd() * 84} r={0.8 + rnd() * 2.2} />
          ))}
          <path className="cq-flake" d="M42 118l8-6 6 8z M150 120l6-8 5 8z M120 124l5-4 4 4z" />
        </g>
      )}
    </>
  );
}

/** A wall on a slope: upright today; later the slope has slid and the wall leans and breaks. */
function Lean({ state }: { state: State }) {
  const after = state === "after";
  return (
    <>
      <path className="cq-earth" d={after ? "M0 96L70 104 84 112 200 132V140H0z" : "M0 96L200 126V140H0z"} />
      <g transform={after ? "rotate(9 120 112)" : undefined}>
        {masonry(70, 36, 56, 72, 7, 11, after ? (r, c) => r === 0 && c > 1 : undefined)}
      </g>
      {after && (
        <g>
          <path className="cq-crack" d="M100 44l-6 14 8 10-6 14 6 10" transform="rotate(9 120 112)" />
          <rect className="cq-stone" x={150} y={122} width={13} height={8} rx={1.5} transform="rotate(14 156 126)" />
          <rect className="cq-stone" x={168} y={126} width={11} height={7} rx={1.5} transform="rotate(-8 173 129)" />
        </g>
      )}
      <path className="cq-ground" d={after ? "M0 96L70 104 84 112 200 132" : "M0 96L200 126"} />
    </>
  );
}

/** An old wall with a tree beside it; later a branch has fallen and knocked the top stones down. */
function Tree({ state }: { state: State }) {
  const after = state === "after";
  return (
    <>
      <path className="cq-ground" d="M0 124H200" />
      {masonry(20, 64, 120, 60, 6, 5, after ? (r, c) => r === 0 && c >= 3 && c <= 6 : undefined)}
      <path className="cq-trunk" d="M168 124c-2-24 0-46-2-70" />
      <g className="cq-leaves">
        <circle cx={160} cy={40} r={22} />
        <circle cx={178} cy={52} r={16} />
        {!after && <circle cx={132} cy={46} r={16} />}
      </g>
      {after ? (
        <g>
          {/* The broken branch lies across the wall, its leaves on the stones. */}
          <path className="cq-trunk" d="M164 72L96 66" />
          <path className="cq-break" d="M164 66l4 6-4 6" />
          <g className="cq-leaves">
            <circle cx={96} cy={62} r={12} />
            <circle cx={110} cy={58} r={9} />
          </g>
          <rect className="cq-stone" x={64} y={116} width={14} height={8} rx={1.5} transform="rotate(-10 71 120)" />
          <rect className="cq-stone" x={84} y={117} width={12} height={7} rx={1.5} transform="rotate(12 90 120)" />
          <rect className="cq-stone" x={44} y={118} width={12} height={6} rx={1.5} />
        </g>
      ) : (
        <path className="cq-trunk" d="M164 72c-10-6-22-14-30-24" />
      )}
    </>
  );
}

/** A wall painting: a saint with a halo; later a damp band with salt, flaking and faded paint. */
function Fresco({ state }: { state: State }) {
  const after = state === "after";
  return (
    <>
      <rect className="cq-plaster" x={10} y={8} width={180} height={124} />
      <g style={{ opacity: after ? 0.6 : 1 }}>
        <rect className="cq-frame" x={40} y={16} width={120} height={98} />
        <circle className="cq-halo" cx={100} cy={40} r={15} />
        <circle className="cq-skin" cx={100} cy={42} r={9} />
        <path className="cq-robe" d="M78 112c2-30 8-50 22-56 14 6 20 26 22 56z" />
        <path className="cq-robe2" d="M92 112c0-20 3-34 8-40 5 6 8 20 8 40z" />
      </g>
      {after && (
        <g>
          <rect className="cq-damp" x={10} y={92} width={180} height={40} />
          <path className="cq-salt-line" d="M10 92c12-4 22 3 34-1s24 4 36 0 22 3 34 0 26 4 38 0 18 3 28 0" />
          <g className="cq-flaked">
            <path d="M112 64c6-4 14 0 12 8-2 6-12 6-14 0z" />
            <path d="M80 84c4-3 10-1 9 5-1 4-8 5-10 0z" />
            <path d="M126 96c5-3 12 0 10 6-2 5-10 5-11 0z" />
            <path d="M58 30c4-2 8 1 7 5-1 3-6 3-7 0z" />
          </g>
        </g>
      )}
    </>
  );
}

/** A tall wall with a hairline crack; later the crack is wide, plants grow in it and stones have fallen. */
function Crack({ state }: { state: State }) {
  const after = state === "after";
  return (
    <>
      <path className="cq-ground" d="M0 128H200" />
      {masonry(46, 14, 108, 114, 10, 9, after ? (r, c) => (r === 0 && c >= 2 && c <= 4) || (r === 1 && c === 3) : undefined)}
      {after ? (
        <g>
          <path className="cq-gap" d="M96 26l8 14-6 12 9 16-7 14 8 16-5 14 6 16h-8l-5-14 4-14-8-16 6-14-8-16 5-12-7-14z" />
          <g className="cq-leaves">
            <circle cx={103} cy={60} r={5} />
            <circle cx={96} cy={92} r={4} />
          </g>
          <rect className="cq-stone" x={20} y={120} width={14} height={8} rx={1.5} transform="rotate(-12 27 124)" />
          <rect className="cq-stone" x={164} y={121} width={13} height={7} rx={1.5} transform="rotate(9 170 124)" />
          <rect className="cq-stone" x={150} y={122} width={10} height={6} rx={1.5} />
        </g>
      ) : (
        <path className="cq-crack" d="M100 40l3 12-2 10 3 12-2 10" />
      )}
    </>
  );
}

function Picture({ picture, state }: { picture: ConsequencePicture; state: State }) {
  switch (picture) {
    case "mosaic":
      return <Mosaic state={state} wear="salt" />;
    case "floor":
      return <Mosaic state={state} wear="path" />;
    case "stone":
      return <Stone state={state} />;
    case "lean":
      return <Lean state={state} />;
    case "tree":
      return <Tree state={state} />;
    case "fresco":
      return <Fresco state={state} />;
    case "crack":
      return <Crack state={state} />;
  }
}

export function ConsequenceDrawings({ picture }: { picture: ConsequencePicture }) {
  const { t } = useI18n();
  return (
    <figure className="consequence-pair">
      {(["before", "after"] as const).map((state) => (
        <div key={state} className={`consequence-pane is-${state}`}>
          <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
            <Picture picture={picture} state={state} />
          </svg>
          <p className="consequence-label">{t(state === "before" ? "consequence.before" : "consequence.after")}</p>
        </div>
      ))}
      <figcaption className="small">{t("consequence.drawing")}</figcaption>
    </figure>
  );
}
