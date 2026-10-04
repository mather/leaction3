import { useParams } from "@solidjs/router";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { GetEventResponse } from "../../shared/api";
import type { Comment, ErrorCode, TalkId } from "../../shared/protocol";
import { commentLength, DEFAULT_LIMITS } from "../../shared/schema";
import button from "../components/button.module.css";
import { CommentBody } from "../components/CommentBody";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { UrlField } from "../components/UrlField";
import { ApiError, ensureSession, getEvent } from "../lib/api";
import { loadLastViewedTalk, saveLastViewedTalk } from "../lib/last-talk";
import { createRoom, type RoomError } from "../lib/room";
import { commentPlaceholder, pickInitialTalk, talkLabel } from "../lib/talks";
import { eventUrl } from "../lib/urls";
import styles from "./EventPage.module.css";

export function EventPage() {
  const params = useParams<{ id: string }>();
  const [data, { refetch }] = createResource(() => params.id, getEvent);

  return (
    <Switch fallback={<p class={styles.status}>読み込み中…</p>}>
      <Match when={data.state === "errored"}>
        <div class={styles.status}>
          <Show
            when={data.error instanceof ApiError && data.error.status === 404}
            fallback={
              <>
                <p>読み込めませんでした。通信状況を確認してください。</p>
                <button type="button" class={button.secondary} onClick={() => refetch()}>
                  再読み込み
                </button>
              </>
            }
          >
            <p>イベントが見つかりません。URL を確認してください。</p>
          </Show>
        </div>
      </Match>
      <Match when={data.state === "ready" && data()}>{(d) => <EventView data={d()} />}</Match>
    </Switch>
  );
}

type SheetName = "talks" | "share" | "menu" | "link" | "delete";

/** 最下部からこの距離以内なら「最下部を見ている」とみなす */
const BOTTOM_THRESHOLD_PX = 32;
/** 送信エラーの表示時間 */
const NOTICE_MS = 5000;
/** 残りがこの文字数を切ったら文字数を表示する */
const COUNTER_FROM = 50;

const ERROR_MESSAGES: Record<ErrorCode, string> = {
  rate_limited: "少し待ってから送信してください",
  comments_closed: "コメントの受付は停止中です",
  not_found: "発表が見つかりません。ページを再読み込みしてください",
  invalid_message: "送信できませんでした",
};

const timeFormat = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" });

function EventView(props: { data: GetEventResponse }) {
  // 開いたときに参加者 Cookie を用意する（必要なときだけ Turnstile を 1 回通す）
  const [session, { refetch: retrySession }] = createResource(ensureSession);

  const [notice, setNotice] = createSignal<string>();
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const showNotice = (message: string) => {
    clearTimeout(noticeTimer);
    setNotice(message);
    noticeTimer = setTimeout(() => setNotice(undefined), NOTICE_MS);
  };
  onCleanup(() => clearTimeout(noticeTimer));

  const [draft, setDraft] = createSignal("");

  const room = createRoom(
    props.data.event.id,
    () => session.state === "ready",
    (error: RoomError) => {
      if (error.commentId !== undefined) {
        // いいね・削除の失敗。コメントがもう消えていれば、その知らせが届いて画面から消える
        if (error.code !== "not_found") showNotice("操作できませんでした");
        return;
      }
      showNotice(ERROR_MESSAGES[error.code]);
      // 送れなかった本文は捨てず、入力欄に戻す
      const body = error.pending?.body;
      if (body) setDraft((d) => (d === "" ? body : `${body}\n${d}`));
    },
  );

  // 接続後は snapshot と差分の内容を使う（管理者の変更が反映される）
  const event = () => room.state().event ?? props.data.event;
  const talks = () => room.state().talks ?? props.data.talks;
  const loaded = () => room.state().seq !== null;

  const [talkId, setTalkId] = createSignal<TalkId | undefined>(
    pickInitialTalk(props.data.talks, {
      tid: new URLSearchParams(location.search).get("tid"),
      lastViewed: loadLastViewedTalk(props.data.event.id),
    }),
  );
  const index = () => talks().findIndex((t) => t.id === talkId());
  const talk = () => talks()[index()];

  // 選んだ発表を ?tid= に反映する。ルーターの遷移にせず履歴も積まない
  createEffect(() => {
    const id = talkId();
    if (!id) return;
    const url = new URL(location.href);
    if (url.searchParams.get("tid") !== id) {
      url.searchParams.set("tid", id);
      history.replaceState(history.state, "", url);
    }
    saveLastViewedTalk(event().id, id);
  });

  const [sheet, setSheet] = createSignal<SheetName>();
  const closeSheet = () => setSheet(undefined);
  const [linkUrl, setLinkUrl] = createSignal("");
  const confirmUrl = (url: string) => {
    setLinkUrl(url);
    setSheet("link");
  };

  // いいね・削除は接続中だけ受け付ける（切れている間の操作は送られずに消えてしまうため）
  const connected = () => room.status() === "open" && loaded();
  const [deleteTarget, setDeleteTarget] = createSignal<Comment>();
  const confirmDelete = (c: Comment) => {
    setDeleteTarget(c);
    setSheet("delete");
  };
  const deleteComment = () => {
    const c = deleteTarget();
    if (!c) return;
    if (!room.remove(c.id)) showNotice("接続が切れています。再接続してからもう一度お試しください");
    closeSheet();
  };
  // 削除の確認中に、そのコメントが非表示などで消えたら確認を閉じる
  createEffect(() => {
    const c = deleteTarget();
    if (sheet() === "delete" && c && !room.state().comments.some((x) => x.id === c.id)) {
      closeSheet();
    }
  });

  const move = (delta: number) => {
    const next = talks()[index() + delta];
    if (next) setTalkId(next.id);
  };

  // 全発表分のコメントを受け取り、表示する発表だけをここで絞り込む
  const comments = createMemo(() => room.state().comments.filter((c) => c.talkId === talkId()));
  const pending = createMemo(() => room.state().pending.filter((p) => p.talkId === talkId()));
  const counts = createMemo(() => {
    const map = new Map<TalkId, number>();
    for (const c of room.state().comments) map.set(c.talkId, (map.get(c.talkId) ?? 0) + 1);
    return map;
  });

  // 自動スクロール: 最下部を見ているときだけ新着に追従し、それ以外は新着ピルで知らせる
  let list: HTMLElement | undefined;
  const [atBottom, setAtBottom] = createSignal(true);
  const [unread, setUnread] = createSignal(0);
  const scrollToBottom = () => {
    if (list) list.scrollTop = list.scrollHeight;
    setAtBottom(true);
    setUnread(0);
  };
  const onScroll = () => {
    if (!list) return;
    const bottom = list.scrollHeight - list.scrollTop - list.clientHeight <= BOTTOM_THRESHOLD_PX;
    setAtBottom(bottom);
    if (bottom) setUnread(0);
  };
  createEffect(
    on([talkId, comments], ([id, current], prev) => {
      // 発表を切り替えたとき・最初の表示では最下部（最新）から見せる
      if (!prev || prev[0] !== id) return scrollToBottom();
      const seen = new Set(prev[1].map((c) => c.id));
      const added = current.filter((c) => !seen.has(c.id));
      if (added.length === 0) return;
      if (atBottom() || added.some((c) => c.mine)) return scrollToBottom();
      setUnread((n) => n + added.length);
    }),
  );
  // 自分が送ったときは、どこを見ていても最下部へ
  createEffect(
    on(
      () => pending().length,
      (n, prev) => {
        if (prev !== undefined && n > prev) scrollToBottom();
      },
    ),
  );

  const length = () => commentLength(draft().trim());
  const overLimit = () => length() > DEFAULT_LIMITS.commentMaxLength;
  const canSend = () =>
    session.state === "ready" && talk() !== undefined && length() > 0 && !overLimit();
  const submit = () => {
    const t = talk();
    if (!t || !canSend()) return;
    room.post(t.id, draft().trim());
    setDraft("");
  };
  const placeholder = () => {
    const t = talk();
    return t ? commentPlaceholder(t) : "コメント";
  };

  return (
    <div class={styles.page}>
      <header class={styles.header}>
        {/* ロゴとイベント名はリンクにしない（誤タップでページを離れないため） */}
        <span class={styles.logo}>LeacTion!</span>
        <h1 class={styles.eventName}>{event().name}</h1>
        <button
          type="button"
          class={styles.iconButton}
          aria-label="共有"
          onClick={() => setSheet("share")}
        >
          <Icon name="share" />
        </button>
        <button
          type="button"
          class={styles.iconButton}
          aria-label="メニュー"
          onClick={() => setSheet("menu")}
        >
          <Icon name="menu" />
        </button>
      </header>

      <Show when={talk()}>
        {(t) => (
          <nav class={styles.talkBar} aria-label="発表の切り替え">
            <button
              type="button"
              class={styles.iconButton}
              aria-label="前の発表"
              disabled={index() <= 0}
              onClick={() => move(-1)}
            >
              <Icon name="chevronLeft" />
            </button>
            <button
              type="button"
              class={styles.talkCurrent}
              aria-haspopup="dialog"
              onClick={() => setSheet("talks")}
            >
              <span class={styles.talkPosition}>
                {index() + 1}/{talks().length}
              </span>
              <span class={styles.talkLabel}>{talkLabel(t())}</span>
            </button>
            <button
              type="button"
              class={styles.iconButton}
              aria-label="次の発表"
              disabled={index() >= talks().length - 1}
              onClick={() => move(1)}
            >
              <Icon name="chevron" />
            </button>
          </nav>
        )}
      </Show>

      <div class={styles.commentsArea}>
        <main ref={list} class={styles.comments} onScroll={onScroll}>
          <Show
            when={comments().length > 0 || pending().length > 0}
            fallback={
              <Show
                when={loaded()}
                fallback={<p class={styles.empty}>コメントを読み込んでいます…</p>}
              >
                <p class={styles.empty}>
                  まだコメントはありません。
                  <br />
                  最初のひとことをどうぞ。ログインは不要です。
                </p>
              </Show>
            }
          >
            <ol class={styles.commentList}>
              <For each={comments()}>
                {(c) => (
                  <CommentCard
                    comment={c}
                    connected={connected()}
                    onOpenUrl={confirmUrl}
                    onLike={(liked) => room.like(c.id, liked)}
                    onDelete={() => confirmDelete(c)}
                  />
                )}
              </For>
              <For each={pending()}>
                {(p) => (
                  <li class={styles.card} data-pending>
                    <div class={styles.cardMain}>
                      <p class={styles.body}>{p.body}</p>
                      <p class={styles.meta}>
                        <span class={styles.mine}>あなた</span>
                        <span>送信中…</span>
                      </p>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>
        </main>
        <Show when={unread() > 0 && !atBottom()}>
          <button type="button" class={styles.newPill} onClick={scrollToBottom}>
            新着コメント {unread()} 件
            <Icon name="arrowDown" size={16} />
          </button>
        </Show>
      </div>

      <Show
        when={event().commentsOpen}
        fallback={<p class={styles.closed}>コメントの受付は停止中です</p>}
      >
        <Show when={session.error}>
          <div class={styles.sessionError} role="alert">
            <span>参加の確認に失敗しました。</span>
            <button type="button" class={button.secondary} onClick={() => retrySession()}>
              再試行
            </button>
          </div>
        </Show>
        <Show when={session.state === "ready" && room.status() === "reconnecting"}>
          <p class={styles.connection} role="status">
            接続が切れました。再接続しています…
          </p>
        </Show>
        <Show when={notice()}>
          <p class={styles.notice} role="alert">
            {notice()}
          </p>
        </Show>
        <form
          class={styles.composer}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            class={styles.input}
            rows={1}
            aria-label="コメント"
            placeholder={placeholder()}
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              // Enter だけなら改行。Shift・⌘・Ctrl と一緒なら送信（変換確定の Enter は除く）
              if (e.key !== "Enter" || e.isComposing) return;
              if (!(e.shiftKey || e.metaKey || e.ctrlKey)) return;
              e.preventDefault();
              submit();
            }}
          />
          <Show when={DEFAULT_LIMITS.commentMaxLength - length() < COUNTER_FROM}>
            <span class={styles.counter} data-over={overLimit() ? "" : undefined}>
              {length()}/{DEFAULT_LIMITS.commentMaxLength}
            </span>
          </Show>
          <button type="submit" class={styles.send} aria-label="送信" disabled={!canSend()}>
            <Icon name="send" />
          </button>
        </form>
      </Show>

      <Sheet open={sheet() === "talks"} onClose={closeSheet} title="発表一覧">
        <ol class={styles.talkList}>
          <For each={talks()}>
            {(t, i) => (
              <li>
                <button
                  type="button"
                  class={styles.talkItem}
                  aria-current={t.id === talkId() ? "true" : undefined}
                  onClick={() => {
                    setTalkId(t.id);
                    closeSheet();
                  }}
                >
                  <span class={styles.talkNumber}>{i() + 1}</span>
                  <span class={styles.talkItemText}>
                    <Show when={t.speaker !== ""}>
                      <span class={styles.talkSpeaker}>{t.speaker}</span>
                    </Show>
                    <Show when={t.title !== ""}>
                      <span class={styles.talkTitle}>{t.title}</span>
                    </Show>
                  </span>
                  <Show when={loaded()}>
                    <span class={styles.talkCount}>
                      <Icon name="comment" size={16} />
                      {counts().get(t.id) ?? 0}
                    </span>
                  </Show>
                </button>
              </li>
            )}
          </For>
        </ol>
      </Sheet>

      <Sheet open={sheet() === "share"} onClose={closeSheet} title="このイベントを共有">
        <UrlField label="イベントページの URL" url={eventUrl(event().id)} />
      </Sheet>

      <Sheet open={sheet() === "menu"} onClose={closeSheet} title="メニュー">
        {/* 外へ出る導線は新しいタブで開き、イベントページを残す */}
        <a class={styles.menuItem} href="/" target="_blank" rel="noopener">
          LeacTion! について・イベントを作る
          <Icon name="external" />
        </a>
      </Sheet>

      <Sheet open={sheet() === "delete"} onClose={closeSheet} title="このコメントを削除しますか？">
        <p class={styles.deletePreview}>{deleteTarget()?.body}</p>
        <p class={styles.deleteNote}>削除すると元に戻せません。いいねも消えます。</p>
        <div class={styles.linkActions}>
          <button type="button" class={button.secondary} onClick={closeSheet}>
            キャンセル
          </button>
          <button
            type="button"
            class={button.danger}
            disabled={!connected()}
            onClick={deleteComment}
          >
            削除する
          </button>
        </div>
      </Sheet>

      <Sheet open={sheet() === "link"} onClose={closeSheet} title="この URL を開こうとしています">
        <p class={styles.linkUrl}>{linkUrl()}</p>
        <div class={styles.linkActions}>
          <button type="button" class={button.secondary} onClick={closeSheet}>
            キャンセル
          </button>
          {/* 新しいタブで開き、イベントページを残す */}
          <a
            class={button.primary}
            href={linkUrl()}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeSheet}
          >
            開く
            <Icon name="external" size={16} />
          </a>
        </div>
      </Sheet>
    </div>
  );
}

function CommentCard(props: {
  comment: Comment;
  /** 接続中か。切れている間はいいね・削除を押せなくする */
  connected: boolean;
  onOpenUrl: (url: string) => void;
  onLike: (liked: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <li class={styles.card}>
      <div class={styles.cardMain}>
        <p class={styles.body}>
          <CommentBody body={props.comment.body} onOpenUrl={props.onOpenUrl} />
        </p>
        <p class={styles.meta}>
          <Show when={props.comment.mine}>
            <span class={styles.mine}>あなた</span>
          </Show>
          <time dateTime={new Date(props.comment.createdAt).toISOString()}>
            {timeFormat.format(props.comment.createdAt)}
          </time>
          <Show when={props.comment.mine}>
            <button
              type="button"
              class={styles.deleteButton}
              disabled={!props.connected}
              onClick={() => props.onDelete()}
            >
              <Icon name="trash" size={14} />
              削除
            </button>
          </Show>
        </p>
      </div>
      {/* 自分のコメントにはいいねできない（サーバーでも拒否する） */}
      <button
        type="button"
        class={styles.likeButton}
        aria-label={props.comment.mine ? "自分のコメントにはいいねできません" : "いいね"}
        aria-pressed={props.comment.likedByMe}
        data-liked={props.comment.likedByMe ? "" : undefined}
        disabled={props.comment.mine || !props.connected}
        onClick={() => props.onLike(!props.comment.likedByMe)}
      >
        <Icon name="heart" size={18} filled={props.comment.likedByMe} />
        <span class={styles.likeCount}>{props.comment.likes}</span>
      </button>
    </li>
  );
}
