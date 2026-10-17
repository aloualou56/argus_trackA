import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface DropdownOption {
  id: string;
  name: string;
  /** Language of the name, when it differs from the page's (the language menu). */
  lang?: string;
}

interface Props {
  /** Unique on the page: the list gets `${id}-list`. */
  id: string;
  /** What is being chosen, for screen readers: the button reads "{label}: {current name}". */
  label: string;
  options: DropdownOption[];
  value: string;
  onChange: (id: string) => void;
  icon?: ReactNode;
  className?: string;
}

/** Where an open list fits: below its button, or above it when there is more room there, and never
 *  taller than that room (it scrolls inside itself), so none of it is cut by the edge of the screen
 *  or of the panel it is in. */
function fitList(button: HTMLElement, list: HTMLElement) {
  let top = 0;
  let bottom = window.innerHeight;
  // (the nearest box that cuts what overflows it: the panel the list is in, if any)
  let p = button.parentElement;
  while (p && p !== document.body && !/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowY)) p = p.parentElement;
  if (p && p !== document.body) {
    const r = p.getBoundingClientRect();
    top = Math.max(top, r.top);
    bottom = Math.min(bottom, r.bottom);
  }
  const b = button.getBoundingClientRect();
  const gap = 8;
  const below = bottom - b.bottom - 2 * gap;
  const above = b.top - top - 2 * gap;
  list.style.maxHeight = "";
  const whole = list.scrollHeight + list.offsetHeight - list.clientHeight;
  const up = whole > below && above > below;
  list.classList.toggle("is-up", up);
  list.style.maxHeight = `min(60vh, ${Math.max(0, up ? above : below)}px)`;
}

/**
 * The game's own drop-down: a button that opens a short list of buttons. Plain buttons, so it
 * works with every keyboard and screen reader: Enter or Space opens and chooses, the arrow keys
 * move through the list, Escape closes it and returns to the button, a click elsewhere closes it.
 * Used for the language menu and wherever a browser's own select would break the look.
 */
export function Dropdown({ id, label, options, value, onChange, icon, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.id === value) ?? options[0];

  // The open list stays all where it can be seen (fitList); opening puts focus on the option in use,
  // so the arrow keys start from it, without scrolling the page (the list scrolls to it, inside).
  useLayoutEffect(() => {
    const list = root.current?.querySelector<HTMLElement>(".menu-list");
    if (!open || !toggle.current || !list) return;
    fitList(toggle.current, list);
    const on = list.querySelector<HTMLElement>('[aria-current="true"]');
    on?.focus({ preventScroll: true });
    if (on) list.scrollTop = Math.max(0, Math.min(list.scrollTop, on.offsetTop), on.offsetTop + on.offsetHeight - list.clientHeight);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      toggle.current?.focus();
      return;
    }
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLElement>(".menu-list button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className={`menu ${className}`.trim()} ref={root} onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        id={id}
        type="button"
        className="menu-toggle"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className="menu-value" lang={current.lang}>
          {current.name}
        </span>
        <Icon name="chevron" size={16} className="menu-chevron" />
      </button>
      <ul id={`${id}-list`} className="menu-list" hidden={!open}>
        {options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              lang={o.lang}
              aria-current={o.id === value ? "true" : undefined}
              onClick={() => {
                setOpen(false);
                if (o.id !== value) onChange(o.id);
                else toggle.current?.focus();
              }}
            >
              <span>{o.name}</span>
              {o.id === value && <Icon name="check" size={18} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
