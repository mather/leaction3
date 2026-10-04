import { createMemo } from "solid-js";
import { encode } from "uqr";

/**
 * QR コードを端末内で生成して SVG で描く。URL を外部サービスに渡さない。
 * 黒いモジュールを 1 本の path にまとめる（innerHTML は使わない）。
 */
export function QrCode(props: { value: string; label: string; size?: number }) {
  const qr = createMemo(() => {
    // 会場のスクリーンに映して遠くから読むことがあるので、誤り訂正は M にする
    const { data, size } = encode(props.value, { ecc: "M", border: 4 });
    let d = "";
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { d, size };
  });

  return (
    <svg
      role="img"
      aria-label={props.label}
      width={props.size ?? 200}
      height={props.size ?? 200}
      viewBox={`0 0 ${qr().size} ${qr().size}`}
      shape-rendering="crispEdges"
    >
      {/* ダークモードでも読み取れるよう、背景は常に白・模様は常に黒 */}
      <rect width="100%" height="100%" fill="#fff" />
      <path d={qr().d} fill="#000" />
    </svg>
  );
}
