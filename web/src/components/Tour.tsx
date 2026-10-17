// A screen's walkthrough, the first time it opens (README, "Walkthrough"): one thing at a time is lit,
// the rest of the screen is shaded and a little blurred (one veil with a hole, so the blur has no seams), and a card says what it is and what to do
// with it. Where it helps, a small moving picture shows it being done: a finger tapping, a finger
// dragging a sensor onto the map, coins being spent. The light glides from one step to the next.
// "Skip" ends it; either way it is not shown again on this device (game/tours.ts) until "Show me again
// how to play". While it is open the screen behind it cannot be used. With less motion nothing moves.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motionReduced } from "../a11y/settings";
import { markTourSeen, tourSeen, TOURS_RESET } from "../game/tours";
import { useI18n } from "../i18n";
import { Icon } from "./Icon";

export interface TourStep {
  /** What to light up: the first of these selectors that is on the screen. None found: the card alone. */
  target?: string[];
  title: string;
  text: string;
  /** A small moving picture of what to do there. */
  demo?: "tap" | "drag" | "coins";
  /** "tap", "drag": where the finger presses, inside the lit part (selectors); else near its middle. */
  at?: string[];
  /** "drag": where the finger takes the sensor (selectors, as `target`). */
  to?: string[];
  /** "coins": the coins there are, and what the sensor in the picture costs. */
  coins?: { budget: number; cost: number };
}

interface Props {
  /** Which walkthrough this is ("home", "mission"): each is shown once. */
  id: string;
  steps: TourStep[];
  /** False: not now (e.g. coming back to improve the network). */
  enabled?: boolean;
  /** How long the screen settles before the walkthrough starts (the map flies first), in ms. */
  delay?: number;
  /** The last button: "Got it!", or "Let's play!" on the screen where the game begins. */
  last?: "done" | "play";
  onClose?: () => void;
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 8;
const MARGIN = 12;

function find(selectors?: string[]): HTMLElement | null {
  for (const selector of selectors ?? []) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden") return el;
    }
  }
  return null;
}

/** The lit box around an element, kept on the screen (the map can be taller than the window). */
function boxOf(el: HTMLElement | null): Box | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top - PAD, 4);
  const left = Math.max(r.left - PAD, 4);
  const bottom = Math.min(r.bottom + PAD, window.innerHeight - 4);
  const right = Math.min(r.right + PAD, window.innerWidth - 4);
  return bottom > top && right > left ? { top, left, width: right - left, height: bottom - top } : null;
}

/** How long the light takes to glide from one step's part of the screen to the next. */
const GLIDE_MS = 450;
const ease = (t: number) => 1 - (1 - t) ** 3;
const mix = (a: Box, b: Box, t: number): Box => ({
  top: a.top + (b.top - a.top) * t,
  left: a.left + (b.left - a.left) * t,
  width: a.width + (b.width - a.width) * t,
  height: a.height + (b.height - a.height) * t,
});

/** The veil over the whole window with a rounded hole where `box` is (even-odd: the hole is not filled). */
function veilClip(box: Box | null): string | undefined {
  if (!box) return undefined;
  const n = (v: number) => Math.round(v * 10) / 10;
  const { left: x, top: y, width: w, height: h } = box;
  const r = n(Math.min(12, w / 2, h / 2));
  const W = window.innerWidth + 50;
  const H = window.innerHeight + 50;
  return (
    `path(evenodd, "M-50 -50H${W}V${H}H-50Z ` +
    `M${n(x + r)} ${n(y)}H${n(x + w - r)}A${r} ${r} 0 0 1 ${n(x + w)} ${n(y + r)}V${n(y + h - r)}` +
    `A${r} ${r} 0 0 1 ${n(x + w - r)} ${n(y + h)}H${n(x + r)}A${r} ${r} 0 0 1 ${n(x)} ${n(y + h - r)}V${n(y + r)}` +
    `A${r} ${r} 0 0 1 ${n(x + r)} ${n(y)}Z")`
  );
}

/**
 * Brings `el` into view smoothly. The browser's own smooth scrolling does nothing inside an inert
 * part of the page (all of the game while the walkthrough is open), so: an instant scroll finds where
 * each scrolling box must end, they go back, and then glide there frame by frame. Returns a stop.
 */
function glideIntoView(el: HTMLElement, block: ScrollLogicalPosition, still: boolean): () => void {
  const boxes: Element[] = [];
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY + style.overflowX) && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) {
      boxes.push(node);
    }
  }
  const page = document.scrollingElement;
  if (page && !boxes.includes(page)) boxes.push(page);
  const from = boxes.map((b) => [b.scrollLeft, b.scrollTop]);
  el.scrollIntoView({ block, inline: "nearest", behavior: "auto" });
  // A bar that sticks to the top of a scrolling box (the mission's coins and Done, beside the map on a
  // phone on its side) must not cover the part's beginning: the box scrolls back by the bar's height.
  for (const b of boxes) {
    if (b === page) continue;
    for (const bar of Array.from(b.querySelectorAll<HTMLElement>("*"))) {
      if (bar.contains(el) || el.contains(bar) || getComputedStyle(bar).position !== "sticky") continue;
      const covers = bar.getBoundingClientRect();
      const part = el.getBoundingClientRect();
      const across = covers.left < part.right && covers.right > part.left;
      if (across && covers.top <= part.top && covers.bottom > part.top) b.scrollTop -= covers.bottom - part.top + 8;
    }
  }
  const to = boxes.map((b) => [b.scrollLeft, b.scrollTop]);
  if (still) return () => {};
  boxes.forEach((b, k) => {
    b.scrollLeft = from[k][0];
    b.scrollTop = from[k][1];
  });
  const started = performance.now();
  let frame = 0;
  const place = (e: number) =>
    boxes.forEach((b, k) => {
      b.scrollLeft = from[k][0] + (to[k][0] - from[k][0]) * e;
      b.scrollTop = from[k][1] + (to[k][1] - from[k][1]) * e;
    });
  const move = () => {
    const t = Math.min(1, (performance.now() - started) / GLIDE_MS);
    place(ease(t));
    if (t < 1) frame = requestAnimationFrame(move);
  };
  frame = requestAnimationFrame(move);
  // Where no frames come (a page in the background, a phone saving power), it gets there all the same.
  const sure = window.setTimeout(() => {
    cancelAnimationFrame(frame);
    place(1);
  }, GLIDE_MS + 150);
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(sure);
  };
}

const same = (a: Box | null | undefined, b: Box | null | undefined) =>
  a === b || (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

/** The card's own width: 25rem, or the screen's less the margins. */
const naturalWidth = () => Math.min(400, window.innerWidth - 2 * MARGIN);
/** The narrowest the card gets to stand beside the lit part rather than over it. */
const NARROWEST = 260;

/**
 * Where the card goes: under or over the lit part where it fits; else beside it, narrower if it must
 * (a phone on its side); else at the top or the bottom of the screen, on the side with more room.
 * Its width depends on the place alone, never on its own height, so the two can never go round in turn.
 */
function cardPlace(box: Box | null, card: { width: number; height: number }, keep: { y: number } | null): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = naturalWidth();
  const middle = Math.max(MARGIN, (vw - width) / 2);
  if (!box) return { top: Math.max(MARGIN, (vh - card.height) / 2), left: middle, width };
  const left = Math.min(Math.max(box.left, MARGIN), Math.max(MARGIN, vw - width - MARGIN));
  if (vw >= 640) {
    if (box.top + box.height + MARGIN + card.height <= vh - MARGIN) return { top: box.top + box.height + MARGIN, left, width };
    if (box.top - MARGIN - card.height >= MARGIN) return { top: box.top - MARGIN - card.height, left, width };
    const roomRight = vw - box.left - box.width - 2 * MARGIN;
    const roomLeft = box.left - 2 * MARGIN;
    if (Math.max(roomRight, roomLeft) >= NARROWEST) {
      const right = roomRight >= roomLeft;
      const w = Math.min(width, right ? roomRight : roomLeft);
      const top = Math.max(MARGIN, Math.min(box.top, vh - card.height - MARGIN));
      return { top, left: right ? box.left + box.width + MARGIN : box.left - MARGIN - w, width: w };
    }
  }
  // Never over the finger's spot: the other half of the screen. Else the side with more room.
  const roomAbove = box.top;
  const roomBelow = vh - box.top - box.height;
  const below = keep ? keep.y < vh / 2 : roomBelow >= roomAbove;
  return below ? { bottom: MARGIN, left: middle, width } : { top: MARGIN, left: middle, width };
}

export function Tour({ id, steps, enabled = true, delay = 400, last = "done", onClose }: Props) {
  const { t } = useI18n();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [toBox, setToBox] = useState<Box | null>(null);
  const [atBox, setAtBox] = useState<Box | null>(null);
  // The light has arrived at the step's part: the finger shows only then, where the light is.
  const [arrived, setArrived] = useState(false);
  const [cardSize, setCardSize] = useState({ width: 352, height: 220 });
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  // The screens make their steps anew on every render: the light follows the step's number.
  const stepRef = useRef(step);
  stepRef.current = step;
  // What is drawn now: the next step's light glides on from here.
  const shownRef = useRef<Box | null>(null);

  // Once per device, the first time the screen opens; again after "Show me again how to play".
  useEffect(() => {
    if (!enabled || steps.length === 0) return;
    let timer = 0;
    const start = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        before.current = document.activeElement as HTMLElement | null;
        setIndex(0);
        setOpen(true);
      }, delay);
    };
    if (!tourSeen(id)) start();
    window.addEventListener(TOURS_RESET, start);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TOURS_RESET, start);
    };
  }, [id, enabled, delay, steps.length]);

  const close = useCallback(() => {
    markTourSeen(id);
    shownRef.current = null;
    setOpen(false);
    onClose?.();
    const back = before.current?.isConnected ? before.current : document.querySelector<HTMLElement>(".screen h1");
    back?.focus({ preventScroll: true });
  }, [id, onClose]);

  // The step's part of the screen comes into view, and the light follows it as the page moves.
  useEffect(() => {
    if (!open) return;
    const step = stepRef.current;
    const el = find(step.target);
    // Short parts to the middle of the screen; a tall one from its top, which on a phone is just
    // under the map strip (html's scroll-padding-top), so the strip never hides its beginning.
    const tall = !!el && el.getBoundingClientRect().height > window.innerHeight * 0.4;
    const stopScroll = el ? glideIntoView(el, tall ? "start" : "center", motionReduced()) : () => {};
    let frame = 0;
    // (undefined: not measured yet in this step, so the first frame always sets all three)
    let lit: Box | null | undefined;
    let to: Box | null | undefined;
    let press: Box | null | undefined;
    // The light glides from where it was to where the part is now, and then stays on it as the
    // page scrolls: the hole, the frame and the card move together, frame by frame.
    const from = shownRef.current;
    const started = performance.now();
    const glide = from && !motionReduced() ? GLIDE_MS : 0;
    let there = false;
    setArrived(false);
    const follow = () => {
      const live = boxOf(find(step.target));
      const t = glide ? Math.min(1, (performance.now() - started) / glide) : 1;
      if (t >= 1 && !there) setArrived((there = true));
      const now = live && from && t < 1 ? mix(from, live, ease(t)) : live;
      shownRef.current = now;
      if (!same(now, lit)) setBox((lit = now));
      const spot = step.at ? boxOf(find(step.at)) : null;
      if (!same(spot, press)) setAtBox((press = spot));
      const goal = step.demo === "drag" ? boxOf(find(step.to)) : null;
      if (!same(goal, to)) setToBox((to = goal));
      frame = requestAnimationFrame(follow);
    };
    follow();
    return () => {
      cancelAnimationFrame(frame);
      stopScroll();
    };
  }, [open, index]);

  // The card's size, for where it goes; measured a few times a step at most, so a size that kept
  // changing with its place could never loop.
  const measured = useRef({ index: -1, times: 0 });
  useLayoutEffect(() => {
    if (!open || !cardRef.current) return;
    if (measured.current.index !== index) measured.current = { index, times: 0 };
    const r = cardRef.current.getBoundingClientRect();
    if (Math.abs(r.width - cardSize.width) > 1 || Math.abs(r.height - cardSize.height) > 1) {
      if (measured.current.times++ < 4) setCardSize({ width: r.width, height: r.height });
    }
  });

  // While it is open, nothing behind it can be reached; each step's title takes the focus.
  useEffect(() => {
    if (!open) return;
    const root = document.getElementById("root");
    if (root) root.inert = true;
    return () => {
      if (root) root.inert = false;
    };
  }, [open]);
  useEffect(() => {
    if (open) headingRef.current?.focus({ preventScroll: true });
  }, [open, index]);

  if (!open) return null;
  const lastStep = index >= steps.length - 1;
  const next = () => (lastStep ? close() : setIndex(index + 1));

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      // The focus stays in the card.
      const items = Array.from(cardRef.current?.querySelectorAll<HTMLElement>("button, [tabindex='-1']") ?? []);
      const first = items[0];
      const end = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        end?.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  // Where the finger presses: the step's own spot, else near the middle of the lit part.
  const spot = atBox
    ? { x: atBox.left + atBox.width * 0.62, y: atBox.top + atBox.height * 0.5 }
    : box && { x: box.left + Math.min(box.width / 2, 60), y: box.top + Math.min(box.height / 2, 40) };
  // The finger (3rem, and its tap comes in from below and to the right) stays on the screen.
  const from = spot && {
    x: Math.min(Math.max(spot.x, 24), window.innerWidth - 56),
    y: Math.min(Math.max(spot.y, 12), window.innerHeight - 68),
  };
  const finger =
    arrived && from && (step.demo === "tap" || (step.demo === "drag" && toBox))
      ? {
          left: from.x,
          top: from.y,
          ["--dx" as string]: toBox ? `${Math.round(toBox.left + toBox.width / 2 - from.x)}px` : "0px",
          ["--dy" as string]: toBox ? `${Math.round(toBox.top + toBox.height / 2 - from.y)}px` : "0px",
        }
      : null;
  const coins = step.demo === "coins" && step.coins;

  return createPortal(
    <div className="tour">
      <div className="tour-veil" style={{ clipPath: veilClip(box) }} aria-hidden="true" />
      {box && <div className="tour-ring" style={box} aria-hidden="true" />}
      {finger && (
        // A new path (the page settled after scrolling) starts the movement again: a running
        // animation keeps the path it started with.
        <div key={`${finger["--dx" as keyof typeof finger]}|${finger["--dy" as keyof typeof finger]}`} className={`tour-finger is-${step.demo}`} style={finger} aria-hidden="true">
          {step.demo === "drag" && (
            <span className="tour-pin">
              <Icon name="humidity" size={14} />
            </span>
          )}
          <Icon name="hand" size={30} />
        </div>
      )}
      <div
        ref={cardRef}
        key={index}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-text`}
        style={cardPlace(box, cardSize, step.demo === "tap" || step.demo === "drag" ? from : null)}
        onKeyDown={onKeyDown}
      >
        <div className="tour-head">
          <p className="tour-count">{t("tour.count", { n: index + 1, total: steps.length })}</p>
          <button type="button" className="tour-skip" onClick={close}>
            {t("tour.skip")}
          </button>
        </div>
        <h2 id={`${uid}-title`} ref={headingRef} tabIndex={-1}>
          {step.title}
        </h2>
        <p id={`${uid}-text`}>{step.text}</p>
        {coins && (
          <div className="tour-coins" aria-hidden="true">
            <span className="tour-coins-tile">
              <Icon name="humidity" size={20} />
              <span className="tile-cost">
                {Array.from({ length: coins.cost }, (_, k) => (
                  <i key={k} />
                ))}
              </span>
            </span>
            <span className="tour-coins-meter">
              <span className="tour-coins-fill" style={{ ["--after" as string]: `${((coins.budget - coins.cost) / coins.budget) * 100}%` }} />
            </span>
            <span className="tour-coins-count">
              <Icon name="coin" size={16} />
              {coins.budget} → {coins.budget - coins.cost}
            </span>
          </div>
        )}
        <div className="tour-dots" aria-hidden="true">
          {steps.map((_, k) => (
            <i key={k} className={k === index ? "is-now" : k < index ? "is-done" : undefined} />
          ))}
        </div>
        <div className="tour-actions">
          {index > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => setIndex(index - 1)}>
              {t("tour.back")}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={next}>
            {lastStep ? t(last === "play" ? "tour.play" : "tour.done") : t("tour.next")}
            {!lastStep && <Icon name="arrow" size={18} />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
