import { describe, expect, it } from "vitest";
import { xPostUrl } from "../src/client/lib/share";

describe("xPostUrl", () => {
  it("本文と URL を渡す", () => {
    const u = new URL(
      xPostUrl({ url: "https://example.com/e/abc", text: "LT 会 #1", hashtag: null }),
    );
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("LT 会 #1");
    expect(u.searchParams.get("url")).toBe("https://example.com/e/abc");
    expect(u.searchParams.has("hashtags")).toBe(false);
  });

  it("ハッシュタグがあれば付ける", () => {
    const u = new URL(
      xPostUrl({ url: "https://example.com/e/abc", text: "LT", hashtag: "勉強会" }),
    );
    expect(u.searchParams.get("hashtags")).toBe("勉強会");
  });
});
