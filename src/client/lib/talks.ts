import type { Talk, TalkId } from "../../shared/protocol";

/**
 * 最初に見る発表を決める（docs/requirements.md「機能要件」）。
 * `?tid=` → （発表中: 未導入）→ 前回見ていた発表 → 1 番目。存在しない ID は飛ばす。
 */
export function pickInitialTalk(
  talks: readonly Talk[],
  candidates: { tid?: string | null; lastViewed?: string | null },
): TalkId | undefined {
  const exists = (id: string | null | undefined): id is string =>
    id != null && talks.some((t) => t.id === id);
  if (exists(candidates.tid)) return candidates.tid;
  if (exists(candidates.lastViewed)) return candidates.lastViewed;
  return talks[0]?.id;
}

/** 発表の見出し。「発表者／タイトル」で、どちらかが空ならもう一方だけ */
export function talkLabel(talk: Talk): string {
  return [talk.speaker, talk.title].filter((s) => s !== "").join("／");
}

/** 入力欄のプレースホルダ。どの発表に書き込むかを示す */
export function commentPlaceholder(talk: Talk): string {
  if (talk.speaker !== "") return `${talk.speaker}さんの発表にコメント`;
  return `「${talk.title}」にコメント`;
}
