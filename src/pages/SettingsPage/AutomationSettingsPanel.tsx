import {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  createRecurringTransaction,
  getAutomationSettings,
  processRecurringTransactions,
  saveAutomationSettings
} from "../../api/automation";
import type {
  AutomationSettings,
  BenefitKind,
  BenefitRule,
  RecurringDueItem,
  RecurringMode,
  RecurringTransactionRule
} from "../../api/automation";
import {
  getManagedAccounts,
  getManagedCategories
} from "../../api/settingsManagement";
import type {
  ManagedAccount,
  ManagedCategory
} from "../../api/settingsManagement";
import { markLedgerChanged } from "../../utils/ledgerEvents";
import { clearBootstrapMemoryCache } from "../../api/bootstrapCache";
import { getSeoulDateString } from "../../utils/dateTime";
import styles from "./SettingsPage.module.css";

interface RecurringFormState {
  id: string;
  name: string;
  enabled: boolean;
  mode: RecurringMode;
  dayOfMonth: string;
  startMonth: string;
  endMonth: string;
  type: "지출" | "수입" | "이체";
  amount: string;
  categoryId: string;
  paymentMethodId: string;
  spendingTarget: string;
  fromAccountId: string;
  toAccountId: string;
  description: string;
  memo: string;
}

function createId(prefix: string) {
  if (globalThis.crypto?.randomUUID) {
    return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function emptyRecurringForm(): RecurringFormState {
  return {
    id: "",
    name: "",
    enabled: true,
    mode: "confirm",
    dayOfMonth: "1",
    startMonth: "",
    endMonth: "",
    type: "지출",
    amount: "",
    categoryId: "",
    paymentMethodId: "",
    spendingTarget: "공동",
    fromAccountId: "",
    toAccountId: "",
    description: "",
    memo: ""
  };
}

function recurringToForm(rule: RecurringTransactionRule): RecurringFormState {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    mode: rule.mode,
    dayOfMonth: String(rule.dayOfMonth),
    startMonth: rule.startMonth || "",
    endMonth: rule.endMonth || "",
    type: rule.type,
    amount: String(rule.amount),
    categoryId: rule.categoryId,
    paymentMethodId: rule.paymentMethodId || "",
    spendingTarget: rule.spendingTarget || "공동",
    fromAccountId: rule.fromAccountId || "",
    toAccountId: rule.toAccountId || "",
    description: rule.description,
    memo: rule.memo
  };
}

function formatAmount(value: number) {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function accountLabel(account: ManagedAccount) {
  return account.displayName || account.accountName || account.accountId;
}

function benefitKindLabel(kind: BenefitKind) {
  if (kind === "post_reward") return "결제 후 즉시 적립";
  if (kind === "pre_discount") return "충전 시 선할인";
  return "혜택 없음";
}

function recurringTypeSummary(rule: RecurringTransactionRule) {
  if (rule.mode === "auto") return "자동 등록(앱 열 때)";
  return "확인 후 등록";
}

export default function AutomationSettingsPanel() {
  const [settings, setSettings] = useState<AutomationSettings>({
    version: 1,
    recurringRules: [],
    benefitRules: []
  });
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [dueItems, setDueItems] = useState<RecurringDueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBenefits, setSavingBenefits] = useState(false);
  const [savingRecurring, setSavingRecurring] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState("");
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [recurringForm, setRecurringForm] = useState<RecurringFormState>(emptyRecurringForm);

  const activeAccounts = useMemo(
    () => accounts.filter(account => !account.isDeleted && account.active),
    [accounts]
  );

  const prepaidAccounts = useMemo(
    () => activeAccounts.filter(account => account.subType === "선불/지역화폐"),
    [activeAccounts]
  );

  const spendingTargets = useMemo(() => {
    const names = Array.from(
      new Set(
        activeAccounts
          .map(account => account.owner)
          .filter(owner => owner && owner !== "공동")
      )
    ).sort((a, b) => a.localeCompare(b, "ko"));
    return ["공동", ...names];
  }, [activeAccounts]);

  const recurringCategories = useMemo(
    () => categories.filter(category => !category.isDeleted && category.active && category.type === recurringForm.type),
    [categories, recurringForm.type]
  );

  const currentMonth = getSeoulDateString().slice(0, 7);
  const dueByRuleId = useMemo(
    () => new Map(dueItems.map(item => [item.ruleId, item])),
    [dueItems]
  );

  async function refreshDue() {
    const result = await processRecurringTransactions();
    setDueItems(result.due);
    if (result.created.length > 0) {
      markLedgerChanged();
      setFeedback(`고정 거래 ${result.created.length}건을 자동 등록했습니다.`);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      getAutomationSettings(),
      getManagedAccounts({ includeDeleted: false }),
      getManagedCategories({ includeDeleted: false })
    ])
      .then(async ([automation, accountResult, categoryResult]) => {
        if (!active) return;
        setSettings(automation);
        setAccounts(accountResult.items);
        setCategories(categoryResult.items);
        try {
          const recurring = await processRecurringTransactions();
          if (!active) return;
          setDueItems(recurring.due);
          if (recurring.created.length > 0) {
            markLedgerChanged();
            setFeedback(`고정 거래 ${recurring.created.length}건을 자동 등록했습니다.`);
          }
        } catch {
        }
      })
      .catch(loadError => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "자동화 설정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  function getBenefitRule(accountId: string): BenefitRule {
    return settings.benefitRules.find(rule => rule.accountId === accountId) || {
      id: `BEN_${accountId}`,
      accountId,
      enabled: false,
      kind: "none",
      ratePercent: 0,
      monthlyCap: null,
      validFrom: null,
      validTo: null,
      rewardOpeningBalance: 0
    };
  }

  function updateBenefitRule(accountId: string, patch: Partial<BenefitRule>) {
    const current = getBenefitRule(accountId);
    const next = {
      ...current,
      ...patch,
      accountId
    };
    next.enabled = next.kind !== "none";
    setSettings(previous => ({
      ...previous,
      benefitRules: [
        ...previous.benefitRules.filter(rule => rule.accountId !== accountId),
        next
      ]
    }));
    setFeedback("");
    setError("");
  }

  async function handleSaveBenefits() {
    setSavingBenefits(true);
    setError("");
    setFeedback("");
    try {
      const result = await saveAutomationSettings(settings);
      clearBootstrapMemoryCache();
      setSettings(result.settings);
      setFeedback("지역화폐 혜택 설정을 저장했습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "혜택 설정을 저장하지 못했습니다.");
    } finally {
      setSavingBenefits(false);
    }
  }

  function beginNewRecurring() {
    setRecurringForm(emptyRecurringForm());
    setShowRecurringForm(true);
    setError("");
    setFeedback("");
  }

  function beginEditRecurring(rule: RecurringTransactionRule) {
    setRecurringForm(recurringToForm(rule));
    setShowRecurringForm(true);
    setError("");
    setFeedback("");
  }

  async function persistRecurringRules(nextRules: RecurringTransactionRule[], successMessage: string) {
    const nextSettings: AutomationSettings = {
      ...settings,
      recurringRules: nextRules
    };
    const saved = await saveAutomationSettings(nextSettings);
    clearBootstrapMemoryCache();
    setSettings(saved.settings);
    setFeedback(successMessage);
    await refreshDue();
  }

  async function handleSaveRecurring() {
    const amount = Number(recurringForm.amount);
    const dayOfMonth = Number(recurringForm.dayOfMonth);
    if (!recurringForm.name.trim()) {
      setError("고정 거래 이름을 입력해주세요.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("금액을 입력해주세요.");
      return;
    }
    if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      setError("등록일은 1~31 사이로 입력해주세요.");
      return;
    }
    if (!recurringForm.categoryId) {
      setError("카테고리를 선택해주세요.");
      return;
    }

    const rule: RecurringTransactionRule = {
      id: recurringForm.id || createId("REC"),
      name: recurringForm.name.trim(),
      enabled: recurringForm.enabled,
      mode: recurringForm.mode,
      dayOfMonth,
      startMonth: recurringForm.startMonth || null,
      endMonth: recurringForm.endMonth || null,
      type: recurringForm.type,
      amount,
      categoryId: recurringForm.categoryId,
      paymentMethodId: recurringForm.type === "지출" ? recurringForm.paymentMethodId || null : null,
      spendingTarget: recurringForm.type === "지출" ? recurringForm.spendingTarget || null : null,
      fromAccountId: recurringForm.type === "이체" ? recurringForm.fromAccountId || null : null,
      toAccountId: recurringForm.type === "수입" || recurringForm.type === "이체" ? recurringForm.toAccountId || null : null,
      description: recurringForm.description.trim(),
      memo: recurringForm.memo.trim()
    };

    setSavingRecurring(true);
    setError("");
    setFeedback("");
    try {
      const nextRules = settings.recurringRules.some(item => item.id === rule.id)
        ? settings.recurringRules.map(item => item.id === rule.id ? rule : item)
        : [...settings.recurringRules, rule];
      await persistRecurringRules(nextRules, "고정 거래 설정을 저장했습니다.");
      setShowRecurringForm(false);
      setRecurringForm(emptyRecurringForm());
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "고정 거래 설정을 저장하지 못했습니다.");
    } finally {
      setSavingRecurring(false);
    }
  }

  async function handleDeleteRecurring(rule: RecurringTransactionRule) {
    if (!window.confirm(`'${rule.name}' 고정 거래 설정을 삭제할까요? 이미 생성된 거래는 지워지지 않습니다.`)) return;
    setBusyRuleId(rule.id);
    setError("");
    try {
      await persistRecurringRules(
        settings.recurringRules.filter(item => item.id !== rule.id),
        "고정 거래 설정을 삭제했습니다."
      );
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "고정 거래 설정을 삭제하지 못했습니다.");
    } finally {
      setBusyRuleId("");
    }
  }

  async function handleCreateRecurringNow(rule: RecurringTransactionRule) {
    setBusyRuleId(rule.id);
    setError("");
    setFeedback("");
    try {
      const result = await createRecurringTransaction(rule.id, currentMonth);
      if (result.created.length > 0) {
        markLedgerChanged();
        setFeedback(`'${rule.name}' 거래를 등록했습니다.`);
      } else {
        setFeedback(`'${rule.name}'은 이미 이번 달에 등록되어 있습니다.`);
      }
      setDueItems(result.due);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "고정 거래를 등록하지 못했습니다.");
    } finally {
      setBusyRuleId("");
    }
  }

  if (loading) {
    return <p className={styles.state}>자동화 설정을 불러오는 중입니다.</p>;
  }

  return (
    <div className={styles.settingsBody}>
      {error && <p className={styles.error}>{error}</p>}
      {feedback && <p className={styles.feedback}>{feedback}</p>}

      <section className={styles.cardSection}>
        <div className={styles.sectionHeading}>
          <h2>고정 거래</h2>
          <p>월급·적금·회비처럼 반복되는 거래를 미리 등록합니다. 자동 등록은 해당 날짜 이후 부부 중 한 명이 앱을 처음 열 때 실행됩니다.</p>
        </div>

        {settings.recurringRules.length === 0 ? (
          <p className={styles.emptyState}>아직 등록한 고정 거래가 없습니다.</p>
        ) : (
          <ul className={styles.itemList}>
            {settings.recurringRules.map(rule => {
              const due = dueByRuleId.get(rule.id);
              const accountNames = [
                rule.paymentMethodId,
                rule.fromAccountId,
                rule.toAccountId
              ]
                .filter(Boolean)
                .map(id => activeAccounts.find(account => account.accountId === id))
                .filter(Boolean)
                .map(account => accountLabel(account as ManagedAccount));
              return (
                <li key={rule.id} className={styles.managementRow}>
                  <span className={styles.itemTextGroup}>
                    <strong>{rule.name}</strong>
                    <span>
                      매월 {rule.dayOfMonth}일 · {rule.type} · {formatAmount(rule.amount)} · {recurringTypeSummary(rule)}
                      {accountNames.length > 0 ? ` · ${accountNames.join(" → ")}` : ""}
                    </span>
                  </span>
                  <div className={styles.rowActions}>
                    {rule.enabled && rule.mode === "confirm" && due && !due.alreadyCreated && (
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={Boolean(busyRuleId)}
                        onClick={() => void handleCreateRecurringNow(rule)}
                      >
                        이번 달 등록
                      </button>
                    )}
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={Boolean(busyRuleId)}
                      onClick={() => beginEditRecurring(rule)}
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={Boolean(busyRuleId)}
                      onClick={() => void handleDeleteRecurring(rule)}
                    >
                      삭제
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!showRecurringForm && (
          <div className={styles.rowActions}>
            <button type="button" className={styles.primaryButton} onClick={beginNewRecurring}>
              고정 거래 추가
            </button>
          </div>
        )}

        {showRecurringForm && (
          <div className={styles.formCard}>
            <div className={styles.formHeader}>
              <h2>{recurringForm.id ? "고정 거래 수정" : "고정 거래 추가"}</h2>
              <p>설정한 날짜가 31일인데 해당 월이 더 짧으면 그 달의 마지막 날로 자동 조정합니다.</p>
            </div>

            <div className={styles.automationGrid}>
              <label className={styles.field}>
                <span>이름</span>
                <input
                  value={recurringForm.name}
                  onChange={event => setRecurringForm(current => ({ ...current, name: event.target.value }))}
                  placeholder="예: 월급, 청년도약계좌"
                />
              </label>

              <label className={styles.field}>
                <span>거래 유형</span>
                <select
                  value={recurringForm.type}
                  onChange={event => setRecurringForm(current => ({
                    ...current,
                    type: event.target.value as RecurringFormState["type"],
                    categoryId: "",
                    paymentMethodId: "",
                    fromAccountId: "",
                    toAccountId: ""
                  }))}
                >
                  <option value="지출">지출</option>
                  <option value="수입">수입</option>
                  <option value="이체">이체</option>
                </select>
              </label>

              <label className={styles.field}>
                <span>매월 등록일</span>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={recurringForm.dayOfMonth}
                  onChange={event => setRecurringForm(current => ({ ...current, dayOfMonth: event.target.value }))}
                />
              </label>

              <label className={styles.field}>
                <span>금액</span>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  value={recurringForm.amount}
                  onChange={event => setRecurringForm(current => ({ ...current, amount: event.target.value }))}
                />
              </label>

              <label className={styles.field}>
                <span>등록 방식</span>
                <select
                  value={recurringForm.mode}
                  onChange={event => setRecurringForm(current => ({ ...current, mode: event.target.value as RecurringMode }))}
                >
                  <option value="confirm">확인 후 등록</option>
                  <option value="auto">자동 등록(앱을 열면)</option>
                </select>
              </label>

              <label className={styles.field}>
                <span>카테고리</span>
                <select
                  value={recurringForm.categoryId}
                  onChange={event => setRecurringForm(current => ({ ...current, categoryId: event.target.value }))}
                >
                  <option value="">선택하세요</option>
                  {recurringCategories.map(category => (
                    <option key={category.categoryId} value={category.categoryId}>{category.name}</option>
                  ))}
                </select>
              </label>

              {recurringForm.type === "지출" && (
                <>
                  <label className={styles.field}>
                    <span>결제수단</span>
                    <select
                      value={recurringForm.paymentMethodId}
                      onChange={event => setRecurringForm(current => ({ ...current, paymentMethodId: event.target.value }))}
                    >
                      <option value="">선택하세요</option>
                      {activeAccounts.map(account => (
                        <option key={account.accountId} value={account.accountId}>{accountLabel(account)}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>지출대상</span>
                    <select
                      value={recurringForm.spendingTarget}
                      onChange={event => setRecurringForm(current => ({ ...current, spendingTarget: event.target.value }))}
                    >
                      {spendingTargets.map(target => <option key={target} value={target}>{target}</option>)}
                    </select>
                  </label>
                </>
              )}

              {recurringForm.type === "수입" && (
                <label className={styles.field}>
                  <span>입금수단</span>
                  <select
                    value={recurringForm.toAccountId}
                    onChange={event => setRecurringForm(current => ({ ...current, toAccountId: event.target.value }))}
                  >
                    <option value="">선택하세요</option>
                    {activeAccounts.map(account => (
                      <option key={account.accountId} value={account.accountId}>{accountLabel(account)}</option>
                    ))}
                  </select>
                </label>
              )}

              {recurringForm.type === "이체" && (
                <>
                  <label className={styles.field}>
                    <span>보내는 수단</span>
                    <select
                      value={recurringForm.fromAccountId}
                      onChange={event => setRecurringForm(current => ({ ...current, fromAccountId: event.target.value }))}
                    >
                      <option value="">선택하세요</option>
                      {activeAccounts.map(account => (
                        <option key={account.accountId} value={account.accountId}>{accountLabel(account)}</option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>받는 수단</span>
                    <select
                      value={recurringForm.toAccountId}
                      onChange={event => setRecurringForm(current => ({ ...current, toAccountId: event.target.value }))}
                    >
                      <option value="">선택하세요</option>
                      {activeAccounts.map(account => (
                        <option key={account.accountId} value={account.accountId}>{accountLabel(account)}</option>
                      ))}
                    </select>
                  </label>
                </>
              )}

              <label className={styles.field}>
                <span>시작월</span>
                <input
                  type="month"
                  value={recurringForm.startMonth}
                  onChange={event => setRecurringForm(current => ({ ...current, startMonth: event.target.value }))}
                />
              </label>

              <label className={styles.field}>
                <span>종료월</span>
                <input
                  type="month"
                  value={recurringForm.endMonth}
                  onChange={event => setRecurringForm(current => ({ ...current, endMonth: event.target.value }))}
                />
              </label>

              <label className={styles.field}>
                <span>내용</span>
                <input
                  value={recurringForm.description}
                  onChange={event => setRecurringForm(current => ({ ...current, description: event.target.value }))}
                  placeholder="비우면 고정 거래 이름 사용"
                />
              </label>

              <label className={styles.field}>
                <span>메모</span>
                <input
                  value={recurringForm.memo}
                  onChange={event => setRecurringForm(current => ({ ...current, memo: event.target.value }))}
                />
              </label>
            </div>

            <label className={styles.automationCheckRow}>
              <input
                type="checkbox"
                checked={recurringForm.enabled}
                onChange={event => setRecurringForm(current => ({ ...current, enabled: event.target.checked }))}
              />
              이 고정 거래 사용
            </label>

            <div className={styles.rowActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={savingRecurring}
                onClick={() => {
                  setShowRecurringForm(false);
                  setRecurringForm(emptyRecurringForm());
                }}
              >
                취소
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                disabled={savingRecurring}
                onClick={() => void handleSaveRecurring()}
              >
                {savingRecurring ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className={styles.cardSection}>
        <div className={styles.sectionHeading}>
          <h2>지역화폐 혜택</h2>
          <p>여민전처럼 결제 직후 적립되거나 온누리처럼 충전할 때 선할인되는 혜택을 자동 계산합니다.</p>
        </div>

        {prepaidAccounts.length === 0 ? (
          <p className={styles.emptyState}>선불·지역화폐 계좌가 없습니다.</p>
        ) : (
          <div className={styles.automationBenefitList}>
            {prepaidAccounts.map(account => {
              const rule = getBenefitRule(account.accountId);
              return (
                <div key={account.accountId} className={styles.automationBenefitCard}>
                  <div className={styles.automationBenefitTitle}>
                    <strong>{accountLabel(account)}</strong>
                    <span>{benefitKindLabel(rule.kind)}</span>
                  </div>

                  <div className={styles.automationGrid}>
                    <label className={styles.field}>
                      <span>혜택 방식</span>
                      <select
                        value={rule.kind}
                        onChange={event => updateBenefitRule(account.accountId, { kind: event.target.value as BenefitKind })}
                      >
                        <option value="none">혜택 없음</option>
                        <option value="post_reward">결제 후 즉시 적립</option>
                        <option value="pre_discount">충전 시 선할인</option>
                      </select>
                    </label>

                    <label className={styles.field}>
                      <span>혜택률 (%)</span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.1"
                        disabled={rule.kind === "none"}
                        value={rule.ratePercent || ""}
                        onChange={event => updateBenefitRule(account.accountId, { ratePercent: Number(event.target.value) || 0 })}
                      />
                    </label>

                    <label className={styles.field}>
                      <span>월 최대 혜택</span>
                      <input
                        type="number"
                        min="0"
                        inputMode="numeric"
                        disabled={rule.kind === "none"}
                        placeholder="제한 없으면 비움"
                        value={rule.monthlyCap ?? ""}
                        onChange={event => updateBenefitRule(account.accountId, {
                          monthlyCap: event.target.value === "" ? null : Math.max(0, Number(event.target.value) || 0)
                        })}
                      />
                    </label>

                    {rule.kind === "post_reward" && (
                      <label className={styles.field}>
                        <span>현재 잔액 중 캐시백</span>
                        <input
                          type="number"
                          min="0"
                          inputMode="numeric"
                          value={rule.rewardOpeningBalance || ""}
                          placeholder="예: 12500"
                          onChange={event => updateBenefitRule(account.accountId, {
                            rewardOpeningBalance: Math.max(0, Number(event.target.value) || 0)
                          })}
                        />
                      </label>
                    )}

                    <label className={styles.field}>
                      <span>적용 시작일</span>
                      <input
                        type="date"
                        disabled={rule.kind === "none"}
                        value={rule.validFrom || ""}
                        onChange={event => updateBenefitRule(account.accountId, { validFrom: event.target.value || null })}
                      />
                    </label>

                    <label className={styles.field}>
                      <span>적용 종료일</span>
                      <input
                        type="date"
                        disabled={rule.kind === "none"}
                        value={rule.validTo || ""}
                        onChange={event => updateBenefitRule(account.accountId, { validTo: event.target.value || null })}
                      />
                    </label>
                  </div>

                  {rule.kind === "post_reward" && (
                    <p className={styles.automationNote}>
                      여민전 앱에 표시된 전체 사용 가능 잔액 중 캐시백 금액만 입력하세요. 이 금액은 자산에 추가로 더해지지 않고 총잔액의 구성만 추적합니다. 이후 적립·사용액은 자동 반영되며, 결제에서 사용한 캐시백에는 새 캐시백이 붙지 않습니다.
                    </p>
                  )}

                  {rule.kind === "pre_discount" && (
                    <p className={styles.automationNote}>
                      ‘지역화폐충전’ 이체에서 충전액 전체를 받는 계좌에 넣고, 보내는 계좌에서는 선할인을 뺀 실제 금액만 출금되도록 자동 기록합니다.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className={styles.rowActions}>
          <button
            type="button"
            className={styles.primaryButton}
            disabled={savingBenefits}
            onClick={() => void handleSaveBenefits()}
          >
            {savingBenefits ? "저장 중..." : "혜택 설정 저장"}
          </button>
        </div>
      </section>
    </div>
  );
}
