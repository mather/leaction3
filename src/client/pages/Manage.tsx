import { A, useParams } from "@solidjs/router";
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
import { createStore, reconcile } from "solid-js/store";
import type {
  AdminComment,
  AdminKey,
  AdminRole,
  EventDeletion,
  GetAdminResponse,
  UpdateEventRequest,
} from "../../shared/api";
import type { EventInfo, Talk, TalkId } from "../../shared/protocol";
import { DEFAULT_LIMITS, isValidTalk } from "../../shared/schema";
import button from "../components/button.module.css";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/Sheet";
import { UrlField } from "../components/UrlField";
import { trackView } from "../lib/analytics";
import {
  ApiError,
  addTalk,
  createAdminKey,
  createAdminSession,
  deleteEvent,
  deleteTalk,
  getAdmin,
  getAdminComments,
  getAdminKeys,
  reorderTalks,
  restoreEvent,
  revokeAdminKey,
  setAuthorHidden,
  setCommentHidden,
  updateEvent,
  updateTalk,
} from "../lib/api";
import { talkLabel } from "../lib/talks";
import { manageUrl } from "../lib/urls";
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
  trackView("manage", params.id);
  // 入れ替えに成功するまではトークンを手元に残し、再試行に使う
  let token = takeTokenFromHash();
  const [data, { refetch, mutate }] = createResource(
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
        {(d) => (
          // 削除済みなら復元の画面を出す。削除・復元したら表示内容を差し替えて画面を切り替える
          <Show
            when={d().deletion}
            fallback={
              <ManageView
                data={d()}
                reload={() => getAdmin(params.id)}
                onDeleted={(deletion) => mutate({ ...d(), deletion })}
              />
            }
          >
            {(deletion) => (
              <DeletedView
                event={d().event}
                deletion={deletion()}
                onRestored={(restored) => mutate(restored)}
              />
            )}
          </Show>
        )}
      </Match>
    </Switch>
  );
}

type Tab = "talks" | "comments" | "info" | "admins";

const ROLE_LABELS: Record<AdminRole, string> = { owner: "作成者", manager: "共同管理者" };

/** トーストの表示時間 */
const TOAST_MS = { ok: 2000, error: 5000 };

type Toast = { kind: "ok" | "error"; message: string };

/** 削除・復元の期限などの日時 */
const dateTimeFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** 削除済みのイベントの管理画面（作成者だけが開ける）。期限までは復元できる */
function DeletedView(props: {
  event: EventInfo;
  deletion: EventDeletion;
  onRestored: (data: GetAdminResponse) => void;
}) {
  const [restoring, setRestoring] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const restore = async () => {
    setRestoring(true);
    setError(undefined);
    try {
      props.onRestored(await restoreEvent(props.event.id));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 404
          ? "復元の期限を過ぎたため、復元できません。"
          : "復元できませんでした。通信状況を確認してください。",
      );
      setRestoring(false);
    }
  };

  return (
    <div class={styles.page}>
      <header class={styles.header}>
        <h1 class={styles.eventName}>{props.event.name}</h1>
        <span class={styles.badge} data-role="owner">
          {ROLE_LABELS.owner}
        </span>
      </header>
      <main class={styles.panel}>
        <section class={`${styles.card} ${styles.warnCard}`}>
          <h2 class={styles.sectionTitle}>このイベントは削除されています</h2>
          <p class={styles.cardText}>
            参加者にはイベントページが表示されません。
            {dateTimeFormat.format(props.deletion.restorableUntil)}{" "}
            まで復元できます。過ぎるとコメントを含むすべてのデータが消えます。
          </p>
          <button
            type="button"
            class={button.primary}
            disabled={restoring()}
            onClick={() => void restore()}
          >
            {restoring() ? "復元しています…" : "イベントを復元する"}
          </button>
          <Show when={error()}>
            <p class={styles.errorText} role="alert">
              {error()}
            </p>
          </Show>
        </section>
      </main>
    </div>
  );
}

function ManageView(props: {
  data: GetAdminResponse;
  reload: () => Promise<GetAdminResponse>;
  onDeleted: (deletion: EventDeletion) => void;
}) {
  const [store, setStore] = createStore({
    event: props.data.event,
    talks: props.data.talks,
    commentCounts: props.data.commentCounts,
  });
  const eventId = props.data.event.id;
  const [tab, setTab] = createSignal<Tab>("talks");
  // 発行した共同管理者 URL。一度しか表示できないので、タブを切り替えても消さない
  const [issued, setIssued] = createSignal<IssuedKey>();

  const [toast, setToast] = createSignal<Toast>();
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  const showToast = (kind: Toast["kind"], message: string) => {
    clearTimeout(toastTimer);
    setToast({ kind, message });
    toastTimer = setTimeout(() => setToast(undefined), TOAST_MS[kind]);
  };
  onCleanup(() => clearTimeout(toastTimer));

  // 発表枠は ID で突き合わせて差し替え、編集中の行（入力欄）を作り直さない。
  // 発表枠の一覧を差し替えるたびに版を進め、取り消しが新しい変更を消さないようにする
  let talksRevision = 0;
  const setTalks = (talks: Talk[]) => {
    talksRevision++;
    setStore("talks", reconcile(talks, { key: "id" }));
  };

  /** 最新の内容を読み込み直す。読み込めたら true */
  const reload = async (): Promise<boolean> => {
    try {
      const latest = await props.reload();
      setStore("event", reconcile(latest.event));
      setTalks(latest.talks);
      setStore("commentCounts", reconcile(latest.commentCounts));
    } catch {
      // 読み込めなければ今の表示のまま
      return false;
    }
    return comments() === null || (await loadComments());
  };

  // コメント一覧（非表示も含む、新しい順）。コメントタブを開いたときに読み込む。null は未読み込み
  const [comments, setComments] = createSignal<AdminComment[] | null>(null);
  const loadComments = async (): Promise<boolean> => {
    try {
      setComments((await getAdminComments(eventId)).comments);
      return true;
    } catch {
      return false;
    }
  };
  createEffect(
    on(tab, (t) => {
      if (t !== "comments") return;
      void loadComments().then((ok) => {
        if (!ok) showToast("error", "コメントを読み込めませんでした。通信状況を確認してください");
      });
    }),
  );

  /** コメント一覧を書き換えるモデレーション操作。失敗時の取り消しは、その後に一覧が変わっていなければ戻す */
  const moderate = (
    change: (c: AdminComment) => AdminComment,
    call: () => Promise<{ comments: AdminComment[] }>,
    success: string,
  ) =>
    void save({
      optimistic: () => {
        const before = comments();
        setComments((list) => list?.map(change) ?? null);
        const after = comments();
        return () => {
          if (comments() === after) setComments(before);
        };
      },
      call,
      apply: (r) => setComments(r.comments),
      success,
    });

  /**
   * 操作を即時に画面へ反映してからサーバーに送る。成功したら apply でサーバーの結果を反映する。
   * 失敗したらトーストで知らせて元に戻す。保存は重なりうるので、操作前の全体のスナップショットには戻さず
   * （後から成功した変更まで消えてしまう）、サーバーの最新の内容を読み込み直す。
   * 読み込めなければ、optimistic が返す取り消しで、この操作の変更だけを戻す
   */
  async function save<T>(options: {
    optimistic?: () => () => void;
    call: () => Promise<T>;
    apply: (result: T) => void;
    success?: string;
  }): Promise<boolean> {
    const undo = options.optimistic?.();
    try {
      options.apply(await options.call());
      if (options.success) showToast("ok", options.success);
      return true;
    } catch (err) {
      showToast("error", failureMessage(err));
      if (!(await reload())) undo?.();
      return false;
    }
  }

  /** 発表枠の一覧を差し替え、その後に差し替えられていなければ元に戻す取り消しを返す */
  const replaceTalks = (talks: Talk[]) => {
    const before = store.talks.map((t) => ({ ...t }));
    setTalks(talks);
    const revision = talksRevision;
    return () => {
      if (talksRevision === revision) setTalks(before);
    };
  };

  function failureMessage(err: unknown): string {
    if (!(err instanceof ApiError)) return "保存できませんでした。通信状況を確認してください";
    if (err.status === 401) {
      return "管理セッションが無効です。管理用 URL から開き直してください";
    }
    if (err.status === 403) return "この操作は作成者だけができます";
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
                const previous = current[field];
                void save({
                  optimistic: () => {
                    setStore("talks", (t) => t.id === talkId, field, value);
                    // その後に同じ項目が書き換えられていなければ戻す
                    return () =>
                      setStore(
                        "talks",
                        (t) => t.id === talkId && t[field] === value,
                        field,
                        previous,
                      );
                  },
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
                  optimistic: () => replaceTalks(store.talks.filter((t) => t.id !== talkId)),
                  call: () => deleteTalk(eventId, talkId),
                  apply: (r) => setTalks(r.talks),
                  success: "発表枠を削除しました",
                })
              }
              onReorder={(ids) =>
                void save({
                  optimistic: () =>
                    replaceTalks(ids.flatMap((id) => store.talks.find((t) => t.id === id) ?? [])),
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
                  optimistic: () => {
                    const before = { ...store.event };
                    const changed = Object.keys(patch) as (keyof UpdateEventRequest)[];
                    setStore("event", patch as Partial<EventInfo>);
                    // その後に書き換えられていない項目だけを戻す
                    return () => {
                      for (const key of changed) {
                        if (store.event[key] === patch[key]) setStore("event", key, before[key]);
                      }
                    };
                  },
                  call: () => updateEvent(eventId, patch),
                  apply: (r) => setStore("event", reconcile(r.event)),
                  success: "保存しました",
                })
              }
              onReject={(message) => showToast("error", message)}
            />
          </Match>
          <Match when={tab() === "comments"}>
            <CommentsTab
              commentsOpen={store.event.commentsOpen}
              comments={comments()}
              talks={store.talks}
              onRefresh={async () => {
                if (!(await loadComments())) {
                  showToast("error", "コメントを読み込めませんでした。通信状況を確認してください");
                }
              }}
              onToggleOpen={(open) =>
                void save({
                  optimistic: () => {
                    setStore("event", "commentsOpen", open);
                    return () => {
                      if (store.event.commentsOpen === open) {
                        setStore("event", "commentsOpen", !open);
                      }
                    };
                  },
                  call: () => updateEvent(eventId, { commentsOpen: open }),
                  apply: (r) => setStore("event", reconcile(r.event)),
                  success: open ? "コメントの受付を再開しました" : "コメントの受付を停止しました",
                })
              }
              onHide={(commentId, hidden) =>
                moderate(
                  (c) => (c.id === commentId ? { ...c, hidden } : c),
                  () => setCommentHidden(eventId, commentId, hidden),
                  hidden ? "非表示にしました" : "表示に戻しました",
                )
              }
              onHideAuthor={(authorKey, hidden) =>
                moderate(
                  (c) => (c.authorKey === authorKey ? { ...c, hidden, authorHidden: hidden } : c),
                  () => setAuthorHidden(eventId, authorKey, hidden),
                  hidden
                    ? "この投稿者のコメントをすべて非表示にしました"
                    : "この投稿者の非表示を解除しました",
                )
              }
            />
          </Match>
          <Match when={tab() === "admins"}>
            <AdminsTab
              eventId={eventId}
              issued={issued()}
              onIssued={setIssued}
              onDeleted={props.onDeleted}
              showToast={showToast}
              failureMessage={failureMessage}
            />
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
  refresh: () => Promise<unknown>;
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

const timeFormat = new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" });

/** 投稿者キーのうち画面に出す部分。同じ人の投稿だと分かれば足りる */
const shortKey = (key: string) => key.slice(0, 4);

function CommentsTab(props: {
  commentsOpen: boolean;
  /** null は読み込み中 */
  comments: AdminComment[] | null;
  talks: Talk[];
  onRefresh: () => Promise<void>;
  onToggleOpen: (open: boolean) => void;
  onHide: (commentId: string, hidden: boolean) => void;
  onHideAuthor: (authorKey: string, hidden: boolean) => void;
}) {
  // 発表で絞り込む。空文字はすべての発表
  const [talkFilter, setTalkFilter] = createSignal("");
  const visible = createMemo(() => {
    const list = props.comments ?? [];
    return talkFilter() === "" ? list : list.filter((c) => c.talkId === talkFilter());
  });
  const talkName = (talkId: string) => {
    const index = props.talks.findIndex((t) => t.id === talkId);
    const talk = props.talks[index];
    return talk ? `${index + 1}. ${talkLabel(talk)}` : "";
  };

  const [refreshing, setRefreshing] = createSignal(false);
  const refresh = async () => {
    setRefreshing(true);
    await props.onRefresh();
    setRefreshing(false);
  };

  // 投稿者ごとの非表示は影響が大きいので確認を挟む（表示に戻すのは確認なし）
  const [authorTarget, setAuthorTarget] = createSignal<string>();
  const authorCount = () =>
    (props.comments ?? []).filter((c) => c.authorKey === authorTarget()).length;

  return (
    <>
      <div class={styles.card}>
        <label class={styles.switchRow}>
          <span>
            <span class={styles.label}>コメントを受け付ける</span>
            <span class={styles.switchNote}>
              {props.commentsOpen
                ? "参加者はコメントを投稿できます"
                : "停止中です。参加者の入力欄の代わりに「コメントの受付は停止中です」と表示されます"}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-checked={props.commentsOpen}
            class={styles.switch}
            checked={props.commentsOpen}
            onChange={(e) => props.onToggleOpen(e.currentTarget.checked)}
          />
        </label>
      </div>

      <div class={styles.listHeader}>
        <select
          class={styles.select}
          aria-label="発表で絞り込む"
          value={talkFilter()}
          onChange={(e) => setTalkFilter(e.currentTarget.value)}
        >
          <option value="">すべての発表</option>
          <For each={props.talks}>
            {(t, i) => (
              <option value={t.id}>
                {i() + 1}. {talkLabel(t)}
              </option>
            )}
          </For>
        </select>
        <button
          type="button"
          class={button.secondary}
          disabled={refreshing()}
          onClick={() => void refresh()}
        >
          {refreshing() ? "更新中…" : "最新にする"}
        </button>
      </div>

      <Show
        when={props.comments !== null}
        fallback={<p class={styles.placeholder}>コメントを読み込んでいます…</p>}
      >
        <Show
          when={visible().length > 0}
          fallback={<p class={styles.placeholder}>まだコメントはありません。</p>}
        >
          <ol class={styles.comments}>
            <For each={visible()}>
              {(c) => (
                <li class={styles.comment} data-hidden={c.hidden ? "" : undefined}>
                  <p class={styles.commentMeta}>
                    <span class={styles.commentTalk}>{talkName(c.talkId)}</span>
                    <time dateTime={new Date(c.createdAt).toISOString()}>
                      {timeFormat.format(c.createdAt)}
                    </time>
                    <span class={styles.author} title="投稿者 ID の先頭 4 文字">
                      ID {shortKey(c.authorKey)}
                    </span>
                    <span class={styles.likes} title="いいね">
                      <Icon name="heart" size={14} />
                      {c.likes}
                    </span>
                  </p>
                  <Show when={c.hidden}>
                    <p class={styles.hiddenBadge}>
                      {c.authorHidden ? "非表示（投稿者ごと）" : "非表示"}
                    </p>
                  </Show>
                  {/* プレーンテキストとして表示する（リンク化もしない） */}
                  <p class={styles.commentBody}>{c.body}</p>
                  <div class={styles.commentActions}>
                    <button
                      type="button"
                      class={styles.textButton}
                      onClick={() => props.onHide(c.id, !c.hidden)}
                    >
                      {c.hidden ? "表示に戻す" : "非表示にする"}
                    </button>
                    <Show
                      when={c.authorHidden}
                      fallback={
                        <button
                          type="button"
                          class={styles.textButton}
                          data-danger
                          onClick={() => setAuthorTarget(c.authorKey)}
                        >
                          この投稿者をすべて非表示
                        </button>
                      }
                    >
                      <button
                        type="button"
                        class={styles.textButton}
                        onClick={() => props.onHideAuthor(c.authorKey, false)}
                      >
                        この投稿者の非表示を解除
                      </button>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </Show>
      </Show>

      <Sheet
        open={authorTarget() !== undefined}
        onClose={() => setAuthorTarget(undefined)}
        title="この投稿者をすべて非表示にしますか？"
      >
        <p class={styles.deleteNote}>
          投稿者 ID {shortKey(authorTarget() ?? "")} のコメント {authorCount()}{" "}
          件をすべて非表示にします。これからの投稿も参加者には表示されません。
        </p>
        <p class={styles.sheetNote}>あとから「この投稿者の非表示を解除」で戻せます。</p>
        <div class={styles.sheetActions}>
          <button type="button" class={button.secondary} onClick={() => setAuthorTarget(undefined)}>
            キャンセル
          </button>
          <button
            type="button"
            class={button.danger}
            onClick={() => {
              const key = authorTarget();
              setAuthorTarget(undefined);
              if (key) props.onHideAuthor(key, true);
            }}
          >
            非表示にする
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

/** 発行した直後の共同管理者 URL */
type IssuedKey = { keyId: string; url: string };

/** 管理者タブ（作成者だけ）。共同管理者 URL の発行・無効化と、イベントの削除 */
function AdminsTab(props: {
  eventId: string;
  issued: IssuedKey | undefined;
  onIssued: (issued: IssuedKey | undefined) => void;
  onDeleted: (deletion: EventDeletion) => void;
  showToast: (kind: Toast["kind"], message: string) => void;
  failureMessage: (err: unknown) => string;
}) {
  // 共同管理者 URL の一覧（新しい順）。null は読み込み中
  const [keys, setKeys] = createSignal<AdminKey[] | null>(null);
  const load = async () => {
    try {
      setKeys((await getAdminKeys(props.eventId)).keys);
    } catch (err) {
      props.showToast("error", props.failureMessage(err));
    }
  };
  void load();

  const [issuing, setIssuing] = createSignal(false);
  const issue = async () => {
    setIssuing(true);
    try {
      const { key, token } = await createAdminKey(props.eventId);
      setKeys((list) => [key, ...(list ?? [])]);
      props.onIssued({ keyId: key.id, url: manageUrl(props.eventId, token) });
    } catch (err) {
      props.showToast(
        "error",
        err instanceof ApiError && err.status === 409
          ? "共同管理者 URL が上限に達しています。使わない URL を無効化してください"
          : props.failureMessage(err),
      );
    }
    setIssuing(false);
  };

  const [revokeTarget, setRevokeTarget] = createSignal<AdminKey>();
  const revoke = async (key: AdminKey) => {
    try {
      setKeys((await revokeAdminKey(props.eventId, key.id)).keys);
      if (props.issued?.keyId === key.id) props.onIssued(undefined);
      props.showToast("ok", "無効化しました");
    } catch (err) {
      props.showToast("error", props.failureMessage(err));
      await load();
    }
  };

  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const remove = async () => {
    setDeleting(true);
    try {
      const { deletion } = await deleteEvent(props.eventId);
      setConfirmingDelete(false);
      props.onDeleted(deletion);
    } catch (err) {
      props.showToast("error", props.failureMessage(err));
      setDeleting(false);
    }
  };

  /** 一覧での呼び名。発行順に番号を振る（一覧は新しい順） */
  const keyLabel = (index: number) => `共同管理者 URL ${(keys()?.length ?? 0) - index}`;

  return (
    <>
      <section class={styles.card}>
        <h2 class={styles.sectionTitle}>共同管理者 URL</h2>
        <p class={styles.cardText}>
          共同管理者は、発表枠・基本情報の編集とコメントの管理ができます。共同管理者 URL
          の発行とイベントの削除はできません。
        </p>
        <Show when={props.issued}>
          {(issued) => (
            <div class={styles.issued}>
              <p class={styles.issuedNote}>
                <Icon name="alert" />
                この URL は今だけ表示されます。コピーして共同管理者に渡してください。
              </p>
              <UrlField label="発行した共同管理者 URL" url={issued().url} />
            </div>
          )}
        </Show>
        <button
          type="button"
          class={button.secondary}
          disabled={issuing()}
          onClick={() => void issue()}
        >
          <Icon name="plus" />
          {issuing() ? "発行しています…" : "新しい共同管理者 URL を発行"}
        </button>
        <Show
          when={keys()}
          fallback={<p class={styles.hint}>共同管理者 URL を読み込んでいます…</p>}
        >
          {(list) => (
            <Show
              when={list().length > 0}
              fallback={<p class={styles.hint}>まだ発行していません。</p>}
            >
              <ul class={styles.keys}>
                <For each={list()}>
                  {(key, i) => (
                    <li class={styles.key} data-revoked={key.revokedAt !== null ? "" : undefined}>
                      <span class={styles.keyInfo}>
                        <span class={styles.keyName}>{keyLabel(i())}</span>
                        <span class={styles.keyMeta}>
                          {dateTimeFormat.format(key.createdAt)} 発行
                          {key.revokedAt !== null &&
                            ` · ${dateTimeFormat.format(key.revokedAt)} 無効化済み`}
                        </span>
                      </span>
                      <Show when={key.revokedAt === null}>
                        <button
                          type="button"
                          class={styles.textButton}
                          data-danger
                          onClick={() => setRevokeTarget(key)}
                        >
                          無効化
                        </button>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          )}
        </Show>
      </section>

      <section class={`${styles.card} ${styles.warnCard}`}>
        <h2 class={styles.sectionTitle}>イベントの削除</h2>
        <p class={styles.cardText}>
          削除すると、参加者にはイベントページが表示されなくなります。削除後{" "}
          {DEFAULT_LIMITS.deletedRetentionDays} 日間は、この作成者 URL から復元できます。
        </p>
        <button type="button" class={button.danger} onClick={() => setConfirmingDelete(true)}>
          <Icon name="trash" />
          イベントを削除
        </button>
      </section>

      <Sheet
        open={revokeTarget() !== undefined}
        onClose={() => setRevokeTarget(undefined)}
        title="この共同管理者 URL を無効化しますか？"
      >
        <p class={styles.deleteNote}>
          この URL から開いている管理画面も、すぐに使えなくなります。無効化は取り消せません。
        </p>
        <p class={styles.sheetNote}>
          引き続き管理してもらうときは、新しい URL を発行してください。
        </p>
        <div class={styles.sheetActions}>
          <button type="button" class={button.secondary} onClick={() => setRevokeTarget(undefined)}>
            キャンセル
          </button>
          <button
            type="button"
            class={button.danger}
            onClick={() => {
              const key = revokeTarget();
              setRevokeTarget(undefined);
              if (key) void revoke(key);
            }}
          >
            無効化する
          </button>
        </div>
      </Sheet>

      <Sheet
        open={confirmingDelete()}
        onClose={() => setConfirmingDelete(false)}
        title="このイベントを削除しますか？"
      >
        <p class={styles.deleteNote}>
          参加者にはイベントページが表示されなくなり、接続中の参加者の画面も閉じます。
        </p>
        <p class={styles.sheetNote}>
          削除後 {DEFAULT_LIMITS.deletedRetentionDays} 日間は、この作成者 URL
          から復元できます。過ぎるとコメントを含むすべてのデータが消えます。
        </p>
        <div class={styles.sheetActions}>
          <button type="button" class={button.secondary} onClick={() => setConfirmingDelete(false)}>
            キャンセル
          </button>
          <button
            type="button"
            class={button.danger}
            disabled={deleting()}
            onClick={() => void remove()}
          >
            {deleting() ? "削除しています…" : "削除する"}
          </button>
        </div>
      </Sheet>
    </>
  );
}
