// OGP 画像の背景を作る（pnpm ogp:images）。デザインを変えたらこれを直して作り直し、public/ の PNG をコミットする。
// - public/ogp.png       トップページなどの共通の画像
// - public/ogp-event.png イベントの画像の背景。カードの中にイベント名と開催日を Worker が重ねる（src/worker/og-image.ts）
// 色はデザイントークン（docs/ui.md）、書体はロゴが M PLUS Rounded 1c、本文が Zen Kaku Gothic New。

import { writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { OG_CARD, OG_HEIGHT, OG_LOGO, OG_WIDTH } from "../src/worker/og-layout.ts";

const COLOR = {
  surface: "#FFFFFF",
  accent: "#0B6E66",
  accentSoft: "#DDEFEC",
};

type Node = { type: string; props: Record<string, unknown> };

function box(style: Record<string, unknown>, ...children: (Node | string)[]): Node {
  return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

/** 線のアイコン（24×24 の viewBox、stroke 2px）。アプリのアイコンと同じ描き方 */
function icon(path: string, size: number, style: Record<string, unknown>): Node {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
  return {
    type: "img",
    props: {
      width: size,
      height: size,
      src: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
      style: { position: "absolute", opacity: 0.08, ...style },
    },
  };
}

const BUBBLE = '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>';
const HEART = '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>';

/** アクセント色の地に、大きな吹き出しとハートを薄く敷く */
function background(...children: Node[]): Node {
  return box(
    {
      position: "relative",
      width: OG_WIDTH,
      height: OG_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      backgroundColor: COLOR.accent,
    },
    icon(BUBBLE, 320, { left: -40, top: -50 }),
    icon(HEART, 300, { right: -30, bottom: -60 }),
    ...children,
  );
}

const top = background(
  box({ fontFamily: "Logo", fontSize: 150, color: COLOR.surface, letterSpacing: -2 }, "LeacTion!"),
  box(
    { marginTop: 10, fontFamily: "Body", fontWeight: 700, fontSize: 52, color: COLOR.surface },
    "発表に、その場でひとこと。",
  ),
  box(
    { marginTop: 22, fontFamily: "Body", fontWeight: 500, fontSize: 28, color: COLOR.accentSoft },
    "ログインなしで、コメントと「いいね」を送れる",
  ),
);

const event = background(
  box(
    {
      position: "absolute",
      left: OG_CARD.left,
      top: OG_CARD.top,
      width: OG_CARD.width,
      height: OG_CARD.height,
      borderRadius: OG_CARD.radius,
      backgroundColor: COLOR.surface,
      justifyContent: "center",
    },
    box(
      {
        position: "absolute",
        top: OG_LOGO.top - OG_CARD.top,
        fontFamily: "Logo",
        fontSize: OG_LOGO.size,
        lineHeight: 1,
        color: COLOR.accent,
      },
      "LeacTion!",
    ),
  ),
);

/** Google Fonts から TrueType を取る（User-Agent を付けないと TrueType の URL が返る） */
async function loadFont(family: string, weight: number): Promise<ArrayBuffer> {
  const params = new URLSearchParams({ family: `${family}:wght@${weight}` });
  const css = await fetch(`https://fonts.googleapis.com/css2?${params}`);
  if (!css.ok) throw new Error(`font css: ${css.status} ${family} ${weight}`);
  const url = (await css.text()).match(/src: url\((.+?)\) format/)?.[1];
  if (!url) throw new Error(`font not found: ${family} ${weight}`);
  const font = await fetch(url);
  if (!font.ok) throw new Error(`font file: ${font.status} ${family} ${weight}`);
  return font.arrayBuffer();
}

const fonts = [
  { name: "Logo", data: await loadFont("M PLUS Rounded 1c", 800), weight: 800 as const },
  { name: "Body", data: await loadFont("Zen Kaku Gothic New", 700), weight: 700 as const },
  { name: "Body", data: await loadFont("Zen Kaku Gothic New", 500), weight: 500 as const },
];

for (const [file, node] of [
  ["public/ogp.png", top],
  ["public/ogp-event.png", event],
] as const) {
  const svg = await satori(node, { width: OG_WIDTH, height: OG_HEIGHT, fonts });
  await writeFile(file, new Resvg(svg).render().asPng());
  console.log(file);
}
