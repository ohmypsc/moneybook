import { useMemo, useRef, useState } from "react";
import { analyzeTransactionImport, type ImportedTransactionCandidate } from "../../api/transactionImport";
import type { BootstrapData } from "../../types/bootstrap";
import { BottomSheet } from "../../components/common/BottomSheet/BottomSheet";
import { Button } from "../../components/common/Button/Button";
import { formatMoney } from "../../components/common/Money/Money";
import { enqueuePendingTransaction } from "../../utils/pendingTransactionQueue";
import type { BenefitRule } from "../../api/automation";
import { prepareImportImages } from "./importImage";
import styles from "./TransactionImportSheet.module.css";

interface EditableCandidate extends ImportedTransactionCandidate {
  selected: boolean;
}

type ImportSource = "image" | "text";

interface TransactionImportSheetProps {
  userName: string;
  bootstrap: BootstrapData;
  onClose: () => void;
}

function deriveReviewReasons(item: EditableCandidate) {
  const reasons: string[] = [];
  if (!item.date) reasons.push("날짜 확인 필요");
  if (!(item.amount > 0)) reasons.push("금액 확인 필요");
  if (!item.merchant.trim()) reasons.push("가맹점 확인 필요");
  if (!item.paymentMethodId) reasons.push("결제수단 선택 필요");
  if (!item.categoryId) reasons.push("카테고리 선택 필요");
  if (!item.spendingTarget) reasons.push("지출대상 선택 필요");
  if (item.confidence === "low") reasons.push("인식 결과 확인 필요");
  if (item.duplicate) reasons.push("중복 거래 의심");
  if (item.kind === "refund") reasons.push("취소/환불은 원거래 연결 확인 필요");
  return reasons;
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
  const [source, setSource] = useState<ImportSource>("image");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    setItems(current => current.map(item => {
      if (item.candidateId !== candidateId) return item;
      const duplicateKeyChanged = ["date", "time", "amount", "merchant", "paymentMethodId"]
        .some(key => Object.prototype.hasOwnProperty.call(patch, key));
      const next = {
        ...item,
        ...patch,
        ...(duplicateKeyChanged ? { duplicate: null } : {})
      } as EditableCandidate;
      return { ...next, reviewReasons: deriveReviewReasons(next) };
    }));
  }

  function chooseFiles() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  function updateFiles(nextFiles: File[]) {
    setFiles(nextFiles.slice(0, 4));
    setError("");
    setFeedback("");
  }

  function removeFile(index: number) {
    setFiles(current => current.filter((_, currentIndex) => currentIndex !== index));
  }

  async function handleAnalyze() {
    if (source === "image" && files.length === 0) {
      setError("카드 내역 캡처나 이미지를 선택해주세요.");
      return;
    }
    if (source === "text" && !text.trim()) {
      setError("카드 승인 문자나 결제 내역을 붙여넣어주세요.");
      return;
    }
    setAnalyzing(true);
    setError("");
    setFeedback("");
    try {
      const sourceFiles = source === "image" ? files.slice(0, 4) : [];
      const maxPreparedImages = 8;
      const partsPerFile = sourceFiles.length > 0
        ? Math.max(1, Math.floor(maxPreparedImages / sourceFiles.length))
        : 1;
      const imageGroups = await Promise.all(
        sourceFiles.map(file => prepareImportImages(file, partsPerFile))
      );
      const images = imageGroups.flat().slice(0, maxPreparedImages);
      const result = await analyzeTransactionImport({
        text: source === "text" ? text.trim() : "",
        images
      });
      setItems(result.items.map(item => {
        const candidate = { ...item, selected: item.selected } as EditableCandidate;
        return { ...candidate, reviewReasons: deriveReviewReasons(candidate) };
      }));
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
      if (!item.merchant.trim()) return "가맹점명을 확인해주세요.";
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
    <BottomSheet
      title="거래 내역 가져오기"
      onClose={onClose}
      contentClassName={styles.content}
      size="large"
    >
      {stage === "source" ? (
        <div className={styles.sourceGrid}>
          <div className={styles.sourceIntro}>
            <strong>가져올 방식을 선택해주세요</strong>
            <p>캡처와 텍스트 중 하나만 사용하면 됩니다.</p>
          </div>

          <div className={styles.sourceTabs} role="tablist" aria-label="거래 내역 입력 방식">
            <button
              type="button"
              role="tab"
              aria-selected={source === "image"}
              className={[styles.sourceTab, source === "image" ? styles.sourceTabActive : ""].filter(Boolean).join(" ")}
              onClick={() => { setSource("image"); setError(""); setFeedback(""); }}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M4.5 7.5h3l1.3-2h6.4l1.3 2h3A1.5 1.5 0 0 1 21 9v8.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5V9a1.5 1.5 0 0 1 1.5-1.5Z" />
                  <circle cx="12" cy="13" r="3.25" />
                </svg>
              </span>
              <span>캡처 / 이미지</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={source === "text"}
              className={[styles.sourceTab, source === "text" ? styles.sourceTabActive : ""].filter(Boolean).join(" ")}
              onClick={() => { setSource("text"); setError(""); setFeedback(""); }}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M6 5.5h12M6 10h12M6 14.5h8M6 19h6" />
                </svg>
              </span>
              <span>문자 / 텍스트</span>
            </button>
          </div>

          {source === "image" ? (
            <div className={styles.imagePanel}>
              <input
                ref={fileInputRef}
                className={styles.visuallyHidden}
                type="file"
                accept="image/*"
                multiple
                onChange={event => updateFiles(Array.from(event.currentTarget.files || []) as File[])}
              />

              <button type="button" className={styles.uploadTrigger} onClick={chooseFiles}>
                <span className={styles.uploadIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
                    <circle cx="9" cy="10" r="1.75" />
                    <path d="m5.5 17 4.1-4.1a1.4 1.4 0 0 1 2 0l1.9 1.9 1.2-1.2a1.4 1.4 0 0 1 2 0l1.8 1.8" />
                  </svg>
                </span>
                <span className={styles.uploadCopy}>
                  <strong>{files.length > 0 ? "다른 캡처 선택하기" : "카드 내역 캡처 선택"}</strong>
                  <small>스크린샷 또는 사진 · 최대 4장</small>
                </span>
                <span className={styles.uploadAction}>{files.length > 0 ? "변경" : "선택"}</span>
              </button>

              {files.length > 0 && (
                <div className={styles.selectedFiles}>
                  <div className={styles.selectedFilesHeader}>
                    <strong>선택한 이미지 {files.length}장</strong>
                    <span>이 이미지만 분석합니다.</span>
                  </div>
                  <div className={styles.fileList}>
                    {files.map((file, index) => (
                      <div className={styles.fileItem} key={`${file.name}-${file.size}-${index}`}>
                        <span className={styles.fileBadge} aria-hidden="true">{index + 1}</span>
                        <span className={styles.fileName} title={file.name}>{file.name}</span>
                        <button
                          type="button"
                          className={styles.fileRemove}
                          aria-label={`${file.name} 제거`}
                          onClick={() => removeFile(index)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <p className={styles.sourceHint}>카드 앱의 승인 내역이 보이도록 캡처하면 여러 건을 한 번에 인식합니다.</p>
            </div>
          ) : (
            <div className={styles.textPanel}>
              <label className={styles.field}>
                <span>카드 승인 문자 또는 결제 내역</span>
                <textarea
                  className={styles.textarea}
                  value={text}
                  onChange={event => setText(event.target.value)}
                  placeholder={"예)\n09/15 스타벅스 5,800원\n09/15 GS25 7,200원\n\n여러 건을 그대로 붙여넣어도 됩니다."}
                />
              </label>
              <p className={styles.sourceHint}>이미지를 선택할 필요 없이 붙여넣은 텍스트만 분석합니다.</p>
            </div>
          )}

          {error && <p className={styles.error}>{error}</p>}
          {feedback && <p className={styles.feedback}>{feedback}</p>}
          <div className={styles.sourceAction}>
            <Button
              fullWidth
              size="lg"
              loading={analyzing}
              loadingLabel="분석 중..."
              onClick={() => void handleAnalyze()}
            >
              {source === "image" ? "캡처 분석하기" : "텍스트 분석하기"}
            </Button>
          </div>
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
                  <p>{formatMoney(item.amount)}{item.time ? ` · ${item.time}` : ""} · 신뢰도 {item.confidence === "high" ? "높음" : item.confidence === "low" ? "낮음" : "보통"}</p>
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
                  <span>승인 시간</span>
                  <input className={styles.input} type="time" value={item.time} onChange={event => patchItem(item.candidateId, { time: event.target.value })} />
                </label>
              </div>

              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span>금액</span>
                  <input className={styles.input} inputMode="numeric" value={item.amount || ""} onChange={event => patchItem(item.candidateId, { amount: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 })} />
                </label>
                <label className={styles.field}>
                  <span>가맹점</span>
                  <input className={styles.input} value={item.merchant} onChange={event => patchItem(item.candidateId, { merchant: event.target.value })} />
                </label>
              </div>

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
