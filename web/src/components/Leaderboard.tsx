// The leaderboard at the end of a mission: each player once, with their best score, on this mission
// or on all of them. The class's when there is a class code, everyone's in the shared store, else
// everyone who played on this device. A player is a guardian name (an animal and a number) or a name
// they chose (community/nickname.ts); nothing else of them is kept.
import { useEffect, useState } from "react";
import { leaderboard, standing, type BoardRow } from "../community/leaderboard";
import { playerKey } from "../community/nickname";
import type { CommunityStore, PlayRecord } from "../community/store";
import { useI18n } from "../i18n";
import { useNickLabel } from "./GuardianName";

interface Props {
  community: CommunityStore;
  monument: string;
  level: string;
  classCode: string | null;
  nick: string;
  /** This game's score, and whether it has been stored yet (the board is read once it has). */
  score: number;
  ready: boolean;
}

const SHOWN = 10;
const MEDALS = ["🥇", "🥈", "🥉"];

export function Leaderboard({ community, monument, level, classCode, nick, score, ready }: Props) {
  const { t, number } = useI18n();
  const label = useNickLabel();
  const [records, setRecords] = useState<PlayRecord[] | null>(null);
  const [scope, setScope] = useState<"mission" | "all">("mission");
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    community
      .plays(classCode ? { classCode } : {})
      .then((r) => alive && setRecords(r))
      .catch(() => alive && setRecords([]));
    return () => {
      alive = false;
    };
  }, [community, classCode, ready]);

  const rows = records ? leaderboard(records, scope === "mission" ? { monument, level } : {}) : [];
  const me = standing(rows, nick);
  const isMe = (other: string | undefined) => !!other && playerKey(other) === playerKey(nick);
  const mine = rows.find((r) => isMe(r.nick));
  // A new best: this game's score is the best, reached in this game only (and it is not the first game).
  const myMission = records?.filter((r) => isMe(r.nick) && r.monument === monument && r.level === level) ?? [];
  const newBest = scope === "mission" && myMission.length > 1 && myMission.filter((r) => r.score >= score).length === 1;
  const where = classCode ? t("board.scopeClass", { code: classCode }) : community.kind === "shared" ? t("board.scopeAll") : t("board.scopeDevice");
  const row = (r: BoardRow, rank: number) => (
    <li key={playerKey(r.nick)} className={isMe(r.nick) ? "is-me" : undefined}>
      <span className="board-rank">{MEDALS[rank - 1] ?? rank}</span>
      <span className="board-name">
        {label(r.nick)}
        {isMe(r.nick) && <strong> ({t("board.you")})</strong>}
      </span>
      <span className="board-score">{number(r.score, 0)}</span>
    </li>
  );
  const rankOf = (r: BoardRow) => rows.findIndex((x) => x.score === r.score) + 1;

  return (
    <section className="panel leaderboard" aria-labelledby="board-title">
      <h2 id="board-title">{t("board.title")}</h2>
      <p className="small">{where}</p>
      <div className="board-tabs" role="group" aria-label={t("board.title")}>
        <button type="button" aria-pressed={scope === "mission"} onClick={() => setScope("mission")}>
          {t("board.mission")}
        </button>
        <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>
          {t("board.all")}
        </button>
      </div>
      {!records ? (
        <p className="small">{t("app.loading")}</p>
      ) : rows.length === 0 ? (
        <p>{t("board.empty")}</p>
      ) : (
        <>
          <ol className="board-list">
            {rows.slice(0, SHOWN).map((r) => row(r, rankOf(r)))}
            {mine && me.rank !== null && rows.indexOf(mine) >= SHOWN && (
              <>
                <li className="board-gap" aria-hidden="true">
                  …
                </li>
                {row(mine, me.rank)}
              </>
            )}
          </ol>
          <p className="board-standing" aria-live="polite">
            {newBest && <strong>{t("board.best")} </strong>}
            {me.rank !== null && t("board.rank", { rank: me.rank, players: me.players })}{" "}
            {me.rank === 1 ? t("board.first") : me.next && t("board.next", { points: me.next.points, name: label(me.next.row.nick) })}
          </p>
        </>
      )}
    </section>
  );
}
