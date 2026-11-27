// 투자 관련 순수 로직

// 보유종목의 거래통화는 가장 최근 매매의 통화를 따릅니다.
export function holdingCurrencies(trades) {
  const latest = new Map();
  for (const trade of trades || []) {
    if (trade.isDeleted || !trade.currency) continue;
    const key = `${trade.date || ""}|${trade.createdAt || ""}`;
    const current = latest.get(trade.holdingId);
    if (!current || key > current.key)
      latest.set(trade.holdingId, { key, currency: trade.currency });
  }
  return new Map(Array.from(latest, ([id, item]) => [id, item.currency]));
}
