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
