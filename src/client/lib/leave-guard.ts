import { useBeforeLeave } from "@solidjs/router";
import { createEffect, onCleanup } from "solid-js";

/**
 * when() が真の間だけ、ページを離れる前に確認を出す（docs/ui.md「不意の離脱を防ぐ」）。
 * タブを閉じる・再読み込み・外部への遷移は beforeunload（ブラウザ標準の確認）、
 * アプリ内の画面遷移は Solid Router の useBeforeLeave で確認する。
 * 常に登録すると毎回確認が出て煩わしいので、when() が偽の間は beforeunload を外しておく。
 */
export function useLeaveGuard(when: () => boolean, message: string) {
  createEffect(() => {
    if (!when()) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 古いブラウザは returnValue が設定されたときだけ確認を出す
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    onCleanup(() => window.removeEventListener("beforeunload", onBeforeUnload));
  });

  useBeforeLeave((e) => {
    if (!when() || e.defaultPrevented) return;
    e.preventDefault();
    // 遷移の処理が終わってから確認を出す（Solid Router のドキュメントと同じ手順）
    setTimeout(() => {
      if (window.confirm(message)) e.retry(true);
    }, 100);
  });
}
