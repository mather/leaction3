import { type Accessor, createEffect, createMemo, createSignal } from "solid-js";
import {
  type CommentId,
  type ErrorCode,
  type ReactionKind,
  type TalkId,
  WS_SINCE_PARAM,
} from "../../shared/protocol";
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

/** pending は失敗した投稿、commentId は失敗したいいね・削除の対象、talkId は失敗した感想の対象 */
export type RoomError = {
  code: ErrorCode;
  pending?: PendingComment;
  commentId?: CommentId;
  talkId?: TalkId;
};

function wsUrl(eventId: string, seq: number | null): string {
  const url = new URL(`/api/rooms/${encodeURIComponent(eventId)}/ws`, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (seq !== null) url.searchParams.set(WS_SINCE_PARAM, String(seq));
  return url.href;
}

/**
 * イベントの WebSocket 接続と、そこから組み立てた状態。
 * ready が true になったら（参加者 Cookie を用意できたら）接続する。
 */
export function createRoom(
  eventId: Accessor<string>,
  ready: Accessor<boolean>,
  onError: (error: RoomError) => void,
) {
  const [state, setStateSignal] = createSignal<RoomState>(initialRoomState);
  // 書き込んだ値は次の反映まで state() に出ないので、ソケットの処理は手元の最新値を使う
  let latest = initialRoomState;
  const setState = (next: RoomState) => {
    latest = next;
    setStateSignal(next);
  };
  const [status, setStatus] = createSignal<SocketStatus>("connecting");
  /** イベントが削除され、サーバーが接続を閉じた */
  const [gone, setGone] = createSignal(false);

  const socket = new RoomSocket({
    url: () => wsUrl(eventId(), latest.seq),
    onStatus: setStatus,
    onMessage: (message) => {
      const current = latest;
      if (hasGap(current, message)) {
        // 取りこぼしがある。いまの seq から補完し直す
        socket.reconnect();
        return;
      }
      if (message.type === "error") {
        const pending = current.pending.find((p) => p.clientId === message.clientId);
        onError({
          code: message.code,
          pending,
          commentId: message.commentId,
          talkId: message.talkId,
        });
      }
      setState(applyServerMessage(current, message));
    },
    // 受け付けの知らせがないまま切れた投稿を送り直す。
    // 接続直後の snapshot・差分より後に届くので、登録済みのものはサーバーが二重に登録しない
    onOpen: () => {
      for (const p of latest.pending) socket.send({ type: "comment.post", ...p });
    },
    beforeReconnect: ensureSession,
    onGone: () => setGone(true),
  });

  const isReady = createMemo(ready);
  createEffect(isReady, (r) => {
    if (!r) return;
    socket.start();
    return () => socket.stop();
  });

  const post = (talkId: TalkId, body: string) => {
    const pending: PendingComment = { clientId: crypto.randomUUID(), talkId, body };
    setState(addPending(latest, pending));
    // つながっていなければ、再接続したときに onOpen で送る
    socket.send({ type: "comment.post", ...pending });
  };

  // いいね・削除・感想は配信を待って画面に反映する。つながっていなければ送らずに false
  const like = (commentId: CommentId, liked: boolean) =>
    socket.send({ type: "like.set", commentId, liked });
  const remove = (commentId: CommentId) => socket.send({ type: "comment.delete", commentId });
  const react = (talkId: TalkId, kind: ReactionKind | null) =>
    socket.send({ type: "reaction.set", talkId, kind });

  return { state, status, gone, post, like, remove, react };
}
