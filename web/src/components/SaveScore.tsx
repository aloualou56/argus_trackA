// "Save your score" on the score screen: the player's name and a password (anything, even empty). A
// new name makes an account, a known one with its password signs in, and the score goes on the
// leaderboard under it (community/account.ts). The device remembers who signed in, so the next game
// is one press ("Save as Maria"), or "Another player". Without saving, the game is kept without a
// name (App.tsx), for the class's statistics only.
import { useId, useState, type FormEvent } from "react";
import { signIn } from "../community/account";
import { loadAccount, saveAccount, userName, USERNAME_MAX } from "../community/nickname";
import type { CommunityStore, PlayRecord } from "../community/store";
import { useI18n, type MessageKey } from "../i18n";
import { Icon } from "./Icon";

interface Props {
  community: CommunityStore;
  /** This game's record, without a name. */
  record: PlayRecord;
  /** The account this game was saved under already (coming back to the score screen), or null. */
  savedAs: string | null;
  onSaved: (nick: string) => void;
}

type Note = { key: "created" | "welcome" | "taken" | "failed" | "bad"; name?: string } | null;

export function SaveScore({ community, record, savedAs, onSaved }: Props) {
  const { t } = useI18n();
  const id = useId();
  const [account, setAccount] = useState(loadAccount);
  const [typing, setTyping] = useState(account === null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const store = async (nick: string) => {
    await community.submit({ ...record, nick });
    saveAccount(nick);
    setAccount(nick);
    onSaved(nick);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = signIn(await community.plays(), name, password);
      if (result.kind === "bad") setNote({ key: "bad" });
      else if (result.kind === "taken") setNote({ key: "taken", name: result.name });
      else {
        await store(result.nick);
        setPassword("");
        setNote({ key: result.kind === "new" ? "created" : "welcome", name: result.name });
      }
    } catch {
      setNote({ key: "failed" });
    } finally {
      setBusy(false);
    }
  };

  const saveAsAccount = async () => {
    if (busy || !account) return;
    setBusy(true);
    setNote(null);
    try {
      await store(account);
      setNote({ key: "welcome", name: userName(account) ?? "" });
    } catch {
      setNote({ key: "failed" });
    } finally {
      setBusy(false);
    }
  };

  const saved = savedAs ? userName(savedAs) : null;
  const message = note && t(`save.${note.key}` as MessageKey, { name: note.name ?? "", max: USERNAME_MAX });

  return (
    <section className="panel save-score" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("save.title")}</h2>
      {saved !== null ? (
        <p className="save-done" role="status">
          <Icon name="check" size={20} />
          {message ?? t("save.done", { name: saved })}
        </p>
      ) : (
        <>
          <p>{t("save.lead")}</p>
          {!typing && account ? (
            <div className="actions">
              <button type="button" className="btn btn-primary" onClick={saveAsAccount} aria-disabled={busy || undefined}>
                {t("save.as", { name: userName(account) ?? "" })}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  saveAccount(null);
                  setAccount(null);
                  setTyping(true);
                  setNote(null);
                }}
              >
                {t("save.other")}
              </button>
            </div>
          ) : (
            <form className="save-score-form" onSubmit={submit} noValidate>
              <label className="field-label" htmlFor={`${id}-name`}>
                {t("save.name")}
              </label>
              <input
                id={`${id}-name`}
                className="field"
                type="text"
                value={name}
                maxLength={USERNAME_MAX + 10}
                autoComplete="off"
                spellCheck={false}
                aria-invalid={note?.key === "bad" || note?.key === "taken" || undefined}
                aria-describedby={`${id}-help`}
                onChange={(e) => {
                  setName(e.target.value);
                  setNote(null);
                }}
              />
              <label className="field-label" htmlFor={`${id}-password`}>
                {t("save.password")}
              </label>
              <input
                id={`${id}-password`}
                className="field"
                type="password"
                value={password}
                autoComplete="off"
                aria-describedby={`${id}-help`}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (note?.key === "taken") setNote(null);
                }}
              />
              <p className="small" id={`${id}-help`}>
                {t("save.help")}
              </p>
              <button type="submit" className="btn btn-primary" aria-disabled={busy || undefined}>
                {busy ? t("save.checking") : t("save.button")}
              </button>
            </form>
          )}
          <p className={note && note.key !== "created" && note.key !== "welcome" ? "field-error" : "small"} role="status">
            {message}
          </p>
        </>
      )}
    </section>
  );
}
