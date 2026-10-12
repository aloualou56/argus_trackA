import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BaseLang, Lang, Text } from "../game/types";
import de from "./de.json";
import el from "./el.json";
import en from "./en.json";
import es from "./es.json";
import it from "./it.json";

export type MessageKey = keyof typeof en;
export type Vars = Record<string, string | number>;
/** Content of a translated language: the English text -> its translation (data/i18n/<lang>.json). */
export type ContentPack = Record<string, string>;

/** Every language of the interface, in the order of the language menu, each under its own name. */
export const LANGS: { id: Lang; name: string; locale: string }[] = [
  { id: "el", name: "Ελληνικά", locale: "el-GR" },
  { id: "en", name: "English", locale: "en-GB" },
  { id: "it", name: "Italiano", locale: "it-IT" },
  { id: "es", name: "Español", locale: "es-ES" },
  { id: "de", name: "Deutsch", locale: "de-CH" },
];

// A translation may lag behind: a key it lacks is shown in English.
const DICTS: Record<Lang, Partial<Record<MessageKey, string>>> = { el, en, it, es, de };
const LOCALES = Object.fromEntries(LANGS.map((l) => [l.id, l.locale])) as Record<Lang, string>;
export const DEFAULT_LANG: Lang = "el";
const STORAGE_KEY = "guardian.lang";

export const isLang = (value: unknown): value is Lang => LANGS.some((l) => l.id === value);
/** Written by the game team (content/*.json); the other languages are translations of the English. */
export const isBaseLang = (lang: Lang): lang is BaseLang => lang === "el" || lang === "en";

export function format(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Pick this language from a data field: Greek and English are in the field, the rest in `pack`. */
function makePick(lang: Lang, pack: ContentPack | null) {
  return (text: Text | null | undefined) => {
    if (!text) return "";
    return (isBaseLang(lang) ? text[lang] : pack?.[text.en]) || text.en;
  };
}

export function makeI18n(lang: Lang, pack: ContentPack | null = null) {
  const dict = DICTS[lang];
  const locale = LOCALES[lang];
  const plural = new Intl.PluralRules(locale);
  const numberFormat = (digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits });

  const t = (key: MessageKey, vars?: Vars) => format(dict[key] ?? en[key] ?? key, vars);
  const number = (n: number, digits = 1) => numberFormat(digits).format(n);
  /** Counted noun, e.g. tn("unit.coins", 1) -> "1 coin" / "1 νόμισμα". */
  const tn = (base: "unit.coins" | "unit.points", n: number) =>
    t(`${base}.${plural.select(n) === "one" ? "one" : "other"}` as MessageKey, { n: number(n) });
  const pick = makePick(lang, pack);
  const list = (items: string[], type: "conjunction" | "disjunction" = "conjunction") =>
    new Intl.ListFormat(locale, { style: "long", type }).format(items);
  /** Date part of an ARGUS timestamp ("2026-09-10T20:30:00", no zone) as "10 September 2026". */
  const date = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  };
  /** Month and year of an ARGUS timestamp, e.g. "October 2026" / «Οκτώβριος 2026». */
  const month = (iso: string) => {
    const [y, m] = iso.slice(0, 7).split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
  };
  return { lang, locale, t, tn, number, pick, list, date, month };
}

export type I18n = ReturnType<typeof makeI18n>;

interface LangContextValue extends I18n {
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue | null>(null);

/** The first of the browser's languages the game speaks ("it-CH" -> "it"), if any. */
export function browserLang(preferred: readonly string[]): Lang | null {
  for (const tag of preferred) {
    const id = tag.toLowerCase().split("-")[0];
    if (isLang(id)) return id;
  }
  return null;
}

/** The language chosen on this device before; else the browser's, if the game speaks it; else Greek. */
function startLang(): Lang {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (isLang(value)) return value;
  } catch {
    // storage blocked: go by the browser
  }
  return browserLang(navigator.languages ?? [navigator.language]) ?? DEFAULT_LANG;
}

const packs = new Map<Lang, Promise<ContentPack>>();

/** The translated content of one language, shipped with the game (tools/build_game_data.py); fetched once. */
function loadPack(lang: Lang): Promise<ContentPack> {
  if (!packs.has(lang)) {
    const request = fetch(`${import.meta.env.BASE_URL}data/i18n/${lang}.json`).then(async (res) => {
      if (!res.ok) throw new Error(`i18n/${lang}.json: HTTP ${res.status}`);
      return ((await res.json()) as { strings: ContentPack }).strings ?? {};
    });
    request.catch(() => packs.delete(lang));
    packs.set(lang, request);
  }
  return packs.get(lang)!;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(startLang);
  const [loaded, setLoaded] = useState<{ lang: Lang; pack: ContentPack } | null>(null);
  // `t` and the formatters depend on the language only, so they stay the same functions when the
  // content pack arrives a moment later (screens move focus when `t` changes).
  const base = useMemo(() => makeI18n(lang), [lang]);
  const pack = loaded?.lang === lang ? loaded.pack : null;
  const value = useMemo(() => ({ ...base, pick: makePick(lang, pack), setLang: setLangState }), [base, lang, pack]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // not persisted, still works for this visit
    }
    if (isBaseLang(lang)) return;
    let cancelled = false;
    loadPack(lang)
      .then((strings) => !cancelled && setLoaded({ lang, pack: strings }))
      .catch(() => {
        // the pack could not load: the content stays in English, the interface is translated
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useI18n(): LangContextValue {
  const value = useContext(LangContext);
  if (!value) throw new Error("useI18n outside LangProvider");
  return value;
}
