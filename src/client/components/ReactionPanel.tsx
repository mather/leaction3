import { createSignal, For, Show } from "solid-js";
import { REACTION_KINDS, type ReactionCounts, type ReactionKind } from "../../shared/protocol";
import { reactionPercents, reactionTotal } from "../lib/reactions";
import { loadReactionsOpen, saveReactionsOpen } from "../lib/reactions-open";
import { Icon, type IconName } from "./Icon";
import styles from "./ReactionPanel.module.css";

/** title はマウスオーバーと読み上げに使う */
const REACTIONS: Record<
  ReactionKind,
  { label: string; title: string; icon: IconName; color: string }
> = {
  useful: { label: "ためになる", title: "ためになる", icon: "bulb", color: "var(--r-useful)" },
  fun: { label: "おもしろい", title: "おもしろい", icon: "laugh", color: "var(--r-fun)" },
  try: { label: "試したい", title: "試したい", icon: "flask", color: "var(--r-try)" },
  more: { label: "くわしく", title: "くわしく知りたい", icon: "search", color: "var(--r-more)" },
};

/**
 * 発表への感想の枠（docs/ui.md「感想」）。1 人 1 票で、選んでいるものをもう一度押すと取り消す。
 * 見出しで畳め、畳んでいる間も小さな横棒と票数を出す
 */
export function ReactionPanel(props: {
  counts: ReactionCounts;
  mine: ReactionKind | null;
  /** 押せないとき（接続が切れている間など） */
  disabled: boolean;
  onSelect: (kind: ReactionKind | null) => void;
}) {
  const [open, setOpen] = createSignal(loadReactionsOpen());
  const toggle = () => {
    const next = !open();
    setOpen(next);
    saveReactionsOpen(next);
  };
  const total = () => reactionTotal(props.counts);
  const percents = () => reactionPercents(props.counts);
  const summary = () => {
    const p = percents();
    if (!p) return "まだ感想はありません";
    return REACTION_KINDS.map((k) => `${REACTIONS[k].title} ${p[k]}%`).join("、");
  };
  const hint = () => {
    if (props.mine) return "もう一度押すと取り消せます";
    return percents()
      ? "1 つ選んで送れます。あとから変えられます"
      : "まだ感想はありません。最初の 1 票をどうぞ";
  };

  return (
    <section class={styles.panel} data-closed={open() ? undefined : ""}>
      <button
        type="button"
        class={styles.head}
        aria-expanded={open()}
        aria-controls="reaction-body"
        onClick={toggle}
      >
        <span class={styles.chevron}>
          <Icon name="chevron" size={18} />
        </span>
        <span class={styles.title}>この発表の感想</span>
        <Show when={!open()}>
          <Bar counts={props.counts} class={styles.miniBar} />
        </Show>
        <span class={styles.total}>
          <b>{total()}</b> 票
        </span>
      </button>
      <Show when={open()}>
        <div class={styles.body} id="reaction-body">
          <div role="img" aria-label={summary()}>
            <Bar counts={props.counts} />
          </div>
          <div class={styles.choices}>
            <For each={REACTION_KINDS}>
              {(kind) => {
                const r = REACTIONS[kind];
                const selected = () => props.mine === kind;
                const percent = () => {
                  const p = percents();
                  return p ? `${p[kind]}%` : "—";
                };
                return (
                  <button
                    type="button"
                    class={styles.choice}
                    style={{ "--c": r.color }}
                    title={r.title}
                    aria-label={`${r.title}、${percents()?.[kind] ?? 0}%`}
                    aria-pressed={selected()}
                    disabled={props.disabled}
                    onClick={() => props.onSelect(selected() ? null : kind)}
                  >
                    <span class={styles.icon}>
                      <Icon name={r.icon} size={28} filled={selected()} />
                    </span>
                    <span class={styles.label}>{r.label}</span>
                    <span class={styles.percent}>{percent()}</span>
                  </button>
                );
              }}
            </For>
          </div>
          <p class={styles.hint}>{hint()}</p>
        </div>
      </Show>
    </section>
  );
}

/** 割合の積み上げ横棒。票がなければ地の色だけ。読み上げは呼び出し側で添える */
function Bar(props: { counts: ReactionCounts; class?: string }) {
  return (
    <span class={`${styles.bar} ${props.class ?? ""}`} aria-hidden="true">
      <For each={REACTION_KINDS}>
        {(kind) => (
          <Show when={props.counts[kind] > 0}>
            <span style={{ background: REACTIONS[kind].color, "flex-grow": props.counts[kind] }} />
          </Show>
        )}
      </For>
    </span>
  );
}
