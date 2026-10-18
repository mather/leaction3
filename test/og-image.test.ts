import { describe, expect, it } from "vitest";
import { layoutName, wrapText } from "../src/worker/og-image";

describe("wrapText", () => {
  it("英数字の単語は途中で切らない", () => {
    expect(wrapText("フロントエンド勉強会 Cloudflare", 60, 740)).toEqual([
      "フロントエンド勉強会",
      "Cloudflare",
    ]);
  });

  it("1 行に収まらない単語は文字単位で切る", () => {
    const lines = wrapText("W".repeat(40), 60, 740);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("W".repeat(40));
  });

  it("連続する空白はまとめ、行頭と行末の空白は落とす", () => {
    expect(wrapText("  LT   会  ", 72, 740)).toEqual(["LT 会"]);
  });
});

describe("layoutName", () => {
  it("短い名前は大きく 1 行で", () => {
    expect(layoutName("LT 会 #1")).toEqual({ size: 72, lines: ["LT 会 #1"] });
  });

  it("長い名前は小さくして 3 行までに収め、超えたら末尾を省略する", () => {
    const { size, lines } = layoutName("あ".repeat(100));
    expect(size).toBe(48);
    expect(lines).toHaveLength(3);
    expect(lines[2]?.endsWith("…")).toBe(true);
  });
});
