import { A } from "@solidjs/router";
import { createResource, Match, Switch } from "solid-js";
import type { HealthResponse } from "../../shared/api";
import button from "../components/button.module.css";
import styles from "./Top.module.css";

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// トップページの本実装は MVP ステップ 11。それまでは作成への導線と接続確認だけを置く。
export function Top() {
  const [health] = createResource(fetchHealth);

  return (
    <main class={styles.page}>
      <h1 class={styles.logo}>LeacTion!</h1>
      <p class={styles.lead}>発表にリアルタイムでコメントといいねを送れるサービス</p>
      <A href="/new" class={`${button.primary} ${button.block} ${styles.cta}`}>
        イベントを作る
      </A>
      <section class={styles.card} aria-live="polite">
        <h2 class={styles.cardTitle}>接続確認</h2>
        <Switch>
          <Match when={health.loading}>
            <p class={styles.muted}>確認中…</p>
          </Match>
          <Match when={health.error}>
            <p class={styles.error}>Worker に接続できませんでした</p>
          </Match>
          <Match when={health()}>
            {(h) => (
              <ul class={styles.list}>
                <li>Worker: OK</li>
                <li>D1: OK（イベント {h().d1.events} 件）</li>
                <li>EventRoom (DO): {h().durableObject.sqlite ? "OK" : "NG"}</li>
              </ul>
            )}
          </Match>
        </Switch>
      </section>
    </main>
  );
}
