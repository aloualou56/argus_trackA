import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import {
  DEFAULTS,
  TEXT_SIZES,
  setSettings,
  systemReducesMotion,
  useA11ySettings,
  type TextSize,
} from "../a11y/settings";
import { onVibrationChange, setVibrationOn, vibrationLikely, vibrationOn } from "../audio/haptics";
import { onSoundChange, play, setSoundOn, soundOn } from "../audio/sounds";
import { useI18n, type MessageKey } from "../i18n";
import { Icon } from "./Icon";

const SIZE_KEY: Record<TextSize, MessageKey> = { 100: "a11y.sizeNormal", 125: "a11y.sizeLarge", 150: "a11y.sizeLarger" };

function useSound(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(soundOn);
  useEffect(() => onSoundChange(setOn), []);
  return [on, setSoundOn];
}

function useVibration(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(vibrationOn);
  useEffect(() => onVibrationChange(setOn), []);
  return [on, setVibrationOn];
}

/**
 * The settings, as native controls: a radio group for the text size and checkboxes for the rest.
 * `compact` shows only sound and vibration (the phone's "?" card, where the top band is hidden).
 */
export function A11ySettingsPanel({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const id = useId();
  const settings = useA11ySettings();
  const [sound, setSound] = useSound();
  const [vibration, setVibration] = useVibration();
  const deviceMotion = systemReducesMotion();
  const switches: { key: string; label: MessageKey; hint?: MessageKey; checked: boolean; disabled?: boolean; set: (on: boolean) => void }[] = [
    ...(compact
      ? []
      : [
          { key: "contrast", label: "a11y.contrast" as const, hint: "a11y.contrastHint" as const, checked: settings.contrast, set: (on: boolean) => setSettings({ contrast: on }) },
          {
            key: "motion",
            label: "a11y.motion" as const,
            hint: deviceMotion ? ("a11y.motionDevice" as const) : ("a11y.motionHint" as const),
            checked: settings.lessMotion || deviceMotion,
            disabled: deviceMotion,
            set: (on: boolean) => setSettings({ lessMotion: on }),
          },
          { key: "spacing", label: "a11y.spacing" as const, hint: "a11y.spacingHint" as const, checked: settings.spacing, set: (on: boolean) => setSettings({ spacing: on }) },
        ]),
    {
      key: "sound",
      label: "a11y.sound",
      checked: sound,
      set: (on: boolean) => {
        setSound(on);
        if (on) play("place"); // a first sound, so turning it on is heard
      },
    },
    ...(vibrationLikely() ? [{ key: "vibration", label: "a11y.vibration" as const, checked: vibration, set: setVibration }] : []),
  ];

  return (
    <div className="a11y-settings">
      {!compact && (
        <fieldset className="a11y-sizes">
          <legend>{t("a11y.textSize")}</legend>
          {TEXT_SIZES.map((size) => (
            <label key={size} className="a11y-size">
              <input
                type="radio"
                name={`${id}-size`}
                checked={settings.textSize === size}
                onChange={() => setSettings({ textSize: size })}
              />
              <span style={{ fontSize: `${size / 100}em` }}>{t(SIZE_KEY[size])}</span>
            </label>
          ))}
        </fieldset>
      )}
      <ul className="a11y-switches">
        {switches.map((s) => (
          <li key={s.key}>
            <label className="a11y-switch">
              <input
                type="checkbox"
                checked={s.checked}
                disabled={s.disabled}
                aria-describedby={s.hint ? `${id}-${s.key}-hint` : undefined}
                onChange={(e) => s.set(e.target.checked)}
              />
              <span className="a11y-switch-label">{t(s.label)}</span>
            </label>
            {s.hint && (
              <p id={`${id}-${s.key}-hint`} className="a11y-hint">
                {t(s.hint)}
              </p>
            )}
          </li>
        ))}
      </ul>
      {!compact && (
        <button
          type="button"
          className="btn btn-quiet a11y-reset"
          onClick={() => {
            setSettings(DEFAULTS);
            setSound(true);
            setVibration(true);
          }}
        >
          {t("a11y.reset")}
        </button>
      )}
    </div>
  );
}

/** The accessibility menu in the top band: a button that opens the settings below it. */
export function A11yMenu() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // A tap or a click outside closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    }
  };

  return (
    <div
      className="a11y-menu"
      ref={root}
      onKeyDown={onKeyDown}
      // Tabbing out of the menu closes it, so it never covers the control that has the focus.
      onBlur={(e) => {
        if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        className="a11y-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("a11y.title")}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="access" size={22} />
      </button>
      <section id={panelId} className="a11y-panel" aria-label={t("a11y.title")} hidden={!open}>
        <h2>{t("a11y.title")}</h2>
        <A11ySettingsPanel />
        <button
          type="button"
          className="btn btn-primary a11y-done"
          onClick={() => {
            setOpen(false);
            button.current?.focus();
          }}
        >
          {t("a11y.done")}
        </button>
      </section>
    </div>
  );
}
