import type { TalkId } from "../../shared/protocol";

// 前回見ていた発表は端末内（localStorage）にイベントごとに保存する。
// プライベートブラウズなどで使えないときは保存しない。
const lastViewedKey = (eventId: string) => `leaction:lastTalk:${eventId}`;

export function loadLastViewedTalk(eventId: string): string | null {
  try {
    return localStorage.getItem(lastViewedKey(eventId));
  } catch {
    return null;
  }
}

export function saveLastViewedTalk(eventId: string, talkId: TalkId): void {
  try {
    localStorage.setItem(lastViewedKey(eventId), talkId);
  } catch {
    // 保存できなくても困らない
  }
}
