import { A, useParams } from "@solidjs/router";
import { createResource, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { AdminRole, GetAdminResponse, UpdateEventRequest } from "../../shared/api";
import type { EventInfo, Talk, TalkId } from "../../shared/protocol";
import { DEFAULT_LIMITS, isValidTalk } from "../../shared/schema";
import button from "../components/button.module.css";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import {
  ApiError,
  addTalk,
  createAdminSession,
  deleteTalk,
  getAdmin,
  reorderTalks,
  updateEvent,
  updateTalk,
} from "../lib/api";
import { talkLabel } from "../lib/talks";
import styles from "./Manage.module.css";

/**
 * 管理 URL の `#k=` からトークンを取り出し、アドレスバーからすぐに消す
 * （画面共有やスクリーンショットで漏れないように）。なければ null
 */
function takeTokenFromHash(): string | null {
  const token = new URLSearchParams(location.hash.slice(1)).get("k");
  if (location.hash !== "") {
    history.replaceState(history.state, "", location.pathname + location.search);
  }
  return token;
}

/** トークンを管理セッション Cookie に入れ替えてから、管理画面の内容を読み込む */
async function loadAdmin(id: string, token: string | null): Promise<GetAdminResponse> {
  if (token) await createAdminSession(id, token);
  return getAdmin(id);
}

export function Manage() {
  const params = useParams<{ id: string }>();
  // 入れ替えに成功するまではトークンを手元に残し、再試行に使う
  let token = takeTokenFromHash();
  const [data, { refetch }] = createResource(
    () => params.id,
    async (id) => {
      const result = await loadAdmin(id, token);
      token = null;
      return result;
    },
  );

  const errorMessage = () => {
    const err = data.error;
    if (!(err instanceof ApiError)) return null;
    if (err.code === "invalid_token") return "この管理用 URL は正しくないか、無効になっています。";
    if (err.status === 401) {
      return "管理画面を開くには、イベント作成時に表示された管理用 URL からアクセスしてください。";
    }
    if (err.status === 404) return "イベントが見つかりません。URL を確認してください。";
    return null;
  };

  return (
    <Switch fallback={<p class={styles.status}>読み込み中…</p>}>
      <Match when={data.state === "errored"}>
        <div class={styles.status}>
          <Show
            when={errorMessage()}
            fallback={
              <>
                <p>読み込めませんでした。通信状況を確認してください。</p>
                <button type="button" class={button.secondary} onClick={() => refetch()}>
                  再読み込み
                </button>
              </>
            }
          >
            {(message) => <p>{message()}</p>}
          </Show>
        </div>
      </Match>
      <Match when={data.state === "ready" && data()}>
        {(d) => <ManageView data={d()} reload={() => getAdmin(params.id)} />}
      </Match>
    </Switch>
  );
}

type Tab = "talks" | "comments" | "info" | "admins";

const ROLE_LABELS: Record<AdminRole, string> = { owner: "作成者", manager: "共同管理者" };

/** トーストの表示時間 */
const TOAST_MS = { ok: 2000, error: 5000 };

type Toast = { kind: "ok" | "error"; message: string };

function ManageView(props: { data: GetAdminResponse; reload: () => Promise<GetAdminResponse> }) {
  const [store, setStore] = createStore({
    event: props.data.event,
    talks: props.data.talks,
    commentCounts: props.data.commentCounts,
  });
  const eventId = props.data.event.id;
  const [tab, setTab] = createSignal<Tab>("talks");

  const [toast, setToast] = createSignal<Toast>();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (kind: Toast["kind"], message: string) => {
    clearTimeout(toastTimer);
    setToast({ kind, message });
    toastTimer = setTimeout(() => setToast(undefined), TOAST_MS[kind]);
  };
  onCleanup(() => clearTimeout(toastTimer));

  // 発表枠は ID で突き合わせて差し替え、編集中の行（入力欄）を作り直さない
  const setTalks = (talks: Talk[]) => setStore("talks", reconcile(talks, { key: "id" }));

  /** 他の管理者の変更と行き違ったときなどに、最新の内容を読み込み直す */
  const reload = async () => {
    try {
      const latest = await props.reload();
      setStore("event", reconcile(latest.event));
      setTalks(latest.talks);
      setStore("commentCounts", reconcile(latest.commentCounts));
    } catch {
      // 読み込めなければ今の表示のまま
    }
  };

  /**
   * 操作を即時に画面へ反映してからサーバーに送る。失敗したらトーストで知らせて元に戻す。
   * 成功したら apply でサーバーの結果を反映する
   */
  async function save<T>(options: {
    optimistic?: () => void;
    call: () => Promise<T>;
    apply: (result: T) => void;
    success?: string;
  }): Promise<boolean> {
    const before = { event: { ...store.event }, talks: store.talks.map((t) => ({ ...t })) };
    options.optimistic?.();
    try {
      options.apply(await options.call());
      if (options.success) showToast("ok", options.success);
      return true;
    } catch (err) {
      setStore("event", reconcile(before.event));
      setTalks(before.talks);
      showToast("error", failureMessage(err));
      if (err instanceof ApiError && err.status === 409) await reload();
      return false;
    }
  }

  function failureMessage(err: unknown): string {
    if (!(err instanceof ApiError)) return "保存できませんでした。通信状況を確認してください";
    if (err.status === 401) {
      return "管理セッションが無効です。管理用 URL から開き直してください";
    }
    if (err.status === 400) return "入力内容を確認してください";
    if (err.status === 404) return "この発表枠は削除されています";
    if (err.status === 409) return "ほかの管理者の変更と重なりました。最新の内容を読み込みました";
    return "保存できませんでした。時間をおいてもう一度お試しください";
  }

  const tabs = (): { id: Tab; label: string }[] => [
    { id: "talks", label: "発表枠" },
    { id: "comments", label: "コメント" },
    { id: "info", label: "基本情報" },
    // 共同管理者 URL の発行・無効化とイベントの削除は作成者だけ
    ...(props.data.role === "owner" ? [{ id: "admins" as const, label: "管理者" }] : []),
  ];

  return (
    <div class={styles.page}>
      <header class={styles.header}>
        <A
          class={styles.iconButton}
          href={`/e/${encodeURIComponent(eventId)}`}
          aria-label="イベントページに戻る"
        >
          <Icon name="chevronLeft" />
        </A>
        <h1 class={styles.eventName}>{store.event.name}</h1>
        <span class={styles.badge} data-role={props.data.role}>
          {ROLE_LABELS[props.data.role]}
        </span>
      </header>

      <div class={styles.tabs} role="tablist" aria-label="管理メニュー">
        <For each={tabs()}>
          {(t) => (
            <button
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              class={styles.tab}
              aria-selected={tab() === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      <main
        class={styles.panel}
        role="tabpanel"
        id={`panel-${tab()}`}
        aria-labelledby={`tab-${tab()}`}
      >
        <Switch>
          <Match when={tab() === "talks"}>
            <TalksTab
              talks={store.talks}
              commentCounts={store.commentCounts}
              onEdit={(talkId, field, value) => {
                const current = store.talks.find((t) => t.id === talkId);
                if (!current || current[field] === value) return true;
                if (!isValidTalk({ ...current, [field]: value })) {
                  showToast("error", "発表者かタイトルのどちらかを入力してください");
                  return false;
                }
                void save({
                  optimistic: () => setStore("talks", (t) => t.id === talkId, field, value),
                  call: () => updateTalk(eventId, talkId, { [field]: value }),
                  apply: (r) => setTalks(r.talks),
                  success: "保存しました",
                });
                return true;
              }}
              onAdd={(talk) =>
                save({
                  call: () => addTalk(eventId, talk),
                  apply: (r) => setTalks(r.talks),
                  success: "発表枠を追加しました",
                })
              }
              refresh={reload}
              onDelete={(talkId) =>
                void save({
                  optimistic: () => setTalks(store.talks.filter((t) => t.id !== talkId)),
                  call: () => deleteTalk(eventId, talkId),
                  apply: (r) => setTalks(r.talks),
                  success: "発表枠を削除しました",
                })
              }
              onReorder={(ids) =>
                void save({
                  optimistic: () =>
                    setTalks(ids.flatMap((id) => store.talks.find((t) => t.id === id) ?? [])),
                  call: () => reorderTalks(eventId, ids),
                  apply: (r) => setTalks(r.talks),
                })
              }
            />
          </Match>
          <Match when={tab() === "info"}>
            <InfoTab
              event={store.event}
              onSave={(patch) =>
                void save({
                  optimistic: () => setStore("event", patch as Partial<EventInfo>),
                  call: () => updateEvent(eventId, patch),
                  apply: (r) => setStore("event", reconcile(r.event)),
                  success: "保存しました",
                })
              }
              onReject={(message) => showToast("error", message)}
            />
          </Match>
          <Match when={tab() === "comments" || tab() === "admins"}>
            <p class={styles.placeholder}>この機能は準備中です。</p>
          </Match>
        </Switch>
      </main>

      <Show when={toast()}>
        {(t) => (
          <p
            class={styles.toast}
            data-kind={t().kind}
            role={t().kind === "error" ? "alert" : "status"}
          >
            {t().message}
          </p>
        )}
      </Show>
    </div>
  );
}

type TalkField = "speaker" | "title";

/** ドラッグ中の状態。from の行を dy だけ動かし、to との間の行を step だけずらして見せる */
type Drag = {
  id: TalkId;
  from: number;
  to: number;
  startY: number;
  dy: number;
  /** 1 行分の移動量（行の高さ + 行間） */
  step: number;
  /** ドラッグ開始時の各行の中心の y 座標 */
  centers: number[];
};

function TalksTab(props: {
  talks: Talk[];
  commentCounts: Record<TalkId, number>;
  /** 入力を受け付けたら true。受け付けなければ false（入力欄を元の値に戻す） */
  onEdit: (talkId: TalkId, field: TalkField, value: string) => boolean;
  onAdd: (talk: { speaker: string; title: string }) => Promise<boolean>;
  /** 最新の内容（コメント数など）を読み込み直す */
  refresh: () => Promise<void>;
  onDelete: (talkId: TalkId) => void;
  onReorder: (ids: TalkId[]) => void;
}) {
  const rows = new Map<TalkId, HTMLLIElement>();

  const move = (from: number, to: number) => {
    const ids = props.talks.map((t) => t.id);
    const [id] = ids.splice(from, 1);
    if (id === undefined || to < 0 || to >= props.talks.length || from === to) return;
    ids.splice(to, 0, id);
    props.onReorder(ids);
  };

  // ドラッグでの並べ替え。マウスでもタッチでも動くよう Pointer Events で実装する。
  // ドラッグ中は DOM を動かさず transform で見せ、離したときにまとめて並べ替える
  const [drag, setDrag] = createSignal<Drag>();
  const startDrag = (e: PointerEvent, index: number) => {
    if (e.button !== 0) return;
    const rects = props.talks.map((t) => rows.get(t.id)?.getBoundingClientRect());
    const rect = rects[index];
    const talk = props.talks[index];
    if (!rect || !talk || rects.some((r) => !r)) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const neighbor = rects[index + 1] ?? rects[index - 1];
    const gap = neighbor
      ? neighbor.top > rect.top
        ? neighbor.top - rect.bottom
        : rect.top - neighbor.bottom
      : 0;
    setDrag({
      id: talk.id,
      from: index,
      to: index,
      startY: e.clientY,
      dy: 0,
      step: rect.height + gap,
      centers: rects.map((r) => (r ? r.top + r.height / 2 : 0)),
    });
  };
  const moveDrag = (e: PointerEvent) => {
    const d = drag();
    if (!d) return;
    const dy = e.clientY - d.startY;
    const center = (d.centers[d.from] ?? 0) + dy;
    let to = d.from;
    while (to < d.centers.length - 1 && center > (d.centers[to + 1] ?? Infinity)) to++;
    while (to > 0 && center < (d.centers[to - 1] ?? -Infinity)) to--;
    setDrag({ ...d, dy, to });
  };
  const endDrag = (commit: boolean) => {
    const d = drag();
    setDrag(undefined);
    if (commit && d && d.from !== d.to) move(d.from, d.to);
  };
  const offset = (index: number): number => {
    const d = drag();
    if (!d) return 0;
    if (index === d.from) return d.dy;
    if (d.from < index && index <= d.to) return -d.step;
    if (d.to <= index && index < d.from) return d.step;
    return 0;
  };

  const focusHandle = (id: TalkId) =>
    queueMicrotask(() => rows.get(id)?.querySelector<HTMLElement>("[data-handle]")?.focus());

  const [sheet, setSheet] = createSignal<"add" | "delete">();
  const [deleteTarget, setDeleteTarget] = createSignal<Talk>();
  const [newTalk, setNewTalk] = createStore({ speaker: "", title: "" });
  const [adding, setAdding] = createSignal(false);
  const canAdd = () =>
    !adding() && isValidTalk({ speaker: newTalk.speaker.trim(), title: newTalk.title.trim() });
  const submitAdd = async () => {
    if (!canAdd()) return;
    setAdding(true);
    const ok = await props.onAdd({ speaker: newTalk.speaker.trim(), title: newTalk.title.trim() });
    setAdding(false);
    if (ok) {
      setNewTalk({ speaker: "", title: "" });
      setSheet(undefined);
    }
  };
  // 管理画面を開いた後にもコメントは増えるので、削除の確認を出すときに数え直す
  const [counting, setCounting] = createSignal(false);
  const confirmDelete = async (talk: Talk) => {
    setDeleteTarget(talk);
    setSheet("delete");
    setCounting(true);
    await props.refresh();
    setCounting(false);
  };
  const deleteCount = () => {
    const t = deleteTarget();
    return t ? (props.commentCounts[t.id] ?? 0) : 0;
  };

  return (
    <>
      <p class={styles.hint}>
        変更はすぐに参加者の画面に反映されます。左端のつまみをドラッグして並べ替えられます。
      </p>
      <ol class={styles.talks}>
        <For each={props.talks}>
          {(talk, i) => (
            <li
              ref={(el) => rows.set(talk.id, el)}
              class={styles.talk}
              data-dragging={drag()?.id === talk.id ? "" : undefined}
              data-moving={drag() ? "" : undefined}
              style={{ transform: `translateY(${offset(i())}px)` }}
            >
              <button
                type="button"
                class={styles.handle}
                data-handle
                aria-label={`${i() + 1} 番目「${talkLabel(talk)}」を並べ替え（上下の矢印キーで移動）`}
                onPointerDown={(e) => startDrag(e, i())}
                onPointerMove={moveDrag}
                onPointerUp={() => endDrag(true)}
                onPointerCancel={() => endDrag(false)}
                onKeyDown={(e) => {
                  const delta = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
                  if (delta === 0) return;
                  e.preventDefault();
                  move(i(), i() + delta);
                  focusHandle(talk.id);
                }}
              >
                <Icon name="grip" />
              </button>
              <span class={styles.talkNumber}>{i() + 1}</span>
              <div class={styles.talkFields}>
                <input
                  class={styles.input}
                  type="text"
                  aria-label={`${i() + 1} 番目の発表者`}
                  placeholder="発表者"
                  maxLength={DEFAULT_LIMITS.speakerMaxLength}
                  value={talk.speaker}
                  onChange={(e) => {
                    const input = e.currentTarget;
                    if (!props.onEdit(talk.id, "speaker", input.value.trim())) {
                      input.value = talk.speaker;
                    }
                  }}
                />
                <input
                  class={styles.input}
                  type="text"
                  aria-label={`${i() + 1} 番目のタイトル`}
                  placeholder="タイトル"
                  maxLength={DEFAULT_LIMITS.talkTitleMaxLength}
                  value={talk.title}
                  onChange={(e) => {
                    const input = e.currentTarget;
                    if (!props.onEdit(talk.id, "title", input.value.trim())) {
                      input.value = talk.title;
                    }
                  }}
                />
              </div>
              <button
                type="button"
                class={styles.removeTalk}
                aria-label={`${i() + 1} 番目の発表枠を削除`}
                disabled={props.talks.length <= 1}
                onClick={() => void confirmDelete(talk)}
              >
                <Icon name="trash" />
              </button>
            </li>
          )}
        </For>
      </ol>
      <button
        type="button"
        class={`${button.secondary} ${styles.addTalk}`}
        disabled={props.talks.length >= DEFAULT_LIMITS.talksMaxCount}
        onClick={() => setSheet("add")}
      >
        <Icon name="plus" />
        発表枠を追加
      </button>

      <Sheet open={sheet() === "add"} onClose={() => setSheet(undefined)} title="発表枠を追加">
        <form
          class={styles.sheetForm}
          onSubmit={(e) => {
            e.preventDefault();
            void submitAdd();
          }}
        >
          <input
            class={styles.input}
            type="text"
            aria-label="発表者"
            placeholder="発表者"
            maxLength={DEFAULT_LIMITS.speakerMaxLength}
            value={newTalk.speaker}
            onInput={(e) => setNewTalk("speaker", e.currentTarget.value)}
          />
          <input
            class={styles.input}
            type="text"
            aria-label="タイトル"
            placeholder="タイトル"
            maxLength={DEFAULT_LIMITS.talkTitleMaxLength}
            value={newTalk.title}
            onInput={(e) => setNewTalk("title", e.currentTarget.value)}
          />
          <p class={styles.sheetNote}>
            発表者かタイトルのどちらかを入力してください。末尾に追加されます。
          </p>
          <button type="submit" class={button.primary} disabled={!canAdd()}>
            {adding() ? "追加中…" : "追加する"}
          </button>
        </form>
      </Sheet>

      <Sheet
        open={sheet() === "delete"}
        onClose={() => setSheet(undefined)}
        title="この発表枠を削除しますか？"
      >
        <p class={styles.deletePreview}>{deleteTarget() && talkLabel(deleteTarget() as Talk)}</p>
        <p class={styles.deleteNote}>
          <Switch fallback="削除すると元に戻せません。">
            <Match when={counting()}>コメントの数を確認しています…</Match>
            <Match when={deleteCount() > 0}>
              この発表のコメント {deleteCount()} 件も削除されます。削除すると元に戻せません。
            </Match>
          </Switch>
        </p>
        <div class={styles.sheetActions}>
          <button type="button" class={button.secondary} onClick={() => setSheet(undefined)}>
            キャンセル
          </button>
          <button
            type="button"
            class={button.danger}
            disabled={counting()}
            onClick={() => {
              const t = deleteTarget();
              setSheet(undefined);
              if (t) props.onDelete(t.id);
            }}
          >
            削除する
          </button>
        </div>
      </Sheet>
    </>
  );
}

/** 基本情報の入力値を、API に送る値にする。空の任意項目は null */
function normalize(field: keyof UpdateEventRequest, value: string): string | null {
  const trimmed = value.trim();
  if (field === "hashtag") return trimmed.replace(/^[#＃]/, "") || null;
  if (field === "url") return trimmed || null;
  return trimmed;
}

function InfoTab(props: {
  event: EventInfo;
  onSave: (patch: UpdateEventRequest) => void;
  onReject: (message: string) => void;
}) {
  // フォーカスが外れたとき（change）に、変わった項目だけを保存する
  const change =
    (field: keyof UpdateEventRequest) => (e: Event & { currentTarget: HTMLInputElement }) => {
      const input = e.currentTarget;
      const value = normalize(field, input.value);
      if (value === props.event[field]) return;
      if ((field === "name" || field === "date") && !value) {
        props.onReject(
          field === "name" ? "イベント名を入力してください" : "開催日を入力してください",
        );
        input.value = props.event[field];
        return;
      }
      props.onSave({ [field]: value });
    };

  return (
    <div class={styles.card}>
      <p class={styles.hint}>入力欄から離れると保存され、参加者の画面にすぐ反映されます。</p>
      <label class={styles.field}>
        <span class={styles.label}>イベント名</span>
        <input
          class={styles.input}
          type="text"
          required
          maxLength={DEFAULT_LIMITS.eventNameMaxLength}
          value={props.event.name}
          onChange={change("name")}
        />
      </label>
      <label class={styles.field}>
        <span class={styles.label}>開催日</span>
        <input
          class={styles.input}
          type="date"
          required
          value={props.event.date}
          onChange={change("date")}
        />
      </label>
      <label class={styles.field}>
        <span class={styles.label}>イベントページ URL</span>
        <input
          class={styles.input}
          type="url"
          inputMode="url"
          maxLength={DEFAULT_LIMITS.eventUrlMaxLength}
          placeholder="https://connpass.com/event/..."
          value={props.event.url ?? ""}
          onChange={change("url")}
        />
      </label>
      <label class={styles.field}>
        <span class={styles.label}>ハッシュタグ</span>
        <input
          class={styles.input}
          type="text"
          maxLength={DEFAULT_LIMITS.hashtagMaxLength + 1}
          placeholder="#ltkai"
          value={props.event.hashtag ? `#${props.event.hashtag}` : ""}
          onChange={change("hashtag")}
        />
      </label>
    </div>
  );
}
