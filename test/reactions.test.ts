import { describe, expect, it } from "vitest";
import { reactionPercents } from "../src/client/lib/reactions";

describe("reactionPercents", () => {
  it("票がなければ null", () => {
    expect(reactionPercents({ useful: 0, fun: 0, try: 0, more: 0 })).toBeNull();
  });

  it("合計がちょうど 100 になるよう丸める", () => {
    expect(reactionPercents({ useful: 1, fun: 1, try: 1, more: 0 })).toEqual({
      useful: 34,
      fun: 33,
      try: 33,
      more: 0,
    });
    const p = reactionPercents({ useful: 14, fun: 9, try: 11, more: 4 });
    expect(p).toEqual({ useful: 37, fun: 24, try: 29, more: 10 });
  });
});
