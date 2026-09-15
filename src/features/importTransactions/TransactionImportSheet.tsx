import { useMemo, useState } from "react";
import { analyzeTransactionImport, type ImportedTransactionCandidate } from "../../api/transactionImport";
import type { BootstrapData } from "../../types/bootstrap";
import { BottomSheet } from "../../components/common/BottomSheet/BottomSheet";
import { Button } from "../../components/common/Button/Button";
import { formatMoney } from "../../components/common/Money/Money";
import { enqueuePendingTransaction } from "../../utils/pendingTransactionQueue";
import type { BenefitRule } from "../../api/automation";
import { prepareImportImage } from "./importImage";
import styles from "./TransactionImportSheet.module.css";

interface EditableCandidate extends ImportedTransactionCandidate {
  selected: boolean;
}

interface TransactionImportSheetProps {
  userName: string;
  bootstrap: BootstrapData;
  onClose: () => void;
}

function createRequestId() {
  return globalThis.crypto?.randomUUID
    ? `IMPORT_${globalThis.crypto.randomUUID()}`
    : `IMPORT_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function benefitRuleActive(rule: BenefitRule, date: string) {
  if (!rule.enabled || rule.kind !== "post_reward") return false;
  if (rule.validFrom && date < rule.validFrom) return false;
  if (rule.validTo && date > rule.validTo) return false;
  return true;
}

export function TransactionImportSheet({
  userName,
  bootstrap,
  onClose
}: TransactionImportSheetProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [items, setItems] = useState<EditableCandidate[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [stage, setStage] = useState<"source" | "review">("source");

  const expenseCategories = useMemo(
    () => bootstrap.categories.filter(item => item.type === "지출" && item.active && !item.isDeleted),
    [bootstrap]
  );
  const paymentMethods = useMemo(
    () => bootstrap.accounts.filter(item => item.active && !item.isDeleted && ["신용카드", "체크카드", "선불/지역화폐"].includes(item.subType)),
    [bootstrap]
  );
  const selectedCount = items.filter(item => item.selected && item.kind === "expense").length;
  const duplicateCount = items.filter(item => item.duplicate).length;
  const reviewCount = items.filter(item => item.reviewReasons.length > 0).length;

  function patchItem(candidateId: string, patch: Partial<EditableCandidate>) {
    setItems(current => current.map(item => item.candidateId === candidateId ? { ...item, ...patch } : item));
  }

  async function handleAnalyze() {
    if (!text.trim() && files.length === 0) {
      setError("캡처 이미지를 선택하거나 결제 문자를 붙여넣어주세요.");
      return;
    }
    setAnalyzing(true);
    setError("");
    setFeedback("");
    try {
      const images = [];
      for (const file of files.slice(0, 4)) {
        images.push(await prepareImportImage(file));
      }
      const result = await analyzeTransactionImport({ text: text.trim(), images });
      setItems(result.items.map(item => ({ ...item, selected: item.selected })));
      setStage("review");
      if (result.items.length === 0) {
        setFeedback("인식된 거래가 없습니다. 다른 캡처나 텍스트로 다시 시도해주세요.");
      }
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "거래 내역을 분석하지 못했습니다.");
    } finally {
      setAnalyzing(false);
    }
  }

  function validateSelected() {
    for (const item of items) {
      if (!item.selected || item.kind !== "expense") continue;
      if (!item.date || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return `${item.merchant || "거래"}의 날짜를 확인해주세요.`;
      if (!(item.amount > 0)) return `${item.merchant || "거래"}의 금액을 확인해주세요.`;
      if (!item.categoryId) return `${item.merchant || "거래"}의 카테고리를 선택해주세요.`;
      if (!item.paymentMethodId) return `${item.merchant || "거래"}의 결제수단을 선택해주세요.`;
      if (!item.spendingTarget) return `${item.merchant || "거래"}의 지출대상을 선택해주세요.`;
    }
    return null;
  }

  function handleSave() {
    const validationError = validateSelected();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (selectedCount === 0) {
      setError("저장할 거래를 선택해주세요.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      for (const item of items) {
        if (!item.selected || item.kind !== "expense") continue;
        const requestId = createRequestId();
        const benefitRule = bootstrap.automationSettings?.benefitRules.find(
          rule => rule.accountId === item.paymentMethodId && benefitRuleActive(rule, item.date)
        );
        enqueuePendingTransaction({
          owner: userName,
          label: `${item.merchant} · ${formatMoney(item.amount)}`,
          payload: {
            date: item.date,
            type: "지출",
            amount: item.amount,
            categoryId: item.categoryId!,
            paymentMethodId: item.paymentMethodId!,
            spendingTarget: item.spendingTarget,
            description: item.merchant,
            memo: item.memo,
            ...(benefitRule
              ? {
                  benefitRuleId: benefitRule.id,
                  benefitRewardUsedAmount: 0,
                  benefitAccrualEnabled: true
                }
              : {}),
            requestId
          }
        });
      }
      setFeedback(`${selectedCount}건을 저장 대기열에 추가했습니다.`);
      window.setTimeout(onClose, 550);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "거래를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet title="거래 내역 가져오기" onClose={onClose} contentClassName={styles.content}>
      {stage === "source" ? (
        <div className={styles.sourceGrid}>
          <div className={styles.uploadBox}>
            <strong>사진/캡처</strong>
            <input
              className={styles.fileInput}
              type="file"
              accept="image/*"
              multiple
              onChange={event => setFiles((Array.from(event.currentTarget.files || []) as File[]).slice(0, 4))}
            />
            {files.length > 0 && (
              <ul className={styles.fileList}>
                {files.map(file => <li key={`${file.name}-${file.size}`}>{file.name}</li>)}
              </ul>
            )}
          </div>

          <label className={styles.field}>
            <span>텍스트 붙여넣기</span>
            <textarea
              className={styles.textarea}
              value={text}
              onChange={event => setText(event.target.value)}
              placeholder="카드 승인 문자나 결제 내역을 여러 건 붙여넣을 수 있습니다."
            />
          </label>

          {error && <p className={styles.error}>{error}</p>}
          {feedback && <p className={styles.feedback}>{feedback}</p>}
          <Button fullWidth size="lg" loading={analyzing} loadingLabel="분석 중..." onClick={() => void handleAnalyze()}>
            거래 분석
          </Button>
        </div>
      ) : (
        <div className={styles.reviewList}>
          <div className={styles.summary}>
            <span className={styles.pill}>인식 {items.length}건</span>
            <span className={styles.pill}>선택 {selectedCount}건</span>
            {duplicateCount > 0 && <span className={styles.pill}>중복 의심 {duplicateCount}건</span>}
            {reviewCount > 0 && <span className={styles.pill}>확인 필요 {reviewCount}건</span>}
          </div>

          {items.map(item => (
            <article
              key={item.candidateId}
              className={[
                styles.candidate,
                item.duplicate ? styles.candidateDuplicate : "",
                item.reviewReasons.length > 0 && !item.duplicate ? styles.candidateWarning : ""
              ].filter(Boolean).join(" ")}
            >
              <div className={styles.candidateHeader}>
                <input
                  type="checkbox"
                  checked={item.selected}
                  disabled={item.kind === "refund"}
                  aria-label={`${item.merchant || "거래"} 저장 선택`}
                  onChange={event => patchItem(item.candidateId, { selected: event.target.checked })}
                />
                <div className={styles.candidateTitle}>
                  <strong>{item.kind === "refund" ? "취소/환불 · " : ""}{item.merchant || "가맹점 확인 필요"}</strong>
                  <p>{formatMoney(item.amount)} · 신뢰도 {item.confidence === "high" ? "높음" : item.confidence === "low" ? "낮음" : "보통"}</p>
                </div>
              </div>

              {item.reviewReasons.length > 0 && (
                <ul className={styles.reasonList}>
                  {item.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              {item.duplicate && (
                <p className={styles.notice}>기존 거래: {item.duplicate.date} · {item.duplicate.description || item.duplicate.category} · {formatMoney(item.duplicate.amount)}</p>
              )}

              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span>날짜</span>
                  <input className={styles.input} type="date" value={item.date} onChange={event => patchItem(item.candidateId, { date: event.target.value })} />
                </label>
                <label className={styles.field}>
                  <span>금액</span>
                  <input className={styles.input} inputMode="numeric" value={item.amount || ""} onChange={event => patchItem(item.candidateId, { amount: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 })} />
                </label>
              </div>

              <label className={styles.field}>
                <span>가맹점</span>
                <input className={styles.input} value={item.merchant} onChange={event => patchItem(item.candidateId, { merchant: event.target.value })} />
              </label>

              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span>카테고리</span>
                  <select
                    className={styles.select}
                    value={item.categoryId || ""}
                    onChange={event => {
                      const category = expenseCategories.find(categoryItem => categoryItem.categoryId === event.target.value);
                      patchItem(item.candidateId, { categoryId: event.target.value || null, categoryName: category?.name || "" });
                    }}
                  >
                    <option value="">선택</option>
                    {expenseCategories.map(category => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
                  </select>
                </label>
                <label className={styles.field}>
                  <span>결제수단</span>
                  <select
                    className={styles.select}
                    value={item.paymentMethodId || ""}
                    onChange={event => {
                      const account = paymentMethods.find(accountItem => accountItem.accountId === event.target.value);
                      patchItem(item.candidateId, { paymentMethodId: event.target.value || null, paymentMethodName: account?.displayName || "" });
                    }}
                  >
                    <option value="">선택</option>
                    {paymentMethods.map(account => <option key={account.accountId} value={account.accountId}>{account.displayName}</option>)}
                  </select>
                </label>
              </div>

              <label className={styles.field}>
                <span>지출대상</span>
                <select className={styles.select} value={item.spendingTarget} onChange={event => patchItem(item.candidateId, { spendingTarget: event.target.value })}>
                  <option value="">선택</option>
                  {bootstrap.spendingTargets.map(target => <option key={target} value={target}>{target}</option>)}
                </select>
              </label>
            </article>
          ))}

          {error && <p className={styles.error}>{error}</p>}
          {feedback && <p className={styles.feedback}>{feedback}</p>}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={() => { setStage("source"); setError(""); }}>다시 분석</Button>
            <Button loading={saving} loadingLabel="추가 중..." disabled={selectedCount === 0} onClick={handleSave}>선택 {selectedCount}건 저장</Button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
