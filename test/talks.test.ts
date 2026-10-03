import { describe, expect, it } from "vitest";
import { commentPlaceholder, pickInitialTalk, talkLabel } from "../src/client/lib/talks";

const talks = [
  { id: "talk0001", speaker: "山田", title: "SolidJS 入門" },
  { id: "talk0002", speaker: "佐藤", title: "" },
  { id: "talk0003", speaker: "", title: "飛び入り" },
];

describe("pickInitialTalk", () => {
  it("?tid= を最優先する", () => {
    expect(pickInitialTalk(talks, { tid: "talk0003", lastViewed: "talk0002" })).toBe("talk0003");
  });

  it("?tid= がなければ前回見ていた発表", () => {
    expect(pickInitialTalk(talks, { tid: null, lastViewed: "talk0002" })).toBe("talk0002");
  });

  it("存在しない ID は飛ばして 1 番目", () => {
    expect(pickInitialTalk(talks, { tid: "gone0001", lastViewed: "gone0002" })).toBe("talk0001");
  });

  it("発表枠がなければ undefined", () => {
    expect(pickInitialTalk([], { tid: "talk0001" })).toBeUndefined();
  });
});

describe("talkLabel / commentPlaceholder", () => {
  it("発表者とタイトルの片方が空でも読める", () => {
    expect(talks.map(talkLabel)).toEqual(["山田／SolidJS 入門", "佐藤", "飛び入り"]);
    expect(talks.map(commentPlaceholder)).toEqual([
      "山田さんの発表にコメント",
      "佐藤さんの発表にコメント",
      "「飛び入り」にコメント",
    ]);
  });
});
