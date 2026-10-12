import { isLang, LANGS, useI18n } from "../i18n";
import { Dropdown } from "./Dropdown";
import { Icon } from "./Icon";

/** The language menu in the top band: each language under its own name. */
export function LangMenu() {
  const { t, lang, setLang } = useI18n();
  return (
    <Dropdown
      id="lang"
      className="lang-menu"
      label={t("lang.label")}
      icon={<Icon name="globe" size={20} />}
      options={LANGS.map((l) => ({ id: l.id, name: l.name, lang: l.id }))}
      value={lang}
      // The new screen language is announced by the page heading taking focus (see App).
      onChange={(id) => isLang(id) && setLang(id)}
    />
  );
}
