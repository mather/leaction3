import { useNavigate } from "@solidjs/router";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import button from "../components/button.module.css";
import { Icon } from "../components/Icon";
import { UrlField } from "../components/UrlField";
import { trackView } from "../lib/analytics";
import { withSource } from "../lib/traffic";
import { eventUrl, manageUrl } from "../lib/urls";
import styles from "./Created.module.css";

/**
 * 作成完了画面。作成者用 URL はハッシュしか保存しないため、ここでしか表示できない。
 * 保存を確認するまで次へ進めず（押すとチェック欄で警告する）、ページを閉じようとしたら警告する。
 */
export function Created(props: { id: string; ownerToken: string; name: string }) {
  const navigate = useNavigate();
  const [saved, setSaved] = createSignal(false);
  // 保存を確認せずに「イベントページへ」を押したか。押したらチェック欄で警告する
  const [needConfirm, setNeedConfirm] = createSignal(false);
  let checkbox: HTMLInputElement | undefined;
  const ownerUrl = () => manageUrl(props.id, props.ownerToken);
  // 主催者が告知ページやスライドに載せる URL。経路が分かるよう ?src=host を付ける
  const participantUrl = () => withSource(eventUrl(props.id), "host");
  trackView("created", props.id);

  // 保存用の文面。メーラーが関連付けられていない環境（ブラウザ版 Gmail など）では mailto: が
  // 動かないので、ファイルに書き出すか Web Share API で他のアプリへ渡す
  const savedText = () =>
    [
      `LeacTion! イベント「${props.name}」`,
      "",
      "作成者用 URL（この URL をなくすと管理できなくなります。他の人には共有しないでください）",
      ownerUrl(),
      "",
      "参加者用 URL",
      participantUrl(),
      "",
    ].join("\n");

  const download = () => {
    const blob = new Blob([savedText()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leaction-${props.id}.txt`;
    a.click();
    // クリック直後に revoke するとダウンロードが始まらないブラウザがあるので少し待つ
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Web Share API に対応したブラウザ（主にスマホ）でだけ「他のアプリで保存」を出す
  const canShare = typeof navigator.share === "function";
  const share = async () => {
    try {
      await navigator.share({ title: `${props.name} の作成者用 URL`, text: savedText() });
    } catch {
      // キャンセル（AbortError）や失敗は何もしない。コピーやテキスト保存で残せる
    }
  };

  // ボタンを disabled にすると押しても何も起きず、チェックが必要だと気づけない。
  // 押せるようにしておき、未確認ならチェック欄まで戻して警告する
  const goEvent = () => {
    if (saved()) {
      navigate(`/e/${props.id}`);
      return;
    }
    setNeedConfirm(true);
    checkbox?.scrollIntoView({ behavior: "smooth", block: "center" });
    checkbox?.focus({ preventScroll: true });
  };

  // 保存を確認するまでは、閉じる・再読み込みで URL を失わないよう警告する。
  createEffect(() => {
    if (saved()) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    onCleanup(() => window.removeEventListener("beforeunload", warn));
  });

  return (
    <main class={styles.page}>
      <header class={styles.header}>
        <span class={styles.done}>
          <Icon name="check" size={28} />
        </span>
        <h1 class={styles.title}>イベントを作成しました</h1>
        <p class={styles.eventName}>{props.name}</p>
      </header>

      <section class={styles.card}>
        <h2 class={styles.sectionTitle}>参加者用 URL</h2>
        <p class={styles.hint}>会場や SNS で共有してください。</p>
        <UrlField label="参加者用 URL" url={participantUrl()} />
      </section>

      <section class={`${styles.card} ${styles.warnCard}`}>
        <h2 class={`${styles.sectionTitle} ${styles.warnTitle}`}>
          <Icon name="alert" />
          作成者用 URL
        </h2>
        <p class={styles.warnText}>
          この URL
          をなくすと管理できなくなります。他の人には共有しないでください。この画面を閉じると、二度と表示できません。
        </p>
        <p class={styles.coManageNote}>
          ほかの人と管理するときは、管理画面の「管理者」タブで共同管理者用の URL
          を発行して渡せます。
        </p>
        <UrlField label="作成者用 URL" url={ownerUrl()} />
        {/* コピーと並べると見分けにくいので、保存の手段は説明付きでまとめて出す */}
        <div class={styles.saveOptions}>
          <p class={styles.saveTitle}>コピー以外の保存方法</p>
          <button
            type="button"
            class={`${button.secondary} ${styles.saveOption}`}
            onClick={download}
          >
            <Icon name="download" />
            <span class={styles.saveText}>
              <span>テキストファイルで保存</span>
              <span class={styles.saveDesc}>
                この端末に URL を書いたファイルをダウンロードします
              </span>
            </span>
          </button>
          <Show when={canShare}>
            <button
              type="button"
              class={`${button.secondary} ${styles.saveOption}`}
              onClick={share}
            >
              <Icon name="share" />
              <span class={styles.saveText}>
                <span>他のアプリに送る</span>
                <span class={styles.saveDesc}>メモやメール、自分宛てのチャットなどに送ります</span>
              </span>
            </button>
          </Show>
        </div>
        <label
          class={
            needConfirm() && !saved() ? `${styles.confirm} ${styles.confirmError}` : styles.confirm
          }
        >
          <input
            ref={checkbox}
            type="checkbox"
            class={styles.checkbox}
            checked={saved()}
            onChange={(e) => setSaved(e.currentTarget.checked)}
          />
          URL をブックマーク・保存しました
        </label>
        <Show when={needConfirm() && !saved()}>
          <p class={styles.confirmAlert} role="alert">
            <Icon name="alert" size={16} />
            URL を保存したら、チェックを入れてください
          </p>
        </Show>
      </section>

      <div class={styles.footer}>
        <button
          type="button"
          class={`${button.primary} ${button.block}`}
          aria-disabled={!saved()}
          aria-describedby={saved() ? undefined : "created-next-hint"}
          onClick={goEvent}
        >
          イベントページへ
        </button>
        <Show when={!saved()}>
          <p id="created-next-hint" class={styles.nextHint}>
            上の「保存しました」にチェックを入れると進めます
          </p>
        </Show>
      </div>
    </main>
  );
}
