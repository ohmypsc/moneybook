/*
 * 금액형 상품(발행어음·달러어음·IMA·RP 등)
 *
 * 주가가 없는 상품은 "1단위 = 1원(또는 1달러)"로 보고 수량 자리에 금액을 저장합니다.
 * 평가단가(수동시세)는 원금 1단위가 지금 얼마인지(이자 포함)를 뜻합니다.
 * 예) 원금 10,000달러가 10,120달러가 됐으면 평가단가는 1.012입니다.
 *
 * 금액형 상품은 종목코드를 AMT- 로 시작하게 만들어 일반 종목과 구분합니다.
 */

export const AMOUNT_PRODUCT_CODE_PREFIX = "AMT-";

export function isAmountProductCode(stockCode: string | null | undefined) {
  return String(stockCode || "")
    .trim()
    .toUpperCase()
    .startsWith(AMOUNT_PRODUCT_CODE_PREFIX);
}

export function makeAmountProductCode(now = Date.now(), random = Math.random()) {
  const stamp = now.toString(36).toUpperCase();
  const tail = Math.floor(random * 36 * 36)
    .toString(36)
    .toUpperCase()
    .padStart(2, "0");

  return `${AMOUNT_PRODUCT_CODE_PREFIX}${stamp}${tail}`;
}

export function amountProductUnitPrice(manualPrice: number | null | undefined, currentPrice = 0) {
  const value = Number(manualPrice ?? currentPrice);

  return Number.isFinite(value) && value > 0 ? value : 1;
}

export type AmountTradeUnits = {
  quantity: number;
  unitPrice: number;
};

/*
 * 금액을 매매 수량·단가로 바꿉니다.
 * - 매수: 현재 평가단가로 단위를 더 사므로 기존 수익률이 흐트러지지 않습니다.
 * - 일부 해지: 현재 평가단가 기준으로 받은 금액만큼 단위를 줄입니다.
 * - 전액 해지: 남은 단위를 모두 팔고, 받은 금액으로 단가를 역산합니다(이자가 실현손익이 됩니다).
 */
export function amountToTradeUnits(input: {
  tradeType: "매수" | "매도";
  amount: number;
  unitPrice: number;
  heldQuantity?: number;
  closeAll?: boolean;
}): AmountTradeUnits | null {
  const { tradeType, amount, unitPrice } = input;

  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (tradeType === "매도" && input.closeAll) {
    const held = Number(input.heldQuantity || 0);

    if (!(held > 0)) return null;

    return { quantity: held, unitPrice: amount / held };
  }

  const price = Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : 1;

  return { quantity: amount / price, unitPrice: price };
}
