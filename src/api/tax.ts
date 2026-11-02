import { apiRequest } from "./client";
import type { ApiEnvelope } from "./envelope";

export interface TaxCardResult {
  salary: number;
  children: number;
  usage: {
    credit: number;
    debit: number;
    culture: number;
    market: number;
    transit: number;
    excluded: number;
    notCounted: number;
    total: number;
  };
  cultureSeparate: boolean;
  threshold: number;
  remainingToThreshold: number;
  deductible: number;
  basicLimit: number;
  additionalLimit: number;
  basicDeduction: number;
  additionalDeduction: number;
  total: number;
  remainingBasic: number;
  debitSpendToFillBasic: number;
  stage: "no-salary" | "below-threshold" | "deducting" | "basic-limit-reached";
}

export type TaxItemKey = "medical" | "education" | "insurance" | "donation" | "rent";

export interface TaxItemTotal {
  total: number;
  byTarget: Record<string, number>;
}

export interface SalaryIncomeSummary {
  netTotal: number;
  months: number;
  annualized: boolean;
  annualizedNet: number;
  estimatedGross: number;
}

export interface TaxMemberSummary {
  name: string;
  grossSalary: number;
  children: number;
  /** profile: 직접 입력 / estimate: 급여 수입으로 추정 / none: 없음 */
  salarySource: "profile" | "estimate" | "none";
  salaryUsed: number;
  salaryIncome: SalaryIncomeSummary | null;
  card: TaxCardResult;
  medicalThreshold: number;
  items: Partial<Record<TaxItemKey, TaxItemTotal>>;
}

export interface TaxSummary {
  year: number;
  rules: {
    estimated: boolean;
    basedOnYear: number;
    thresholdRate: number;
    medicalThresholdRate: number;
  };
  members: TaxMemberSummary[];
  unassigned: {
    usage: Record<string, number>;
    items: Partial<Record<TaxItemKey, TaxItemTotal>>;
  } | null;
  categories: { categoryId: string; name: string; taxCode: string }[];
  incomeCategories: { categoryId: string; name: string; taxCode: string; countedAsSalary: boolean }[];
  taxCodes: { code: string; label: string }[];
  incomeTaxCodes: { code: string; label: string }[];
  recommendations: { kind: string; member?: string; text: string }[];
}

function unwrap<T>(raw: ApiEnvelope<T>, fallback: string): T {
  if (!raw.success || raw.data === undefined) {
    throw new Error(raw.error?.message || fallback);
  }
  return raw.data;
}

export async function getTaxSummary(year: number) {
  return unwrap(
    await apiRequest<ApiEnvelope<TaxSummary>>(`/api/tax/summary?year=${encodeURIComponent(String(year))}`),
    "연말정산 정보를 불러오지 못했습니다."
  );
}

export async function saveTaxProfile(input: { year: number; memberName: string; grossSalary: number; children: number }) {
  return unwrap(
    await apiRequest<ApiEnvelope<{ saved: true }>>("/api/tax/profile", {
      method: "POST",
      body: JSON.stringify(input)
    }),
    "총급여를 저장하지 못했습니다."
  );
}

export async function saveCategoryTaxCode(categoryId: string, taxCode: string) {
  return unwrap(
    await apiRequest<ApiEnvelope<{ saved: true }>>("/api/tax/category", {
      method: "POST",
      body: JSON.stringify({ categoryId, taxCode })
    }),
    "연말정산 분류를 저장하지 못했습니다."
  );
}
