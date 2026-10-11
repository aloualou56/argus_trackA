import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Lang, Text } from "../game/types";
import el from "./el.json";
import en from "./en.json";

export type MessageKey = keyof typeof en;
export type Vars = Record<string, string | number>;

const DICTS: Record<Lang, Record<MessageKey, string>> = { el, en };
const LOCALES: Record<Lang, string> = { el: "el-GR", en: "en-GB" };
export const DEFAULT_LANG: Lang = "el";
const STORAGE_KEY = "guardian.lang";

export function format(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

export function makeI18n(lang: Lang) {
  const dict = DICTS[lang];
  const locale = LOCALES[lang];
  const plural = new Intl.PluralRules(locale);
  const numberFormat = (digits: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits });

  const t = (key: MessageKey, vars?: Vars) => format(dict[key] ?? en[key] ?? key, vars);
  const number = (n: number, digits = 1) => numberFormat(digits).format(n);
  /** Counted noun, e.g. tn("unit.coins", 1) -> "1 coin" / "1 νόμισμα". */
  const tn = (base: "unit.coins" | "unit.points", n: number) =>
    format(dict[`${base}.${plural.select(n) === "one" ? "one" : "other"}` as MessageKey], { n: number(n) });
  /** Pick this language from a bilingual data field. */
  const pick = (text: Text | null | undefined) => (text ? text[lang] || text.en : "");
  const list = (items: string[], type: "conjunction" | "disjunction" = "conjunction") =>
    new Intl.ListFormat(locale, { style: "long", type }).format(items);
  /** Date part of an ARGUS timestamp ("2026-09-10T20:30:00", no zone) as "10 September 2026". */
  const date = (iso: string) => {
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  };
  return { lang, locale, t, tn, number, pick, list, date };
}

export type I18n = ReturnType<typeof makeI18n>;

interface LangContextValue extends I18n {
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue | null>(null);

function savedLang(): Lang {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === "el" || value === "en") return value;
  } catch {
    // storage blocked: use the default
  }
  return DEFAULT_LANG;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(savedLang);
  const value = useMemo(() => ({ ...makeI18n(lang), setLang: setLangState }), [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // not persisted, still works for this visit
    }
  }, [lang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useI18n(): LangContextValue {
  const value = useContext(LangContext);
  if (!value) throw new Error("useI18n outside LangProvider");
  return value;
}
