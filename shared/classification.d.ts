export interface ClassificationRule {
  id: string;
  name: string;
  type: "수입" | "지출" | "이체";
  contains: string;
  accountId: string;
  categoryId: string;
  tags: string[];
  enabled: boolean;
  priority: number;
}
export interface Classifiable {
  type: string;
  description?: string;
  categoryId?: string | null;
  categorySource?: string;
  tags?: string[];
  paymentMethodId?: string | null;
  fromAccountId?: string | null;
  toAccountId?: string | null;
}
export function normalizeTags(value?: string[] | string): string[];
export function normalizeRules(value: unknown): ClassificationRule[];
export function classifyTransaction(
  transaction: Classifiable,
  rules?: ClassificationRule[],
  categories?: { categoryId: string; type: string; active?: boolean; isDeleted?: boolean }[]
): { categoryId: string; categorySource: string; tags: string[]; matchedNames: string[] };
