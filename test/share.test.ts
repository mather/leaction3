import { describe, expect, it } from "vitest";
import { xPostUrl } from "../src/client/lib/share";
import { splitHashtags, uniqueHashtags } from "../src/shared/schema";

describe("xPostUrl", () => {
  it("本文と URL を渡し、サービスのハッシュタグを付ける", () => {
    const u = new URL(
      xPostUrl({ url: "https://example.com/e/abc", text: "LT 会 #1", hashtags: [] }),
    );
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("LT 会 #1");
    expect(u.searchParams.get("url")).toBe("https://example.com/e/abc");
    expect(u.searchParams.get("hashtags")).toBe("leaction");
  });

  it("イベントのハッシュタグがあれば、すべて先に付ける", () => {
    const u = new URL(
      xPostUrl({ url: "https://example.com/e/abc", text: "LT", hashtags: ["勉強会", "collab"] }),
    );
    expect(u.searchParams.get("hashtags")).toBe("勉強会,collab,leaction");
  });

  it("イベントのハッシュタグにサービスのものと同じものがあれば重ねない", () => {
    const u = new URL(
      xPostUrl({ url: "https://example.com/e/abc", text: "LT", hashtags: ["LeacTion", "ltkai"] }),
    );
    expect(u.searchParams.get("hashtags")).toBe("LeacTion,ltkai");
  });
});

describe("splitHashtags", () => {
  it.each([
    ["#ltkai #collab", ["ltkai", "collab"]],
    ["  ＃ltkai　＃collab  ", ["ltkai", "collab"]],
    ["ltkai,collab、勉強会", ["ltkai", "collab", "勉強会"]],
    ["#ltkai#collab", ["ltkai", "collab"]],
    ["", []],
    [" # ", []],
  ])("%j", (text, expected) => {
    expect(splitHashtags(text)).toEqual(expected);
  });
});

describe("uniqueHashtags", () => {
  it("大文字小文字だけが違うものは先に出たほうを残す", () => {
    expect(uniqueHashtags(["LTkai", "collab", "ltkai"])).toEqual(["LTkai", "collab"]);
  });
});
