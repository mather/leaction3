import { useParams } from "@solidjs/router";
import { createEffect, createResource, createSignal, For, Match, Show, Switch } from "solid-js";
import type { GetEventResponse } from "../../shared/api";
import type { TalkId } from "../../shared/protocol";
import button from "../components/button.module.css";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { UrlField } from "../components/UrlField";
import { ApiError, getEvent } from "../lib/api";
import { loadLastViewedTalk, saveLastViewedTalk } from "../lib/last-talk";
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

type SheetName = "talks" | "share" | "menu";

function EventView(props: { data: GetEventResponse }) {
  const event = () => props.data.event;
  const talks = () => props.data.talks;

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

  const move = (delta: number) => {
    const next = talks()[index() + delta];
    if (next) setTalkId(next.id);
  };

  // コメントの送信は WebSocket（MVP ステップ 5）で行う
  const connected = () => false;
  const [draft, setDraft] = createSignal("");
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

      <main class={styles.comments}>
        <p class={styles.empty}>
          まだコメントはありません。
          <br />
          最初のひとことをどうぞ。ログインは不要です。
        </p>
      </main>

      <Show
        when={event().commentsOpen}
        fallback={<p class={styles.closed}>コメントの受付は停止中です</p>}
      >
        <form class={styles.composer} onSubmit={(e) => e.preventDefault()}>
          <textarea
            class={styles.input}
            rows={1}
            aria-label="コメント"
            placeholder={placeholder()}
            value={draft()}
            onInput={(e) => setDraft(e.currentTarget.value)}
          />
          <button
            type="submit"
            class={styles.send}
            aria-label="送信"
            disabled={!connected() || draft().trim() === ""}
          >
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
    </div>
  );
}
