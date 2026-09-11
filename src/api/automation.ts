import { apiRequest } from "./client";
import { unwrapEnvelope } from "./envelope";
import type { ApiEnvelope } from "./envelope";
import type { TransactionType } from "../types/api";

export type BenefitKind = "none" | "post_reward" | "pre_discount";
export type RecurringMode = "confirm" | "auto";

export interface BenefitRule {
  id: string;
  accountId: string;
  enabled: boolean;
  kind: BenefitKind;
  ratePercent: number;
  monthlyCap: number | null;
  validFrom: string | null;
  validTo: string | null;
  rewardOpeningBalance: number;
}

export interface RecurringTransactionRule {
  id: string;
  name: string;
  enabled: boolean;
  mode: RecurringMode;
  dayOfMonth: number;
  startMonth: string | null;
  endMonth: string | null;
  type: TransactionType;
  amount: number;
  categoryId: string;
  paymentMethodId: string | null;
  spendingTarget: string | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  description: string;
  memo: string;
}

export interface AutomationSettings {
  version: 1;
  recurringRules: RecurringTransactionRule[];
  benefitRules: BenefitRule[];
}

export interface RecurringDueItem {
  ruleId: string;
  ruleName: string;
  month: string;
  date: string;
  alreadyCreated: boolean;
  enabled: boolean;
  mode: RecurringMode;
}

export interface RecurringProcessResult {
  created: Array<{
    ruleId: string;
    ruleName: string;
    transactionId: string;
    month: string;
    date: string;
  }>;
  due: RecurringDueItem[];
}

export interface SaveAutomationSettingsResult {
  settings: AutomationSettings;
  updatedAt: string;
  updatedBy: string;
}

export interface BenefitPreview {
  kind: "post_reward" | "pre_discount";
  ratePercent: number;
  benefitAmount: number;
  faceAmount: number;
  actualAmount: number;
  eligibleAmount: number;
  rewardBalanceBefore: number;
  rewardUsedAmount: number;
  rewardBalanceAfter: number;
  maxRewardUsable: number;
}

function post<T>(path: string, body: Record<string, unknown>) {
  return apiRequest<ApiEnvelope<T> | T>(path, {
    method: "POST",
    body: JSON.stringify(body)
  }).then(raw => unwrapEnvelope<T>(raw));
}

export async function getAutomationSettings() {
  const raw = await apiRequest<ApiEnvelope<AutomationSettings> | AutomationSettings>(
    "/api/settings/automation"
  );
  return unwrapEnvelope<AutomationSettings>(raw);
}

export async function saveAutomationSettings(settings: AutomationSettings) {
  return post<SaveAutomationSettingsResult>(
    "/api/settings/automation",
    { settings }
  );
}

export async function processRecurringTransactions() {
  return post<RecurringProcessResult>(
    "/api/automations/recurring/process",
    {}
  );
}

export async function createRecurringTransaction(ruleId: string, month?: string) {
  return post<RecurringProcessResult>(
    "/api/automations/recurring/create",
    { ruleId, month }
  );
}

export async function previewBenefit(input: {
  date: string;
  type: TransactionType;
  amount: number;
  categoryId: string;
  paymentMethodId?: string;
  toAccountId?: string;
  benefitRuleId: string;
  benefitFaceAmount?: number;
  benefitRewardUsedAmount?: number;
  benefitAccrualEnabled?: boolean;
}) {
  return post<BenefitPreview | null>(
    "/api/benefits/preview",
    input as unknown as Record<string, unknown>
  );
}
