import { useMemo, useRef, useState } from "react";
import { analyzeTransactionImport } from "../../api/transactionImport";
import type { BootstrapData } from "../../types/bootstrap";
import { BottomSheet } from "../../components/common/BottomSheet/BottomSheet";
import { Button } from "../../components/common/Button/Button";
import { formatMoney } from "../../components/common/Money/Money";
import { enqueuePendingTransaction } from "../../utils/pendingTransactionQueue";
import { buildImportPayload, changeImportKind, deriveReviewReasons, IMPORT_TYPE_LABELS, type EditableCandidate, type ImportKind } from "./importReview";

import { getSeoulDateString } from "../../utils/dateTime";
import { prepareImportImages } from "./importImage";
import { prioritizeAccountsForUser } from "../../pages/InputPage/inputDomain";
import styles from "./TransactionImportSheet.module.css";

const IMPORT_CARD_SUBTYPES = ["신용카드", "체크카드", "선불/지역화폐"];

type ImportSource = "image" | "text";

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
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [stage, setStage] = useState<"source" | "review">("source");
  const [expandedCandidateId, setExpandedCandidateId] = useState<string | null>(null);

  const categories = useMemo(
    () => bootstrap.categories.filter(item => item.active && !item.isDeleted),
    [bootstrap]
  );
  // 카드뿐 아니라 현금·통장(계좌이체 결제)도 고를 수 있게 합니다. 내 명의 → 공동 → 배우자 순서입니다.
  const paymentMethodGroups = useMemo(() => {
    const active = prioritizeAccountsForUser(
      bootstrap.accounts.filter(item => item.active && !item.isDeleted),
      userName
    );
    return {
      cards: active.filter(item => IMPORT_CARD_SUBTYPES.includes(item.subType)),
      cashAndBank: active.filter(
        // 일반 입력 화면처럼 투자계좌(CMA 등)도 결제수단으로 고를 수 있게 합니다.
        item => item.accountType === "자산" && !IMPORT_CARD_SUBTYPES.includes(item.subType)
      )
    };
  }, [bootstrap, userName]);
  const paymentMethods = useMemo(
    () => [...paymentMethodGroups.cards, ...paymentMethodGroups.cashAndBank],
    [paymentMethodGroups]
  );
  const paymentMethodOptions = (
    <>
      {paymentMethodGroups.cards.length > 0 && (
        <optgroup label="카드">
          {paymentMethodGroups.cards.map(account => (
            <option key={account.accountId} value={account.accountId}>{account.displayName}</option>
          ))}
        </optgroup>
      )}
      {paymentMethodGroups.cashAndBank.length > 0 && (
        <optgroup label="현금·계좌·CMA">
          {paymentMethodGroups.cashAndBank.map(account => (
            <option key={account.accountId} value={account.accountId}>{account.displayName}</option>
          ))}
        </optgroup>
      )}
    </>
  );
  const transferAccounts = useMemo(() => prioritizeAccountsForUser(
    bootstrap.accounts.filter(account => account.active && !account.isDeleted && account.subType !== "체크카드"), userName
  ), [bootstrap, userName]);
  const accountOptions = transferAccounts.map(account => <option key={account.accountId} value={account.accountId}>{account.displayName}</option>);
  const selectedKinds = new Set(items.filter(item => item.selected && !item.queued && item.kind !== "refund").map(item => item.kind));
  const bulkKind = selectedKinds.size === 1 ? [...selectedKinds][0] : null;
  const bulkCategories = categories.filter(category => bulkKind && category.type === IMPORT_TYPE_LABELS[bulkKind]);
  const selectedCount = items.filter(item => item.selected && !item.queued && item.kind !== "refund").length;
  const duplicateCount = items.filter(item => item.duplicate).length;
  const reviewCount = items.filter(item => item.reviewReasons.length > 0).length;

  function patchItem(candidateId: string, patch: Partial<EditableCandidate>) {
    setItems(current => current.map(item => {
      if (item.candidateId !== candidateId || item.queued || savingRef.current) return item;
      const duplicateKeyChanged = ["kind", "date", "time", "amount", "merchant", "paymentMethodId", "fromAccountId", "toAccountId"]
        .some(key => Object.prototype.hasOwnProperty.call(patch, key));
      const next = {
        ...(patch.kind ? changeImportKind(item, patch.kind) : item),
        ...patch,
        ...(duplicateKeyChanged ? { duplicate: null } : {})
      } as EditableCandidate;
      return { ...next, reviewReasons: deriveReviewReasons(next) };
    }));
  }

  function patchSelected(patch: Partial<EditableCandidate>) {
    setItems(current => current.map(item => {
      if (!item.selected || item.kind === "refund" || item.queued || savingRef.current) return item;
      const duplicateKeyChanged = ["kind", "date", "time", "amount", "merchant", "paymentMethodId", "fromAccountId", "toAccountId"]
        .some(key => Object.prototype.hasOwnProperty.call(patch, key));
      const next = {
        ...(patch.kind ? changeImportKind(item, patch.kind) : item),
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
      setError("카드·계좌 내역 캡처나 이미지를 선택해주세요.");
      return;
    }
    if (source === "text" && !text.trim()) {
      setError("입출금 문자나 거래 내역을 붙여넣어주세요.");
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
      const mappedItems = result.items.map(item => {
        const candidate = { ...item, requestId: createRequestId(), selected: item.selected } as EditableCandidate;
        return { ...candidate, reviewReasons: deriveReviewReasons(candidate) };
      });
      setItems(mappedItems);
      setExpandedCandidateId(
        mappedItems.find(item => item.reviewReasons.length > 0)?.candidateId || null
      );
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

  function addManualItem() {
    const requestId = createRequestId();
    const item: EditableCandidate = {
      candidateId: requestId, requestId, kind: "expense", selected: true,
      date: getSeoulDateString(),
      time: "", amount: 0, merchant: "", cardName: "", suggestedCategoryName: "", confidence: "high",
      memo: "", sourceText: "", categoryId: null, categoryName: "", categorySuggestionSource: null,
      paymentMethodId: null, paymentMethodName: "", fromAccountId: "", toAccountId: "",
      spendingTarget: bootstrap.spendingTargets.includes(userName) ? userName : "공동", duplicate: null, reviewReasons: []
    };
    item.reviewReasons = deriveReviewReasons(item);
    setItems(current => [...current, item]);
    setExpandedCandidateId(requestId);
    setStage("review");
  }

  async function handleSave() {
    if (savingRef.current) return;
    const selected = items.filter(item => item.selected && !item.queued && item.kind !== "refund");
    if (!selected.length) { setError("저장할 거래를 선택해주세요."); return; }
    // Validate the whole selection before queueing any item.
    let payloads;
    try { payloads = selected.map(item => buildImportPayload(item, bootstrap)); }
    catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "입력 내용을 확인해주세요.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    let queued = 0;
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const item = selected[index];
        await enqueuePendingTransaction({
          owner: userName,
          label: `${IMPORT_TYPE_LABELS[item.kind]} · ${item.merchant} · ${formatMoney(item.amount)}`,
          payload: payloads[index]
        });
        queued += 1;
        setItems(current => current.map(row => row.candidateId === item.candidateId
          ? { ...row, queued: true, selected: false } : row));
      }
      setFeedback(`${queued}건을 기기에 보관했습니다. 서버 저장 상태는 입력 화면에서 확인할 수 있습니다.`);
    } catch (saveError) {
      setError(`${queued}건은 대기열에 추가되었습니다. 나머지 항목만 다시 시도해주세요. ${saveError instanceof Error ? saveError.message : "저장 공간을 확인해주세요."}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      title="거래 내역 가져오기"
      onClose={() => { if (!savingRef.current && !analyzing) onClose(); }}
      contentClassName={styles.content}
      size="large"
    >
      <fieldset disabled={saving || analyzing} className={styles.formFields}>
      {stage === "source" ? (
        <div className={styles.sourceGrid}>
          <div className={styles.sourceIntro}>
            <strong>가져올 방식을 선택해주세요</strong>
            <p>지출·수입·이체 내역을 가져오거나 직접 여러 건 입력할 수 있습니다.</p>
            <Button variant="secondary" onClick={addManualItem}>직접 일괄 입력</Button>
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
                  <strong>{files.length > 0 ? "다른 캡처 선택하기" : "카드·계좌 내역 캡처 선택"}</strong>
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

              <p className={styles.sourceHint}>카드·은행 앱의 거래 내역을 캡처해주세요. 인식 후 지출·수입·이체와 계좌를 확인할 수 있습니다.</p>
            </div>
          ) : (
            <div className={styles.textPanel}>
              <label className={styles.field}>
                <span>입출금 문자 또는 거래 내역</span>
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

          {items.length > 1 && (
            <div className={styles.bulkEdit}>
              <div>
                <strong>선택 항목 일괄 수정</strong>
                <span>{selectedCount > 0 ? `${selectedCount}건에 바로 적용됩니다.` : "먼저 저장할 거래를 선택해주세요."}</span>
              </div>
              <div className={styles.bulkControls}>
                <select className={styles.bulkSelect} value="" disabled={!selectedCount} aria-label="선택 항목 유형 일괄 변경"
                  onChange={event => patchSelected({ kind: event.target.value as ImportKind })}>
                  <option value="">거래 유형 일괄 변경</option>
                  <option value="expense">지출</option><option value="income">수입</option><option value="transfer">이체</option>
                </select>
                <select className={styles.bulkSelect} value="" disabled={!selectedCount || !bulkKind} aria-label="선택 항목 카테고리 일괄 변경"
                  onChange={event => { const category = bulkCategories.find(row => row.categoryId === event.target.value); if (category) patchSelected({ categoryId: category.categoryId, categoryName: category.name }); }}>
                  <option value="">{bulkKind ? "카테고리 일괄 변경" : "같은 유형끼리 선택해주세요"}</option>
                  {bulkCategories.map(category => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
                </select>
                {bulkKind === "expense" && <>
                  <select className={styles.bulkSelect} value="" aria-label="선택 항목 결제수단 일괄 변경" onChange={event => { const account = paymentMethods.find(row => row.accountId === event.target.value); if (account) patchSelected({ paymentMethodId: account.accountId, paymentMethodName: account.displayName }); }}>
                    <option value="">결제수단 일괄 변경</option>{paymentMethodOptions}
                  </select>
                  <select className={styles.bulkSelect} value="" aria-label="선택 항목 지출대상 일괄 변경" onChange={event => patchSelected({ spendingTarget: event.target.value })}>
                    <option value="">지출대상 일괄 변경</option>{bootstrap.spendingTargets.map(target => <option key={target}>{target}</option>)}
                  </select>
                </>}
                {bulkKind === "transfer" && <select className={styles.bulkSelect} value="" aria-label="선택 항목 출금계좌 일괄 변경" onChange={event => patchSelected({ fromAccountId: event.target.value })}>
                  <option value="">출금계좌 일괄 변경</option>{accountOptions}
                </select>}
                {(bulkKind === "income" || bulkKind === "transfer") && <select className={styles.bulkSelect} value="" aria-label="선택 항목 입금계좌 일괄 변경" onChange={event => patchSelected({ toAccountId: event.target.value })}>
                  <option value="">입금계좌 일괄 변경</option>{accountOptions}
                </select>}
              </div>
            </div>
          )}

          {items.map(item => (
            <article
              key={item.candidateId}
              className={[
                styles.candidate,
                item.duplicate ? styles.candidateDuplicate : "",
                item.reviewReasons.length > 0 && !item.duplicate ? styles.candidateWarning : ""
              ].filter(Boolean).join(" ")}
            >
              <div className={styles.candidateCompactHeader}>
                <input
                  type="checkbox"
                  checked={item.selected}
                  disabled={item.kind === "refund" || item.queued}
                  aria-label={`${item.merchant || "거래"} 저장 선택`}
                  onChange={event => patchItem(item.candidateId, { selected: event.target.checked })}
                />
                <button
                  type="button"
                  className={styles.candidateToggle}
                  aria-expanded={expandedCandidateId === item.candidateId}
                  onClick={() => setExpandedCandidateId(current => current === item.candidateId ? null : item.candidateId)}
                >
                  <div className={styles.candidateTitle}>
                    <strong>{item.queued ? "대기열 추가됨 · " : `${IMPORT_TYPE_LABELS[item.kind]} · `}{item.merchant || "거래 내용 확인 필요"}</strong>
                    <p>
                      {[item.date || "날짜 확인", item.time, item.categoryName || "카테고리 확인", item.kind === "expense" ? item.paymentMethodName : transferAccounts.find(account => account.accountId === item.toAccountId)?.displayName]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {item.reviewReasons.length > 0 && (
                      <span className={styles.compactWarning}>{item.reviewReasons[0]}{item.reviewReasons.length > 1 ? ` 외 ${item.reviewReasons.length - 1}` : ""}</span>
                    )}
                  </div>
                  <div className={styles.candidateSummaryAmount}>
                    <strong>{formatMoney(item.amount)}</strong>
                    <span aria-hidden="true">{expandedCandidateId === item.candidateId ? "⌃" : "⌄"}</span>
                  </div>
                </button>
              </div>

              {expandedCandidateId === item.candidateId && (
                <fieldset disabled={item.queued} className={[styles.formFields, styles.candidateDetails].join(" ")}>
                  {item.reviewReasons.length > 0 && (
                    <ul className={styles.reasonList}>
                      {item.reviewReasons.map(reason => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                  {item.duplicate && (
                    <p className={styles.notice}>기존 거래: {item.duplicate.date} · {item.duplicate.description || item.duplicate.category} · {formatMoney(item.duplicate.amount)}</p>
                  )}

                  <label className={styles.field}>
                    <span>거래 유형</span>
                    <select className={styles.select} value={item.kind} disabled={item.kind === "refund"}
                      onChange={event => patchItem(item.candidateId, { kind: event.target.value as ImportKind })}>
                      <option value="expense">지출</option><option value="income">수입</option><option value="transfer">이체</option>
                      {item.kind === "refund" && <option value="refund">취소/환불 · 원거래 연결 필요</option>}
                    </select>
                  </label>
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
                      <span>거래 내용·가맹점</span>
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
                          const category = categories.find(categoryItem => categoryItem.categoryId === event.target.value);
                          patchItem(item.candidateId, { categoryId: event.target.value || null, categoryName: category?.name || "" });
                        }}
                      >
                        <option value="">선택</option>
                        {categories.filter(category => category.type === IMPORT_TYPE_LABELS[item.kind]).map(category => <option key={category.categoryId} value={category.categoryId}>{category.name}</option>)}
                      </select>
                    </label>
                    {item.kind === "expense" && <label className={styles.field}>
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
                        {paymentMethodOptions}
                      </select>
                    </label>}
                  </div>

                  {item.kind === "expense" && <label className={styles.field}>
                    <span>지출대상</span>
                    <select className={styles.select} value={item.spendingTarget} onChange={event => patchItem(item.candidateId, { spendingTarget: event.target.value })}>
                      <option value="">선택</option>
                      {bootstrap.spendingTargets.map(target => <option key={target} value={target}>{target}</option>)}
                    </select>
                  </label>}
                  {item.kind === "transfer" && <label className={styles.field}>
                    <span>출금계좌</span>
                    <select className={styles.select} value={item.fromAccountId || ""} onChange={event => patchItem(item.candidateId, { fromAccountId: event.target.value })}>
                      <option value="">선택</option>{accountOptions}
                    </select>
                  </label>}
                  {(item.kind === "income" || item.kind === "transfer") && <label className={styles.field}>
                    <span>입금계좌</span>
                    <select className={styles.select} value={item.toAccountId || ""} onChange={event => patchItem(item.candidateId, { toAccountId: event.target.value })}>
                      <option value="">선택</option>{accountOptions}
                    </select>
                  </label>}
                  <label className={styles.field}><span>메모</span><input className={styles.input} value={item.memo} onChange={event => patchItem(item.candidateId, { memo: event.target.value })} /></label>
                </fieldset>
              )}
            </article>
          ))}

          {error && <p className={styles.error}>{error}</p>}
          {feedback && <p className={styles.feedback}>{feedback}</p>}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={addManualItem}>거래 추가</Button>
            <Button variant="secondary" onClick={() => { setStage("source"); setError(""); }}>다시 분석</Button>
            <Button loading={saving} loadingLabel="추가 중..." disabled={selectedCount === 0} onClick={handleSave}>선택 {selectedCount}건 저장</Button>
          </div>
        </div>
      )}
      </fieldset>
    </BottomSheet>
  );
}
