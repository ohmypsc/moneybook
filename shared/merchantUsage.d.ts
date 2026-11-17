export interface MerchantUsage {
  merchant: string;
  type: string;
  categoryId: string;
  count: number;
  lastDate: string;
}
export declare const MERCHANT_USAGE_DAYS: number;
export declare const MERCHANT_USAGE_LIMIT: number;
export declare function normalizeMerchantKey(value: unknown): string;
export declare function merchantMatchStrength(firstKey: string, secondKey: string): 0 | 1 | 2;
export declare function merchantUsageCounts(
  transactions: Array<Record<string, unknown>>,
  today: string,
  days?: number,
  limit?: number
): MerchantUsage[];
export declare function merchantCategoryIds(
  merchant: string,
  type: string,
  usage: MerchantUsage[] | null | undefined,
  availableIds?: Iterable<string> | null,
  limit?: number
): string[];
