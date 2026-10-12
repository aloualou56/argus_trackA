import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { LANGS, useI18n } from "../i18n";
import { Icon } from "./Icon";

/**
 * The language menu: a button that opens a short list of buttons, each language under its own name.
 * Plain buttons, so it works with every keyboard and screen reader: Enter or Space opens and
 * chooses, the arrow keys move through the list, Escape closes it and returns to the button.
 */
export function LangMenu() {
  const { t, lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const current = LANGS.find((l) => l.id === lang) ?? LANGS[0];

  useEffect(() => {
    if (!open) return;
    // Opening puts focus on the language in use, so the arrow keys start from it.
    root.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
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
    const items = [...(root.current?.querySelectorAll<HTMLElement>(".lang-list button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus();
  };

  return (
    <div className="lang-menu" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={toggle}
        type="button"
        className="lang-toggle"
        aria-expanded={open}
        aria-controls="lang-list"
        aria-label={`${t("lang.label")}: ${current.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="globe" size={20} />
        <span lang={current.id}>{current.name}</span>
        <Icon name="chevron" size={16} className="lang-chevron" />
      </button>
      <ul id="lang-list" className="lang-list" hidden={!open}>
        {LANGS.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              lang={l.id}
              aria-current={l.id === lang ? "true" : undefined}
              onClick={() => {
                // The new screen language is announced by the page heading taking focus (see App).
                setLang(l.id);
                setOpen(false);
              }}
            >
              <span>{l.name}</span>
              {l.id === lang && <Icon name="check" size={18} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
