import { TagsInput, TagChips } from "../../components/classification/TagsInput";
import { applyImportClassification } from "./importReview";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getDashboardSnapshot } from "../../api/dashboard";
import { InputPickerSheet } from "../../pages/InputPage/InputPickerSheet";
import type { PickerKind } from "../../pages/InputPage/inputDomain";
import { getCategorySuggestions } from "../../utils/categoryUsage";
import {
  applyAccountPreferences,
  applyCategoryPreferences,
  getInputPreferences,
  sortAccountsByPreferences
} from "../../utils/inputPreferences";
import { ImportReviewList } from "./ImportReviewList";
import { ImportStepReview, type StepChoices, type StepPickerKind } from "./ImportStepReview";
import {
  confirmReviewedItem,
  findSameMerchantItems,
  needsReview,
  suggestAccountIds
} from "./importSuggestions";
import reviewStyles from "./ImportReview.module.css";
import { analyzeTransactionImport } from "../../api/transactionImport";
import type { BootstrapData } from "../../types/bootstrap";
import { BottomSheet } from "../../components/common/BottomSheet/BottomSheet";
import { Button } from "../../components/common/Button/Button";
import { formatMoney } from "../../components/common/Money/Money";
import { enqueuePendingTransaction } from "../../utils/pendingTransactionQueue";
import {
  buildImportPayload,
  changeImportKind,
  deriveReviewReasons,
  IMPORT_TYPE_LABELS,
  type EditableCandidate,
  type ImportKind
} from "./importReview";

import { getSeoulDateString } from "../../utils/dateTime";
import { prepareImportImages } from "./importImage";
import { prioritizeAccountsForUser } from "../../pages/InputPage/inputDomain";
import styles from "./TransactionImportSheet.module.css";

import { confirmAction } from "../../utils/confirmAction";
import { readImportDraft, saveImportDraft, type ImportDraft } from "./importDraft";

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
  const [restored] = useState(() => readImportDraft(userName));
  const [source, setSource] = useState<ImportSource>(restored?.source || "image");
  const [text, setText] = useState(restored?.text || "");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<EditableCandidate[]>(restored?.items || []);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState(
    restored
      ? "이 기기에 임시저장한 내용을 불러왔습니다. 거래 정보와 저장 상태를 확인해주세요."
      : ""
  );
  const [stage, setStage] = useState<"source" | "review">(restored?.stage || "source");
  const [reviewMode, setReviewMode] = useState<"list" | "step">("list");
  const [stepIds, setStepIds] = useState<string[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [stepError, setStepError] = useState("");
  const [samePrompt, setSamePrompt] = useState<{
    ids: string[];
    categoryId: string;
    categoryName: string;
  } | null>(null);
  const [picker, setPicker] = useState<StepPickerKind | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);

  const [draftSaved, setDraftSaved] = useState(true);
  const closeInProgress = useRef(false);
  const draft: ImportDraft = { version: 1, source, text, stage, items };
  const hasUnsubmitted =
    items.some(item => !item.queued) || (items.length === 0 && Boolean(text.trim()));

  useEffect(() => {
    setDraftSaved(saveImportDraft(userName, { version: 1, source, text, stage, items }));
  }, [userName, source, text, stage, items]);

  useEffect(() => {
    if (!hasUnsubmitted && files.length === 0 && !saving && !analyzing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsubmitted, files.length, saving, analyzing]);

  async function handleClose() {
    if (savingRef.current || analyzing || closeInProgress.current) return;
    closeInProgress.current = true;
    try {
      const saved = saveImportDraft(userName, draft);
      setDraftSaved(saved);
      if (
        (hasUnsubmitted || files.length > 0) &&
        !(await confirmAction({
          title: "일괄 입력을 닫을까요?",
          message: saved
            ? "작성한 거래 목록과 텍스트는 이 기기에 임시저장됩니다. 아직 서버에 저장된 것은 아닙니다. 선택한 원본 이미지는 다시 선택해야 합니다."
            : "임시저장 공간을 사용할 수 없습니다. 지금 닫으면 작성 중인 내용이 사라질 수 있습니다.",
          confirmLabel: "닫기",
          cancelLabel: "계속 입력하기"
        }))
      )
        return;
      onClose();
    } finally {
      closeInProgress.current = false;
    }
  }

  async function discardDraft() {
    if (
      savingRef.current ||
      analyzing ||
      !(await confirmAction({
        title: "일괄 입력 새로 시작",
        message: "작성 중인 목록과 텍스트를 비울까요? 이미 저장 대기열에 추가한 거래는 유지됩니다.",
        confirmLabel: "비우기",
        tone: "danger"
      }))
    )
      return;
    setItems([]);
    setText("");
    setFiles([]);
    setStage("source");
    resetStep();
    setReviewMode("list");
    setError("");
    setFeedback("");
    setDraftSaved(
      saveImportDraft(userName, { version: 1, source, text: "", stage: "source", items: [] })
    );
  }

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
            <option key={account.accountId} value={account.accountId}>
              {account.displayName}
            </option>
          ))}
        </optgroup>
      )}
      {paymentMethodGroups.cashAndBank.length > 0 && (
        <optgroup label="현금·계좌·CMA">
          {paymentMethodGroups.cashAndBank.map(account => (
            <option key={account.accountId} value={account.accountId}>
              {account.displayName}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
  const transferAccounts = useMemo(
    () =>
      prioritizeAccountsForUser(
        bootstrap.accounts.filter(
          account => account.active && !account.isDeleted && account.subType !== "체크카드"
        ),
        userName
      ),
    [bootstrap, userName]
  );
  const accountOptions = transferAccounts.map(account => (
    <option key={account.accountId} value={account.accountId}>
      {account.displayName}
    </option>
  ));
  /* ---------- 추천 칩 재료 ---------- */

  const dashboard = useMemo(() => getDashboardSnapshot(), []);
  const recentTransactions = useMemo(() => dashboard?.recentTransactions || [], [dashboard]);
  const preferences = useMemo(
    () => getInputPreferences(bootstrap.categories, bootstrap.accounts, userName),
    [bootstrap, userName]
  );
  const accountById = useMemo(
    () => new Map(bootstrap.accounts.map(account => [account.accountId, account])),
    [bootstrap]
  );
  function accountLabel(accountId: string) {
    return accountById.get(accountId)?.displayName || "";
  }
  const stepItem =
    reviewMode === "step"
      ? items.find(item => item.candidateId === stepIds[stepIndex]) || null
      : null;
  const stepType = stepItem ? IMPORT_TYPE_LABELS[stepItem.kind] : "지출";
  const pickerCategories = useMemo(
    () =>
      applyCategoryPreferences(
        categories,
        stepType === "수입" || stepType === "이체" ? stepType : "지출",
        preferences
      ),
    [categories, stepType, preferences]
  );

  const stepChoices = useMemo<StepChoices>(() => {
    const item = stepItem;
    const categoryById = new Map(pickerCategories.map(row => [row.categoryId, row]));
    const suggestion = getCategorySuggestions({
      merchant: item?.merchant || "",
      type: stepType,
      availableIds: pickerCategories.map(row => row.categoryId),
      merchantUsage: dashboard?.merchantUsage,
      usage: dashboard?.categoryUsage,
      recentCategoryIds: recentTransactions.map(tx => tx.categoryId),
      limit: 4
    });
    const fromMerchantName = suggestion.fromMerchant[0]
      ? categoryById.get(suggestion.fromMerchant[0])?.name
      : "";
    const paymentIds = paymentMethods.map(account => account.accountId);
    const transferIds = transferAccounts.map(account => account.accountId);
    const toAccountOptions = (ids: string[]) =>
      ids.map(id => ({ value: id, label: accountLabel(id) }));
    return {
      category: suggestion.ids.map(id => ({
        value: id,
        label: categoryById.get(id)?.name || "",
        suggested: suggestion.fromMerchant.includes(id)
      })),
      categoryHint:
        fromMerchantName && item?.merchant.trim()
          ? `${item.merchant.trim()}: 지난번에 ${fromMerchantName}`
          : "",
      paymentMethod: toAccountOptions(
        suggestAccountIds(
          paymentIds,
          item?.paymentMethodId,
          recentTransactions.filter(tx => tx.type === "지출").map(tx => tx.paymentMethodId)
        )
      ),
      paymentHint: item?.cardName ? `캡처: ${item.cardName}` : "",
      fromAccount: toAccountOptions(
        suggestAccountIds(
          transferIds,
          item?.fromAccountId,
          recentTransactions.filter(tx => tx.type === "이체").map(tx => tx.fromAccountId)
        )
      ),
      toAccount: toAccountOptions(
        suggestAccountIds(
          transferIds,
          item?.toAccountId,
          recentTransactions
            .filter(tx => tx.type === (item?.kind === "income" ? "수입" : "이체"))
            .map(tx => tx.toAccountId)
        )
      ),
      spendingTargets: bootstrap.spendingTargets,
      labelOf: (kind, value) =>
        kind === "category" ? categoryById.get(value)?.name || "" : accountLabel(value)
    };
  }, [
    stepItem,
    stepType,
    pickerCategories,
    dashboard,
    recentTransactions,
    paymentMethods,
    transferAccounts,
    accountById,
    bootstrap.spendingTargets
  ]);

  // [전체] 선택창은 일반 입력 화면과 같은 것을 씁니다.
  const pickerAccounts = useMemo(() => {
    const active = bootstrap.accounts.filter(account => account.active && !account.isDeleted);
    const visible = prioritizeAccountsForUser(
      applyAccountPreferences(active, preferences),
      userName
    );
    return {
      ordered: sortAccountsByPreferences(active, preferences),
      visible,
      visibleIds: new Set(visible.map(account => account.accountId)),
      creditCards: visible.filter(account => account.subType === "신용카드")
    };
  }, [bootstrap, preferences, userName]);

  function describeItem(item: EditableCandidate) {
    const account =
      item.kind === "expense"
        ? item.paymentMethodName
        : item.toAccountId
          ? accountLabel(item.toAccountId)
          : "";
    return [item.categoryName || "카테고리 확인", account].filter(Boolean).join(" · ");
  }

  // 다음 거래로 넘어가거나 목록으로 돌아오면 맨 위부터 보이게 합니다.
  const reviewTopRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    reviewTopRef.current?.scrollIntoView({ block: "start" });
  }, [reviewMode, stepIndex]);

  useEffect(() => {
    const urls = files.map(file => URL.createObjectURL(file));
    setImageUrls(urls);
    return () => urls.forEach(url => URL.revokeObjectURL(url));
  }, [files]);

  const selectedKinds = new Set(
    items
      .filter(item => item.selected && !item.queued && item.kind !== "refund")
      .map(item => item.kind)
  );
  const bulkKind = selectedKinds.size === 1 ? [...selectedKinds][0] : null;
  const bulkCategories = categories.filter(
    category => bulkKind && category.type === IMPORT_TYPE_LABELS[bulkKind]
  );
  const selectedCount = items.filter(
    item => item.selected && !item.queued && item.kind !== "refund"
  ).length;

  function patchItem(candidateId: string, patch: Partial<EditableCandidate>) {
    setItems(current =>
      current.map(item => {
        if (item.candidateId !== candidateId || item.queued || savingRef.current) return item;
        const duplicateKeyChanged = [
          "kind",
          "date",
          "time",
          "amount",
          "merchant",
          "paymentMethodId",
          "fromAccountId",
          "toAccountId"
        ].some(key => Object.prototype.hasOwnProperty.call(patch, key));
        const next = {
          ...(patch.kind ? changeImportKind(item, patch.kind) : item),
          ...patch,
          ...(duplicateKeyChanged ? { duplicate: null } : {})
        } as EditableCandidate;
        const classified = applyImportClassification(
          {
            ...next,
            ...(Object.prototype.hasOwnProperty.call(patch, "categoryId")
              ? { categorySource: "manual" as const }
              : {})
          },
          bootstrap
        );
        return { ...classified, reviewReasons: deriveReviewReasons(classified) };
      })
    );
  }

  function patchSelected(patch: Partial<EditableCandidate>) {
    setItems(current =>
      current.map(item => {
        if (!item.selected || item.kind === "refund" || item.queued || savingRef.current)
          return item;
        const duplicateKeyChanged = [
          "kind",
          "date",
          "time",
          "amount",
          "merchant",
          "paymentMethodId",
          "fromAccountId",
          "toAccountId"
        ].some(key => Object.prototype.hasOwnProperty.call(patch, key));
        const next = {
          ...(patch.kind ? changeImportKind(item, patch.kind) : item),
          ...patch,
          ...(duplicateKeyChanged ? { duplicate: null } : {})
        } as EditableCandidate;
        const classified = applyImportClassification(
          {
            ...next,
            ...(Object.prototype.hasOwnProperty.call(patch, "categoryId")
              ? { categorySource: "manual" as const }
              : {})
          },
          bootstrap
        );
        return { ...classified, reviewReasons: deriveReviewReasons(classified) };
      })
    );
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
    if (
      items.some(item => !item.queued) &&
      !(await confirmAction({
        title: "다시 분석하기",
        message:
          "현재 작성 중인 목록을 새 분석 결과로 바꿀까요? 이미 저장 대기열에 넣은 거래는 유지됩니다.",
        confirmLabel: "다시 분석",
        cancelLabel: "계속 입력하기"
      }))
    )
      return;
    setAnalyzing(true);
    setError("");
    setFeedback("");
    try {
      const sourceFiles = source === "image" ? files.slice(0, 4) : [];
      const maxPreparedImages = 8;
      const partsPerFile =
        sourceFiles.length > 0
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
        const candidate = applyImportClassification(
          {
            ...item,
            categorySource: "auto",
            requestId: createRequestId(),
            selected: item.selected
          } as EditableCandidate,
          bootstrap
        );
        return { ...candidate, reviewReasons: deriveReviewReasons(candidate) };
      });
      setItems(mappedItems);
      resetStep();
      setReviewMode("list");
      setStage("review");
      if (result.items.length === 0) {
        setFeedback("인식된 거래가 없습니다. 다른 캡처나 텍스트로 다시 시도해주세요.");
      }
    } catch (analysisError) {
      setError(
        analysisError instanceof Error ? analysisError.message : "거래 내역을 분석하지 못했습니다."
      );
    } finally {
      setAnalyzing(false);
    }
  }

  function addManualItem() {
    const requestId = createRequestId();
    const item: EditableCandidate = {
      candidateId: requestId,
      requestId,
      kind: "expense",
      selected: true,
      date: getSeoulDateString(),
      time: "",
      amount: 0,
      merchant: "",
      cardName: "",
      suggestedCategoryName: "",
      confidence: "high",
      memo: "",
      sourceText: "",
      categoryId: null,
      categoryName: "",
      categorySuggestionSource: null,
      paymentMethodId: null,
      paymentMethodName: "",
      fromAccountId: "",
      toAccountId: "",
      spendingTarget: bootstrap.spendingTargets.includes(userName) ? userName : "공동",
      duplicate: null,
      reviewReasons: []
    };
    item.reviewReasons = deriveReviewReasons(item);
    setItems(current => [...current, item]);
    setStage("review");
    openStep([requestId], 0);
  }

  /* ---------- 한 건씩 확인 ---------- */

  function resetStep() {
    setStepIds([]);
    setStepIndex(0);
    setStepError("");
    setSamePrompt(null);
    setPicker(null);
  }

  function openStep(ids: string[], index: number) {
    if (!ids.length) return;
    setStepIds(ids);
    setStepIndex(Math.min(Math.max(index, 0), ids.length - 1));
    setStepError("");
    setSamePrompt(null);
    setReviewMode("step");
    setError("");
    setFeedback("");
  }

  function startReview() {
    openStep(
      items.filter(needsReview).map(item => item.candidateId),
      0
    );
  }

  function openItem(candidateId: string) {
    const pendingIds = items.filter(needsReview).map(item => item.candidateId);
    const index = pendingIds.indexOf(candidateId);
    if (index >= 0) openStep(pendingIds, index);
    else openStep([candidateId], 0);
  }

  function backToList() {
    resetStep();
    setReviewMode("list");
  }

  function goToNextStep() {
    // '모두 적용' 등으로 이미 해결된 거래는 건너뜁니다.
    const nextIndex = stepIds.findIndex((candidateId, index) => {
      if (index <= stepIndex) return false;
      const next = items.find(item => item.candidateId === candidateId);
      return Boolean(next && needsReview(next));
    });
    if (nextIndex >= 0) {
      setStepIndex(nextIndex);
      setStepError("");
      setSamePrompt(null);
      return;
    }
    backToList();
    const ready = items.filter(item => item.selected && !item.queued).length;
    setFeedback(
      ready > 0
        ? `확인을 마쳤어요. [선택 ${ready}건 저장]을 눌러 저장해주세요.`
        : "확인을 마쳤어요."
    );
  }

  async function confirmStep(item: EditableCandidate) {
    const result = confirmReviewedItem(item);
    if (!result.ok) {
      setStepError(result.error);
      return;
    }
    if (
      result.duplicate &&
      !(await confirmAction({
        title: "중복 의심 거래",
        message: "이미 입력된 거래와 비슷합니다. 그래도 저장할 목록에 넣을까요?",
        confirmLabel: "넣기",
        cancelLabel: "다시 보기"
      }))
    )
      return;
    setItems(current =>
      current.map(row => (row.candidateId === item.candidateId ? result.item : row))
    );
    goToNextStep();
  }

  function handleStepPatch(item: EditableCandidate, patch: Partial<EditableCandidate>) {
    setStepError("");
    patchItem(item.candidateId, patch);
    if (patch.kind && patch.kind !== item.kind) setSamePrompt(null);
    if (patch.categoryId) {
      const others = findSameMerchantItems(items, { ...item, ...patch } as EditableCandidate);
      setSamePrompt(
        others.length
          ? {
              ids: others.map(other => other.candidateId),
              categoryId: patch.categoryId,
              categoryName: patch.categoryName || ""
            }
          : null
      );
    }
  }

  function applySameMerchant() {
    if (!samePrompt) return;
    for (const candidateId of samePrompt.ids) {
      patchItem(candidateId, {
        categoryId: samePrompt.categoryId,
        categoryName: samePrompt.categoryName
      });
    }
    setFeedback("");
    setSamePrompt(null);
  }

  function selectFromPicker(kind: PickerKind, value: string) {
    const item = stepItem;
    setPicker(null);
    if (!item) return;
    if (kind === "category") {
      const category = pickerCategories.find(row => row.categoryId === value);
      if (!category) {
        setStepError("대출 상환은 일반 입력 화면에서 입력해주세요.");
        return;
      }
      handleStepPatch(item, { categoryId: category.categoryId, categoryName: category.name });
      return;
    }
    if (kind === "paymentMethod") {
      handleStepPatch(item, {
        paymentMethodId: value,
        paymentMethodName: accountLabel(value)
      });
      return;
    }
    if (kind === "fromAccount") handleStepPatch(item, { fromAccountId: value });
    else handleStepPatch(item, { toAccountId: value });
  }

  async function handleSave() {
    if (savingRef.current) return;
    const selected = items.filter(item => item.selected && !item.queued && item.kind !== "refund");
    if (!selected.length) {
      setError("저장할 거래를 선택해주세요.");
      return;
    }
    // Validate the whole selection before queueing any item.
    let payloads;
    try {
      payloads = selected.map(item => buildImportPayload(item, bootstrap));
    } catch (validationError) {
      setError(
        validationError instanceof Error ? validationError.message : "입력 내용을 확인해주세요."
      );
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
        setItems(current =>
          current.map(row =>
            row.candidateId === item.candidateId ? { ...row, queued: true, selected: false } : row
          )
        );
      }
      setFeedback(
        `${queued}건을 기기에 보관했습니다. 서버 저장 상태는 입력 화면에서 확인할 수 있습니다.`
      );
    } catch (saveError) {
      setError(
        `${queued}건은 대기열에 추가되었습니다. 나머지 항목만 다시 시도해주세요. ${saveError instanceof Error ? saveError.message : "저장 공간을 확인해주세요."}`
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      title="거래 내역 가져오기"
      onClose={() => void handleClose()}
      contentClassName={styles.content}
      size="large"
    >
      <fieldset disabled={saving || analyzing} className={styles.formFields}>
        <span ref={reviewTopRef} aria-hidden="true" />
        {/* 한 건씩 확인할 때는 화면을 넓게 쓰도록 안내와 새로 시작 버튼을 숨깁니다. */}
        {(reviewMode !== "step" || !draftSaved) && (
          <p className={draftSaved ? styles.notice : styles.error} role="status">
            {draftSaved
              ? "작성 내용은 이 기기에 자동 임시저장됩니다. 원본 이미지는 보관하지 않습니다."
              : "임시저장에 실패했습니다. 화면을 닫기 전에 거래를 저장해주세요."}
          </p>
        )}
        {reviewMode !== "step" && (items.length > 0 || text || files.length > 0) && (
          <Button variant="secondary" onClick={() => void discardDraft()}>
            새로 시작
          </Button>
        )}
        {stage === "source" ? (
          <div className={styles.sourceGrid}>
            <div className={styles.sourceIntro}>
              <strong>가져올 방식을 선택해주세요</strong>
              <p>지출·수입·이체 내역을 가져오거나 직접 여러 건 입력할 수 있습니다.</p>
              <Button variant="secondary" onClick={addManualItem}>
                직접 일괄 입력
              </Button>
            </div>

            <div className={styles.sourceTabs} role="tablist" aria-label="거래 내역 입력 방식">
              <button
                type="button"
                role="tab"
                aria-selected={source === "image"}
                className={[styles.sourceTab, source === "image" ? styles.sourceTabActive : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setSource("image");
                  setError("");
                  setFeedback("");
                }}
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
                className={[styles.sourceTab, source === "text" ? styles.sourceTabActive : ""]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => {
                  setSource("text");
                  setError("");
                  setFeedback("");
                }}
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
                  onChange={event =>
                    updateFiles(Array.from(event.currentTarget.files || []) as File[])
                  }
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
                    <strong>
                      {files.length > 0 ? "다른 캡처 선택하기" : "카드·계좌 내역 캡처 선택"}
                    </strong>
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
                          <span className={styles.fileBadge} aria-hidden="true">
                            {index + 1}
                          </span>
                          <span className={styles.fileName} title={file.name}>
                            {file.name}
                          </span>
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

                <p className={styles.sourceHint}>
                  카드·은행 앱의 거래 내역을 캡처해주세요. 인식 후 지출·수입·이체와 계좌를 확인할 수
                  있습니다.
                </p>
              </div>
            ) : (
              <div className={styles.textPanel}>
                <label className={styles.field}>
                  <span>입출금 문자 또는 거래 내역</span>
                  <textarea
                    className={styles.textarea}
                    value={text}
                    onChange={event => setText(event.target.value)}
                    placeholder={
                      "예)\n09/15 스타벅스 5,800원\n09/15 GS25 7,200원\n\n여러 건을 그대로 붙여넣어도 됩니다."
                    }
                  />
                </label>
                <p className={styles.sourceHint}>
                  이미지를 선택할 필요 없이 붙여넣은 텍스트만 분석합니다.
                </p>
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
        ) : reviewMode === "step" && stepItem ? (
          <ImportStepReview
            item={stepItem}
            position={stepIndex + 1}
            total={stepIds.length}
            choices={stepChoices}
            hasImages={imageUrls.length > 0}
            sameMerchant={
              samePrompt
                ? { count: samePrompt.ids.length, categoryName: samePrompt.categoryName }
                : null
            }
            error={stepError}
            disabled={saving}
            onShowImages={() => setViewerOpen(true)}
            onPatch={patch => handleStepPatch(stepItem, patch)}
            onOpenPicker={setPicker}
            onApplySameMerchant={applySameMerchant}
            onDismissSameMerchant={() => setSamePrompt(null)}
            onConfirm={() => void confirmStep(stepItem)}
            onSkip={goToNextStep}
            onBack={backToList}
          />
        ) : (
          <ImportReviewList
            items={items}
            imageUrls={imageUrls}
            selectedCount={selectedCount}
            saving={saving}
            describe={describeItem}
            onShowImages={() => setViewerOpen(true)}
            onStartReview={startReview}
            onOpenItem={openItem}
            onToggle={(candidateId, selected) => patchItem(candidateId, { selected })}
            onAdd={addManualItem}
            onReanalyze={() => {
              setStage("source");
              setError("");
            }}
            onSave={handleSave}
            message={
              <>
                {error && <p className={styles.error}>{error}</p>}
                {feedback && <p className={styles.feedback}>{feedback}</p>}
              </>
            }
            bulkEdit={
              <>
                {items.length > 1 && (
                  <details className={reviewStyles.bulk}>
                    <summary>체크한 거래 한 번에 바꾸기</summary>
                    <div className={reviewStyles.bulkBody}>
                      <span>
                        {selectedCount > 0
                          ? `체크한 ${selectedCount}건에 바로 적용됩니다.`
                          : "먼저 목록에서 거래를 체크해주세요."}
                      </span>
                      <select
                        className={styles.bulkSelect}
                        value=""
                        disabled={!selectedCount}
                        aria-label="선택 항목 유형 일괄 변경"
                        onChange={event =>
                          patchSelected({ kind: event.target.value as ImportKind })
                        }
                      >
                        <option value="">거래 유형 일괄 변경</option>
                        <option value="expense">지출</option>
                        <option value="income">수입</option>
                        <option value="transfer">이체</option>
                      </select>
                      <select
                        className={styles.bulkSelect}
                        value=""
                        disabled={!selectedCount || !bulkKind}
                        aria-label="선택 항목 카테고리 일괄 변경"
                        onChange={event => {
                          const category = bulkCategories.find(
                            row => row.categoryId === event.target.value
                          );
                          if (category)
                            patchSelected({
                              categoryId: category.categoryId,
                              categoryName: category.name
                            });
                        }}
                      >
                        <option value="">
                          {bulkKind ? "카테고리 일괄 변경" : "같은 유형끼리 선택해주세요"}
                        </option>
                        {bulkCategories.map(category => (
                          <option key={category.categoryId} value={category.categoryId}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      {bulkKind === "expense" && (
                        <>
                          <select
                            className={styles.bulkSelect}
                            value=""
                            aria-label="선택 항목 결제수단 일괄 변경"
                            onChange={event => {
                              const account = paymentMethods.find(
                                row => row.accountId === event.target.value
                              );
                              if (account)
                                patchSelected({
                                  paymentMethodId: account.accountId,
                                  paymentMethodName: account.displayName
                                });
                            }}
                          >
                            <option value="">결제수단 일괄 변경</option>
                            {paymentMethodOptions}
                          </select>
                          <select
                            className={styles.bulkSelect}
                            value=""
                            aria-label="선택 항목 지출대상 일괄 변경"
                            onChange={event =>
                              patchSelected({ spendingTarget: event.target.value })
                            }
                          >
                            <option value="">지출대상 일괄 변경</option>
                            {bootstrap.spendingTargets.map(target => (
                              <option key={target}>{target}</option>
                            ))}
                          </select>
                        </>
                      )}
                      {bulkKind === "transfer" && (
                        <select
                          className={styles.bulkSelect}
                          value=""
                          aria-label="선택 항목 출금계좌 일괄 변경"
                          onChange={event => patchSelected({ fromAccountId: event.target.value })}
                        >
                          <option value="">출금계좌 일괄 변경</option>
                          {accountOptions}
                        </select>
                      )}
                      {(bulkKind === "income" || bulkKind === "transfer") && (
                        <select
                          className={styles.bulkSelect}
                          value=""
                          aria-label="선택 항목 입금계좌 일괄 변경"
                          onChange={event => patchSelected({ toAccountId: event.target.value })}
                        >
                          <option value="">입금계좌 일괄 변경</option>
                          {accountOptions}
                        </select>
                      )}
                    </div>
                  </details>
                )}
              </>
            }
          />
        )}
      </fieldset>
      {picker &&
        stepItem &&
        createPortal(
          // 아래 선택창의 Esc·Tab 키가 바깥 가져오기 창까지 올라가 닫히지 않게 막습니다.
          <div onKeyDown={event => event.stopPropagation()}>
            <InputPickerSheet
              kind={picker === "toAccount" && stepItem.kind === "income" ? "incomeAccount" : picker}
              mode={stepItem.kind === "refund" ? "expense" : stepItem.kind}
              userName={userName}
              orderedAllAccounts={pickerAccounts.ordered}
              visibleAccounts={pickerAccounts.visible}
              creditCards={pickerAccounts.creditCards}
              cardSourceAccounts={[]}
              visibleAccountIds={pickerAccounts.visibleIds}
              investmentAccountIds={new Set()}
              categories={pickerCategories}
              spendingTargets={bootstrap.spendingTargets}
              selection={{
                categoryId: stepItem.categoryId || "",
                paymentMethodId: stepItem.paymentMethodId || "",
                spendingTarget: stepItem.spendingTarget,
                fromAccountId: stepItem.fromAccountId || "",
                toAccountId: stepItem.toAccountId || "",
                investmentAccountId: ""
              }}
              merchant={stepItem.merchant}
              onSelect={selectFromPicker}
              onClose={() => setPicker(null)}
            />
          </div>,
          document.body
        )}
      {viewerOpen &&
        imageUrls.length > 0 &&
        createPortal(
          <div
            className={reviewStyles.viewer}
            role="dialog"
            aria-modal="true"
            aria-label="원본 캡처"
            onKeyDown={event => {
              event.stopPropagation();
              if (event.key === "Escape") setViewerOpen(false);
            }}
          >
            <div className={reviewStyles.viewerHead}>
              <span>원본 캡처 {imageUrls.length}장</span>
              <button type="button" autoFocus onClick={() => setViewerOpen(false)}>
                닫기
              </button>
            </div>
            <div className={reviewStyles.viewerBody}>
              {imageUrls.map((url, index) => (
                <img key={url} src={url} alt={`원본 캡처 ${index + 1}`} />
              ))}
            </div>
          </div>,
          document.body
        )}
    </BottomSheet>
  );
}
