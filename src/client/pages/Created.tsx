import { useNavigate } from "@solidjs/router";
import { createEffect, createSignal, onCleanup } from "solid-js";
import button from "../components/button.module.css";
import { Icon } from "../components/Icon";
import { UrlField } from "../components/UrlField";
import { trackView } from "../lib/analytics";
import { withSource } from "../lib/traffic";
import { eventUrl, manageUrl } from "../lib/urls";
import styles from "./Created.module.css";

/**
 * 作成完了画面。作成者用 URL はハッシュしか保存しないため、ここでしか表示できない。
 * 保存を確認するまで次へ進めず、ページを閉じようとしたら警告する。
 */
export function Created(props: { id: string; ownerToken: string; name: string }) {
  const navigate = useNavigate();
  const [saved, setSaved] = createSignal(false);
  const ownerUrl = () => manageUrl(props.id, props.ownerToken);
  // 主催者が告知ページやスライドに載せる URL。経路が分かるよう ?src=host を付ける
  const participantUrl = () => withSource(eventUrl(props.id), "host");
  trackView("created", props.id);

  const mailto = () => {
    const subject = `【LeacTion!】${props.name} の作成者用 URL`;
    const body = [
      `イベント「${props.name}」の作成者用 URL です。`,
      "この URL をなくすと管理できなくなります。他の人には共有しないでください。",
      "",
      `作成者用 URL: ${ownerUrl()}`,
      `参加者用 URL: ${participantUrl()}`,
    ].join("\n");
    return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  // 保存を確認するまでは、閉じる・再読み込みで URL を失わないよう警告する。
  // mailto: のリンクでも beforeunload が発火するブラウザがあるので、その直後は警告しない。
  let openingMail = false;
  createEffect(() => {
    if (saved()) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (!openingMail) e.preventDefault();
    };
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
        <UrlField label="作成者用 URL" url={ownerUrl()}>
          <a
            class={button.secondary}
            href={mailto()}
            onClick={() => {
              openingMail = true;
              setTimeout(() => {
                openingMail = false;
              }, 1000);
            }}
          >
            <Icon name="mail" />
            自分宛てにメールで送る
          </a>
        </UrlField>
        <label class={styles.confirm}>
          <input
            type="checkbox"
            class={styles.checkbox}
            checked={saved()}
            onChange={(e) => setSaved(e.currentTarget.checked)}
          />
          URL をブックマーク・保存しました
        </label>
      </section>

      <div class={styles.footer}>
        <button
          type="button"
          class={`${button.primary} ${button.block}`}
          disabled={!saved()}
          onClick={() => navigate(`/e/${props.id}`)}
        >
          イベントページへ
        </button>
      </div>
    </main>
  );
}
