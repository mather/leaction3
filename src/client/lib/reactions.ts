import { REACTION_KINDS, type ReactionCounts } from "../../shared/protocol";

// 発表への感想（docs/ui.md「感想」）の票数の計算。表示は components/ReactionPanel.tsx

export function emptyReactionCounts(): ReactionCounts {
  return { useful: 0, fun: 0, try: 0, more: 0 };
}

export function reactionTotal(counts: ReactionCounts): number {
  return REACTION_KINDS.reduce((sum, k) => sum + counts[k], 0);
}

/**
 * 割合（整数の %）。合計がちょうど 100 になるよう最大剰余法で丸める。
 * 剰余が同じなら並び順の前のものに足す。票がなければ null
 */
export function reactionPercents(counts: ReactionCounts): ReactionCounts | null {
  const total = reactionTotal(counts);
  if (total === 0) return null;
  const parts = REACTION_KINDS.map((kind) => {
    const exact = (counts[kind] * 100) / total;
    return { kind, value: Math.floor(exact), rest: exact - Math.floor(exact) };
  });
  let left = 100 - parts.reduce((sum, p) => sum + p.value, 0);
  for (const p of [...parts].sort((a, b) => b.rest - a.rest)) {
    if (left === 0) break;
    p.value += 1;
    left -= 1;
  }
  const result = emptyReactionCounts();
  for (const p of parts) result[p.kind] = p.value;
  return result;
}
