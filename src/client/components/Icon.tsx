import type { JSX } from "solid-js";

// 線のアイコン（stroke 2px）。docs/ui.md「デザイントークン」を参照。
// Solid の JSX は実 DOM なので、使うたびに作り直せるよう関数で持つ。
const PATHS = {
  copy: () => (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </>
  ),
  check: () => <path d="M5 12.5l4.5 4.5L19 7" />,
  mail: () => (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5L12 13l8.5-6.5" />
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
  alert: () => (
    <>
      <path d="M12 3l9.5 17h-19z" />
      <path d="M12 10v4M12 17.5v.01" />
    </>
  ),
} satisfies Record<string, () => JSX.Element>;

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName; size?: number }) {
  return (
    <svg
      width={props.size ?? 20}
      height={props.size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[props.name]()}
    </svg>
  );
}
