import { createEffect, type JSX } from "solid-js";
import { Icon } from "./Icon";
import styles from "./Sheet.module.css";

/**
 * 画面下から出るシート。<dialog> のモーダルを使うので、Esc で閉じられ、背面は操作できない。
 * 背景（シートの外）を押しても閉じる。
 */
export function Sheet(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: JSX.Element;
}) {
  let dialog: HTMLDialogElement | undefined;

  createEffect(() => {
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
  });

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでは <dialog> 標準の Esc で閉じられる
    <dialog
      ref={dialog}
      class={styles.sheet}
      aria-label={props.title}
      onClose={() => props.onClose()}
      onClick={(e) => {
        // ::backdrop を押したときはイベントの対象が <dialog> 自身になる
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div class={styles.inner}>
        <header class={styles.header}>
          <h2 class={styles.title}>{props.title}</h2>
          <button type="button" class={styles.close} aria-label="閉じる" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </header>
        {props.children}
      </div>
    </dialog>
  );
}
