import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";
import { type CommentId, type ErrorCode, type TalkId, WS_SINCE_PARAM } from "../../shared/protocol";
import { ensureSession } from "./api";
import {
  addPending,
  applyServerMessage,
  hasGap,
  initialRoomState,
  type PendingComment,
  type RoomState,
} from "./room-state";
import { RoomSocket, type SocketStatus } from "./ws";

/** pending は失敗した投稿、commentId は失敗したいいね・削除の対象 */
export type RoomError = { code: ErrorCode; pending?: PendingComment; commentId?: CommentId };

function wsUrl(eventId: string, seq: number | null): string {
  const url = new URL(`/api/events/${encodeURIComponent(eventId)}/ws`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (seq !== null) url.searchParams.set(WS_SINCE_PARAM, String(seq));
  return url.href;
}

/**
 * イベントの WebSocket 接続と、そこから組み立てた状態。
 * ready が true になったら（参加者 Cookie を用意できたら）接続する。
 */
export function createRoom(
  eventId: string,
  ready: Accessor<boolean>,
  onError: (error: RoomError) => void,
) {
  const [state, setState] = createSignal<RoomState>(initialRoomState);
  const [status, setStatus] = createSignal<SocketStatus>("connecting");

  const socket = new RoomSocket({
    url: () => wsUrl(eventId, state().seq),
    onStatus: setStatus,
    onMessage: (message) => {
      const current = state();
      if (hasGap(current, message)) {
        // 取りこぼしがある。いまの seq から補完し直す
        socket.reconnect();
        return;
      }
      if (message.type === "error") {
        const pending = current.pending.find((p) => p.clientId === message.clientId);
        onError({ code: message.code, pending, commentId: message.commentId });
      }
      setState(applyServerMessage(current, message));
    },
    // 受け付けの知らせがないまま切れた投稿を送り直す。
    // 接続直後の snapshot・差分より後に届くので、登録済みのものはサーバーが二重に登録しない
    onOpen: () => {
      for (const p of state().pending) socket.send({ type: "comment.post", ...p });
    },
    beforeReconnect: ensureSession,
  });

  createEffect(() => {
    if (ready()) socket.start();
  });
  onCleanup(() => socket.stop());

  const post = (talkId: TalkId, body: string) => {
    const pending: PendingComment = { clientId: crypto.randomUUID(), talkId, body };
    setState((s) => addPending(s, pending));
    // つながっていなければ、再接続したときに onOpen で送る
    socket.send({ type: "comment.post", ...pending });
  };

  // いいね・削除は配信を待って画面に反映する。つながっていなければ送らずに false
  const like = (commentId: CommentId, liked: boolean) =>
    socket.send({ type: "like.set", commentId, liked });
  const remove = (commentId: CommentId) => socket.send({ type: "comment.delete", commentId });

  return { state, status, post, like, remove };
}
