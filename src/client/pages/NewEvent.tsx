import { A } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import * as v from "valibot";
import type { CreateEventResponse } from "../../shared/api";
import { createEventInputSchema, DEFAULT_LIMITS } from "../../shared/schema";
import button from "../components/button.module.css";
import { Icon } from "../components/Icon";
import { ApiError, createEvent } from "../lib/api";
import { getTurnstileToken } from "../lib/turnstile";
import { Created } from "./Created";
import styles from "./NewEvent.module.css";

const INITIAL_TALKS = 2;
const schema = createEventInputSchema(DEFAULT_LIMITS);

type TalkRow = { key: number; speaker: string; title: string };

/** 端末のタイムゾーンでの今日（YYYY-MM-DD） */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

let nextKey = 0;
const emptyTalk = (): TalkRow => ({ key: nextKey++, speaker: "", title: "" });

export function NewEvent() {
  const [form, setForm] = createStore({
    name: "",
    date: today(),
    url: "",
    hashtag: "",
    talks: Array.from({ length: INITIAL_TALKS }, emptyTalk),
  });
  const [submitting, setSubmitting] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const [created, setCreated] = createSignal<CreateEventResponse & { name: string }>();

  function addTalk() {
    setForm("talks", (talks) => [...talks, emptyTalk()]);
  }

  function removeTalk(key: number) {
    setForm("talks", (talks) => talks.filter((t) => t.key !== key));
  }

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    setError();
    // 発表者もタイトルも空の枠は送らない
    const talks = form.talks
      .filter((t) => t.speaker.trim() !== "" || t.title.trim() !== "")
      .map(({ speaker, title }) => ({ speaker, title }));
    if (talks.length === 0) {
      setError("発表枠を 1 つ以上入力してください");
      return;
    }
    const input = { name: form.name, date: form.date, url: form.url, hashtag: form.hashtag, talks };
    if (!v.is(schema, input)) {
      setError("入力内容を確認してください");
      return;
    }

    setSubmitting(true);
    try {
      const turnstileToken = await getTurnstileToken("create_event");
      const res = await createEvent({ ...input, turnstileToken });
      setCreated({ ...res, name: form.name.trim() });
      window.scrollTo(0, 0);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "invalid_input"
          ? "入力内容を確認してください"
          : err instanceof ApiError && err.code === "turnstile_failed"
            ? "確認に失敗しました。もう一度お試しください"
            : "作成できませんでした。通信状況を確認して、もう一度お試しください",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Show when={created()} fallback={renderForm()}>
      {(c) => <Created id={c().id} ownerToken={c().ownerToken} name={c().name} />}
    </Show>
  );

  function renderForm() {
    return (
      <form class={styles.page} onSubmit={submit}>
        <header class={styles.header}>
          <A href="/" class={styles.logo}>
            LeacTion!
          </A>
          <h1 class={styles.title}>イベントを作る</h1>
          <p class={styles.lead}>アカウント登録は不要です。作成後に管理用の URL が発行されます。</p>
        </header>

        <section class={styles.card}>
          <label class={styles.field}>
            <span class={styles.label}>
              イベント名<span class={styles.required}>必須</span>
            </span>
            <input
              class={styles.input}
              type="text"
              required
              maxLength={DEFAULT_LIMITS.eventNameMaxLength}
              placeholder="例: フロントエンド LT 会 #12"
              value={form.name}
              onInput={(e) => setForm("name", e.currentTarget.value)}
            />
          </label>
          <label class={styles.field}>
            <span class={styles.label}>
              開催日<span class={styles.required}>必須</span>
            </span>
            <input
              class={styles.input}
              type="date"
              required
              value={form.date}
              onInput={(e) => setForm("date", e.currentTarget.value)}
            />
          </label>
        </section>

        <section class={styles.card}>
          <h2 class={styles.sectionTitle}>発表枠</h2>
          <p class={styles.hint}>あとから管理画面で追加・並べ替えできます。</p>
          <ol class={styles.talks}>
            <For each={form.talks}>
              {(talk, i) => (
                <li class={styles.talk}>
                  <span class={styles.talkNumber}>{i() + 1}</span>
                  <div class={styles.talkFields}>
                    <input
                      class={styles.input}
                      type="text"
                      aria-label={`${i() + 1} 番目の発表者`}
                      placeholder="発表者"
                      maxLength={DEFAULT_LIMITS.speakerMaxLength}
                      value={talk.speaker}
                      onInput={(e) => setForm("talks", i(), "speaker", e.currentTarget.value)}
                    />
                    <input
                      class={styles.input}
                      type="text"
                      aria-label={`${i() + 1} 番目のタイトル`}
                      placeholder="タイトル"
                      maxLength={DEFAULT_LIMITS.talkTitleMaxLength}
                      value={talk.title}
                      onInput={(e) => setForm("talks", i(), "title", e.currentTarget.value)}
                    />
                  </div>
                  <button
                    type="button"
                    class={styles.removeTalk}
                    aria-label={`${i() + 1} 番目の発表枠を削除`}
                    disabled={form.talks.length <= 1}
                    onClick={() => removeTalk(talk.key)}
                  >
                    <Icon name="close" />
                  </button>
                </li>
              )}
            </For>
          </ol>
          <button
            type="button"
            class={`${button.secondary} ${styles.addTalk}`}
            disabled={form.talks.length >= DEFAULT_LIMITS.talksMaxCount}
            onClick={addTalk}
          >
            <Icon name="plus" />
            発表枠を追加
          </button>
        </section>

        <details class={`${styles.card} ${styles.optional}`}>
          <summary class={styles.summary}>
            <Icon name="chevron" />
            イベントページ URL・ハッシュタグ（任意）
          </summary>
          <label class={styles.field}>
            <span class={styles.label}>イベントページ URL</span>
            <input
              class={styles.input}
              type="url"
              inputMode="url"
              maxLength={DEFAULT_LIMITS.eventUrlMaxLength}
              placeholder="https://connpass.com/event/..."
              value={form.url}
              onInput={(e) => setForm("url", e.currentTarget.value)}
            />
          </label>
          <label class={styles.field}>
            <span class={styles.label}>ハッシュタグ</span>
            <input
              class={styles.input}
              type="text"
              maxLength={DEFAULT_LIMITS.hashtagMaxLength + 1}
              placeholder="#ltkai"
              value={form.hashtag}
              onInput={(e) => setForm("hashtag", e.currentTarget.value)}
            />
          </label>
        </details>

        <div class={styles.submitBar}>
          <Show when={error()}>
            <p class={styles.error} role="alert">
              {error()}
            </p>
          </Show>
          <button type="submit" class={`${button.primary} ${button.block}`} disabled={submitting()}>
            {submitting() ? "作成中…" : "イベントを作成"}
          </button>
        </div>
      </form>
    );
  }
}
