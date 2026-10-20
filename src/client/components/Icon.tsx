import type { JSX } from "solid-js";
import styles from "./Icon.module.css";

// 線のアイコン（stroke 2px）。docs/ui.md「デザイントークン」を参照。
// Solid の JSX は実 DOM なので、使うたびに作り直せるよう関数で持つ。
// 塗りつぶしたときに消えてしまう中の線は styles.detail（線を白で抜く）か
// styles.solid（白で塗る）にする。
const PATHS = {
  copy: () => (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  check: () => <path d="M5 12.5l4.5 4.5L19 7" />,
  download: () => (
    <>
      <path d="M12 3v12" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M5 19h14" />
    </>
  ),
  plus: () => <path d="M12 5v14M5 12h14" />,
  close: () => <path d="M6 6l12 12M18 6L6 18" />,
  chevron: () => <path d="M9 6l6 6-6 6" />,
  chevronLeft: () => <path d="M15 6l-6 6 6 6" />,
  share: () => (
    <>
      <path d="M12 3v12" />
      <path d="M7.5 7.5L12 3l4.5 4.5" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </>
  ),
  menu: () => <path d="M4 7h16M4 12h16M4 17h16" />,
  send: () => <path d="M4 12l16-8-6 16-2.5-6.5z" />,
  external: () => (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  link: () => (
    <>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1" />
    </>
  ),
  arrowDown: () => <path d="M12 5v14M6 13l6 6 6-6" />,
  comment: () => <path d="M4 5h16v11H9l-5 4z" />,
  heart: () => (
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.4C19.5 15.4 12 20 12 20z" />
  ),
  trash: () => (
    <>
      <path d="M4 7h16" />
      <path d="M9.5 7V4.5h5V7" />
      <path d="M6 7l1 13h10l1-13" />
    </>
  ),
  grip: () => (
    <>
      <path d="M9 6v.01M15 6v.01M9 12v.01M15 12v.01M9 18v.01M15 18v.01" />
    </>
  ),
  alert: () => (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
  // 発表への感想
  bulb: () => (
    <>
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2v.5h5V16c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
      <path d="M9.5 19h5M10.5 21.5h3" />
      <path class={styles.detail} d="M12 16.5v-4" />
    </>
  ),
  laugh: () => (
    <>
      <path d="M7 17H5.5A2.5 2.5 0 0 1 3 14.5v-8A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v8a2.5 2.5 0 0 1-2.5 2.5H12l-5 4z" />
      <path class={styles.detail} d="M8.5 8.5l1.3-1.3 1.3 1.3M12.9 8.5l1.3-1.3 1.3 1.3" />
      <path class={styles.solid} d="M8.5 11h7a3.5 3.5 0 0 1-7 0z" />
    </>
  ),
  flask: () => (
    <>
      <path d="M10 3.5v5.2L4.9 17.4A2 2 0 0 0 6.6 20.5h10.8a2 2 0 0 0 1.7-3.1L14 8.7V3.5" />
      <path d="M8.5 3.5h7" />
      <path class={styles.detail} d="M7.2 15h9.6" />
    </>
  ),
  search: () => (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.3 15.3l5.2 5.2" />
      <path class={styles.detail} d="M8 10.5a2.5 2.5 0 0 1 2.5-2.5" />
    </>
  ),
} satisfies Record<string, () => JSX.Element>;

export type IconName = keyof typeof PATHS;

/** filled は塗りつぶし（いいね済みなど） */
export function Icon(props: { name: IconName; size?: number; filled?: boolean }) {
  return (
    <svg
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 24 24"
      fill={props.filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      data-filled={props.filled ? "" : undefined}
    >
      {PATHS[props.name]()}
    </svg>
  );
}
