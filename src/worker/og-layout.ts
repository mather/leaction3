// イベントの OGP 画像の配置。背景（scripts/ogp-images.ts が描くカード）と、
// その上に Images で重ねる文字（src/worker/og-image.ts）の両方で使う。

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** 背景の白いカード */
export const OG_CARD = { left: 80, top: 65, width: 1040, height: 500, radius: 28 };

/** カードの上部に焼き込むロゴ */
export const OG_LOGO = { top: 100, size: 48 };

/** イベント名を置く範囲。行のまとまりをこの中で上下中央に置く */
export const OG_NAME_AREA = { top: 190, height: 240, maxWidth: 880 };

/** 開催日の行 */
export const OG_DATE = { top: 462, size: 30 };
