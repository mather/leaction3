// イベントごとの OGP 画像（1200×630）を Images バインディングで描く。
// 背景（public/ogp-event.png、scripts/ogp-images.ts で作る）には白いカードとロゴを焼き込んであり、
// イベント名と開催日だけを重ねる。配置は og-layout.ts で背景と揃える。
// Images の文字描画は折り返し・中央揃え・省略をしないので、行分けはここで行い、1 行ずつ描く
// （位置を top だけ指定すると横方向は中央に置かれる）。

import { OG_DATE, OG_NAME_AREA } from "./og-layout";
import { formatDate, type OgpEvent } from "./ogp";

/** カードとロゴを焼き込んだ背景 */
export const OG_IMAGE_BACKGROUND = "/ogp-event.png";

/** Images が URL から読む。Google Fonts の Zen Kaku Gothic New Bold（全文字入りの TrueType） */
const FONT_URL =
  "https://fonts.gstatic.com/s/zenkakugothicnew/v19/gNMVW2drQpDw0GjzrVNFf_valaDBcznOqodNaWQ.ttf";

/** デザイントークン（docs/ui.md）の --text と --accent */
const TEXT_COLOR = "#1B1F24";
const ACCENT_COLOR = "#0B6E66";

const LINE_HEIGHT = 1.3;
/** 大きい順に試し、範囲に収まる最初の大きさを使う。最小でも収まらなければ末尾を省略する */
const NAME_FONT_SIZES = [72, 60, 48];

/**
 * 1 文字の幅（em）の見積もり。文字幅を測る手段がないので、はみ出さないよう広めに見積もる。
 * 実測（Zen Kaku Gothic New Bold）では、和欧混じりの名前で実際より 1 割ほど広くなる。
 */
function charWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x1100) return 1; // 和文（全角）
  if (char === " ") return 0.3;
  if (/[MW@%]/.test(char)) return 0.95; // 幅の広い字
  if (/[mw]/.test(char)) return 0.85;
  if (/[a-z]/.test(char)) return 0.55;
  return 0.65; // 大文字・数字・記号
}

function textWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) width += charWidth(char);
  return width * size;
}

/** maxWidth に収まるよう行に分ける。英数字の単語は途中で切らず、1 行に収まらない単語だけ文字単位で切る */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (piece: string) => {
    if (line === "" && piece === " ") return; // 行頭の空白は捨てる
    if (textWidth(line + piece, size) <= maxWidth) {
      line += piece;
    } else if (line !== "") {
      lines.push(line.trimEnd());
      line = "";
      push(piece);
    } else if ([...piece].length > 1) {
      for (const char of piece) push(char);
    } else {
      line = piece; // 1 文字でも収まらないことはないが、念のため無限に分けない
    }
  };
  // 英数字の連なり・空白・それ以外の 1 文字に分ける
  const pieces =
    text
      .replace(/\s+/g, " ")
      .trim()
      .match(/[!-~]+| |./gu) ?? [];
  for (const piece of pieces) push(piece);
  if (line !== "") lines.push(line.trimEnd());
  return lines;
}

/** 行の末尾を「…」にして maxWidth に収める */
function withEllipsis(line: string, size: number, maxWidth: number): string {
  const chars = [...line];
  while (chars.length > 0 && textWidth(`${chars.join("")}…`, size) > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

/** イベント名の文字の大きさと行。名前が長いほど小さくし、最小でも収まらなければ省略する */
export function layoutName(name: string): { size: number; lines: string[] } {
  const { height, maxWidth } = OG_NAME_AREA;
  for (const size of NAME_FONT_SIZES) {
    const lines = wrapText(name, size, maxWidth);
    if (lines.length * size * LINE_HEIGHT <= height) return { size, lines };
  }
  const size = NAME_FONT_SIZES.at(-1) ?? 48;
  const maxLines = Math.max(1, Math.floor(height / (size * LINE_HEIGHT)));
  const lines = wrapText(name, size, maxWidth).slice(0, maxLines);
  lines[maxLines - 1] = withEllipsis(lines[maxLines - 1] ?? "", size, maxWidth);
  return { size, lines };
}

/** background は OG_IMAGE_BACKGROUND の中身。描画に失敗したら例外（無料枠を使い切ったときなど） */
export async function renderOgImage(
  images: ImagesBinding,
  event: OgpEvent,
  background: ReadableStream<Uint8Array>,
): Promise<Response> {
  const { size, lines } = layoutName(event.name);
  const lineHeight = size * LINE_HEIGHT;
  // 行のまとまりを範囲の上下中央に置く
  const top = OG_NAME_AREA.top + (OG_NAME_AREA.height - lines.length * lineHeight) / 2;
  let image = images.input(background);
  lines.forEach((line, i) => {
    image = image.draw(images.text(line, { font: { url: FONT_URL }, size, color: TEXT_COLOR }), {
      top: Math.round(top + i * lineHeight + (lineHeight - size) / 2),
    });
  });
  image = image.draw(
    images.text(`${formatDate(event.date)}開催`, {
      font: { url: FONT_URL },
      size: OG_DATE.size,
      color: ACCENT_COLOR,
    }),
    { top: OG_DATE.top },
  );
  return (await image.output({ format: "image/png" })).response();
}
