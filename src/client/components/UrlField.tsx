import { createSignal, type JSX, onCleanup } from "solid-js";
import button from "./button.module.css";
import { Icon } from "./Icon";
import styles from "./UrlField.module.css";

/** 読み取り専用の URL 表示欄とコピーボタン。label は見出しと重なるので読み上げ用にだけ使う。 */
export function UrlField(props: { label: string; url: string; children?: JSX.Element }) {
  let input: HTMLInputElement | undefined;
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  async function copy() {
    try {
      await navigator.clipboard.writeText(props.url);
    } catch {
      // クリップボード API が使えないときは選択状態にして手動コピーに任せる
      input?.select();
      return;
    }
    setCopied(true);
    clearTimeout(timer);
    timer = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div class={styles.field}>
      <input
        ref={input}
        class={styles.input}
        type="text"
        aria-label={props.label}
        value={props.url}
        readOnly
        onFocus={(e) => e.currentTarget.select()}
      />
      <div class={styles.actions}>
        <button type="button" class={button.secondary} onClick={copy}>
          <Icon name={copied() ? "check" : "copy"} />
          <span aria-live="polite">{copied() ? "コピーしました" : "コピー"}</span>
        </button>
        {props.children}
      </div>
    </div>
  );
}
