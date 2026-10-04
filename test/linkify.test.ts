import { describe, expect, it } from "vitest";
import { linkify } from "../src/client/lib/linkify";

describe("linkify", () => {
  it("URL をリンクにし、前後はテキストのまま", () => {
    expect(linkify("資料は https://example.com/slides です")).toEqual([
      { type: "text", text: "資料は " },
      { type: "url", text: "https://example.com/slides", url: "https://example.com/slides" },
      { type: "text", text: " です" },
    ]);
  });

  it("全角の句読点・括弧や末尾の記号は URL に含めない", () => {
    const urls = (body: string) => linkify(body).flatMap((s) => (s.type === "url" ? [s.text] : []));
    expect(urls("見て→https://example.com/a。")).toEqual(["https://example.com/a"]);
    expect(urls("（https://example.com/b）")).toEqual(["https://example.com/b"]);
    expect(urls("(https://example.com/c)")).toEqual(["https://example.com/c"]);
    expect(urls("https://ja.wikipedia.org/wiki/A_(B) を参照")).toEqual([
      "https://ja.wikipedia.org/wiki/A_(B)",
    ]);
    expect(urls("https://example.com/d, https://example.com/e!")).toEqual([
      "https://example.com/d",
      "https://example.com/e",
    ]);
  });

  it("http(s) 以外や HTML はテキストのまま", () => {
    expect(linkify("javascript:alert(1) <b>x</b>")).toEqual([
      { type: "text", text: "javascript:alert(1) <b>x</b>" },
    ]);
  });

  it("空の本文は空", () => {
    expect(linkify("")).toEqual([]);
  });
});
