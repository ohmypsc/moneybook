import { useEffect, useMemo, useRef, useState } from "react";

import {
  createSettlementBatch,
  getSettlementCandidates,
  type CreateSettlementBatchResult,
  type SettlementCandidate
} from "../../api/settlements";
import type { Account } from "../../types/api";
import { getSeoulDateString } from "../../utils/dateTime";
import { SETTLEMENT_BATCH_LIMIT, allocateSettlement } from "../../utils/settlement";
import { Button } from "../common/Button/Button";
import { formatMoney } from "../common/Money/Money";
import styles from "./SettlementReceiveForm.module.css";

export interface SettlementPrefill {
  amount?: number;
  date?: string;
  toAccountId?: string;
  memo?: string;
}

interface SettlementReceiveFormProps {
  accounts: Account[];
  /** 정산받기를 연 지출. 표시가 없어도 목록 맨 위에 체크된 상태로 보입니다. */
  anchorTransactionId?: string;
  /** 캡처에서 읽은 입금 내역처럼 미리 채울 값 */
  prefill?: SettlementPrefill;
  submitLabel?: string;
  onSaved: (result: CreateSettlementBatchResult) => void;
  onCancel?: () => void;
}

export function receivableSettlementAccounts(accounts: Account[]) {
  return accounts
    .filter(
      account =>
        account.active &&
        !account.isDeleted &&
        account.accountType === "자산" &&
        account.subType !== "신용카드" &&
        account.subType !== "체크카드"
    )
    .sort((first, second) => {
      const firstCash = first.subType === "현금" ? 0 : 1;
      const secondCash = second.subType === "현금" ? 0 : 1;
      if (firstCash !== secondCash) return firstCash - secondCash;
      return first.displayName.localeCompare(second.displayName, "ko");
    });
}

function shortDate(date: string) {
  const match = date.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : date;
}

function parseAmount(value: string) {
  const amount = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(amount) ? amount : 0;
}

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "요청을 처리하지 못했습니다.";
}

export function SettlementReceiveForm({
  accounts,
  anchorTransactionId,
  prefill,
  submitLabel = "정산 반영",
  onSaved,
  onCancel
}: SettlementReceiveFormProps) {
  const receiveAccounts = useMemo(() => receivableSettlementAccounts(accounts), [accounts]);
  const [candidates, setCandidates] = useState<SettlementCandidate[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showOthers, setShowOthers] = useState(!anchorTransactionId);
  const [totalText, setTotalText] = useState(prefill?.amount ? String(prefill.amount) : "");
  const [manualAmounts, setManualAmounts] = useState<Record<string, string> | null>(null);
  const [date, setDate] = useState(prefill?.date || getSeoulDateString());
  const [accountId, setAccountId] = useState(
    prefill?.toAccountId && receiveAccounts.some(a => a.accountId === prefill.toAccountId)
      ? prefill.toAccountId
      : receiveAccounts[0]?.accountId || ""
  );
  const [memo, setMemo] = useState(prefill?.memo || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const requestRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  async function load() {
    setLoadError("");
    try {
      const response = await getSettlementCandidates(anchorTransactionId);
      setCandidates(response.items);
      setSelected(current => {
        const valid = new Set(
          [...current].filter(id => response.items.some(item => item.transactionId === id))
        );
        if (
          anchorTransactionId &&
          response.items.some(i => i.transactionId === anchorTransactionId)
        )
          valid.add(anchorTransactionId);
        return valid;
      });
    } catch (loadFailure) {
      setLoadError(errorText(loadFailure));
      setCandidates([]);
    }
  }

  useEffect(() => {
    void load();
  }, [anchorTransactionId]);

  const anchor = candidates?.find(item => item.transactionId === anchorTransactionId) || null;
  const others = (candidates || []).filter(item => item.transactionId !== anchorTransactionId);
  const selectedItems = (candidates || []).filter(item => selected.has(item.transactionId));
  const remainingSum = selectedItems.reduce((sum, item) => sum + item.remainingAmount, 0);

  const allocation = useMemo(() => {
    if (manualAmounts) {
      const amounts: Record<string, number> = {};
      for (const item of selectedItems)
        amounts[item.transactionId] = parseAmount(manualAmounts[item.transactionId] || "");
      return { amounts, overflow: 0 };
    }
    return allocateSettlement(parseAmount(totalText), selectedItems);
    // selectedItems is derived from candidates and selected.
  }, [manualAmounts, totalText, candidates, selected]);

  const appliedTotal = Object.values(allocation.amounts).reduce((sum, value) => sum + value, 0);
  const appliedCount = Object.values(allocation.amounts).filter(value => value > 0).length;
  const shownTotal = manualAmounts ? String(appliedTotal || "") : totalText;
  const latestOriginalDate = selectedItems
    .filter(item => (allocation.amounts[item.transactionId] || 0) > 0)
    .reduce((latest, item) => (item.date > latest ? item.date : latest), "");

  function toggle(transactionId: string, checked: boolean) {
    setError("");
    setSelected(current => {
      const next = new Set(current);
      if (checked) next.add(transactionId);
      else next.delete(transactionId);
      return next;
    });
    if (manualAmounts && !checked) {
      const next = { ...manualAmounts };
      delete next[transactionId];
      setManualAmounts(next);
    }
  }

  function selectAllOthers() {
    setError("");
    setSelected(current => {
      const next = new Set(current);
      for (const item of others) next.add(item.transactionId);
      return next;
    });
  }

  function editRow(transactionId: string, value: string) {
    setError("");
    const base: Record<string, string> = {};
    for (const item of selectedItems)
      base[item.transactionId] = String(allocation.amounts[item.transactionId] || "");
    setManualAmounts({ ...base, ...manualAmounts, [transactionId]: value.replace(/[^0-9]/g, "") });
  }

  function editTotal(value: string) {
    setError("");
    setManualAmounts(null);
    setTotalText(value.replace(/[^0-9]/g, ""));
  }

  async function save() {
    if (savingRef.current) return;
    const items = selectedItems
      .map(item => ({
        transactionId: item.transactionId,
        amount: allocation.amounts[item.transactionId] || 0,
        remaining: item.remainingAmount,
        label: item.description || item.category || "지출"
      }))
      .filter(item => item.amount > 0);
    if (!selectedItems.length) return setError("어느 지출의 정산금인지 선택해주세요.");
    if (!items.length) return setError("정산받은 금액을 입력해주세요.");
    if (items.length > SETTLEMENT_BATCH_LIMIT)
      return setError(`한 번에 최대 ${SETTLEMENT_BATCH_LIMIT}건까지 정산할 수 있습니다.`);
    if (allocation.overflow > 0)
      return setError(
        `받은 금액이 선택한 지출의 남은 금액 합계 ${formatMoney(remainingSum)}보다 ${formatMoney(allocation.overflow)} 많아요. 지출을 더 선택하거나 금액을 확인해주세요.`
      );
    const over = items.find(item => item.amount > item.remaining + 0.0001);
    if (over)
      return setError(
        `${over.label}: 남은 금액 ${formatMoney(over.remaining)}을 넘을 수 없습니다.`
      );
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return setError("받은 날짜를 확인해주세요.");
    if (latestOriginalDate && date < latestOriginalDate)
      return setError(`받은 날짜는 선택한 지출일(${latestOriginalDate})보다 앞설 수 없습니다.`);
    if (!accountId) return setError("정산금을 받은 현금 또는 계좌를 선택해주세요.");

    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const payload = {
        items: items.map(({ transactionId, amount }) => ({ transactionId, amount })),
        toAccountId: accountId,
        date,
        memo: memo.trim()
      };
      const fingerprint = JSON.stringify(payload);
      if (requestRef.current?.fingerprint !== fingerprint) {
        requestRef.current = {
          fingerprint,
          requestId: globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID()
            : `${Date.now()}_${Math.random().toString(16).slice(2)}`
        };
      }
      const result = await createSettlementBatch({
        ...payload,
        requestId: requestRef.current.requestId
      });
      requestRef.current = null;
      setTotalText("");
      setManualAmounts(null);
      setMemo("");
      setSelected(new Set());
      onSaved(result);
      await load();
    } catch (saveError) {
      setError(errorText(saveError));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function renderRow(item: SettlementCandidate) {
    const checked = selected.has(item.transactionId);
    const amount = allocation.amounts[item.transactionId] || 0;
    return (
      <div
        key={item.transactionId}
        className={[styles.row, checked ? styles.rowChecked : ""].filter(Boolean).join(" ")}
      >
        <label className={styles.rowMain}>
          <input
            type="checkbox"
            checked={checked}
            disabled={saving}
            onChange={event => toggle(item.transactionId, event.target.checked)}
          />
          <span className={styles.rowText}>
            <strong>{item.description || item.category || "지출"}</strong>
            <span>
              {shortDate(item.date)} · {item.category || "카테고리 없음"} · 남은{" "}
              {formatMoney(item.remainingAmount)}
            </span>
          </span>
        </label>
        {checked && (
          <input
            className={styles.rowAmount}
            inputMode="numeric"
            aria-label={`${item.description || "지출"}에 반영할 금액`}
            disabled={saving}
            value={
              manualAmounts
                ? Number(manualAmounts[item.transactionId] || 0).toLocaleString("ko-KR")
                : amount.toLocaleString("ko-KR")
            }
            onChange={event => editRow(item.transactionId, event.target.value)}
          />
        )}
      </div>
    );
  }

  if (!candidates) return <p className={styles.notice}>정산할 지출을 불러오는 중...</p>;

  return (
    <div className={styles.form}>
      <div className={styles.fields}>
        <label className={[styles.field, styles.wide].join(" ")}>
          <span>받은 총액</span>
          <input
            inputMode="numeric"
            className={styles.totalInput}
            value={shownTotal ? Number(shownTotal).toLocaleString("ko-KR") : ""}
            placeholder={remainingSum ? `최대 ${formatMoney(remainingSum)}` : "0"}
            disabled={saving}
            onChange={event => editTotal(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>받은 날짜</span>
          <input
            type="date"
            value={date}
            min={latestOriginalDate || undefined}
            disabled={saving}
            onChange={event => {
              setError("");
              setDate(event.target.value);
            }}
          />
        </label>
        <label className={styles.field}>
          <span>받은 곳</span>
          <select
            value={accountId}
            disabled={saving || receiveAccounts.length === 0}
            onChange={event => setAccountId(event.target.value)}
          >
            {receiveAccounts.length === 0 && <option value="">받을 계좌가 없습니다</option>}
            {receiveAccounts.map(account => (
              <option key={account.accountId} value={account.accountId}>
                {account.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className={[styles.field, styles.wide].join(" ")}>
          <span>메모</span>
          <input
            value={memo}
            disabled={saving}
            placeholder="예: 11월 회식비 3명분"
            onChange={event => setMemo(event.target.value)}
          />
        </label>
      </div>

      <section className={styles.listSection}>
        <div className={styles.listHeader}>
          <strong>어느 지출의 정산금인가요?</strong>
          <span>오래된 지출부터 자동으로 나눠요. 금액은 직접 고칠 수 있어요.</span>
        </div>
        {loadError && <p className={styles.error}>{loadError}</p>}
        {anchor && <div className={styles.rows}>{renderRow(anchor)}</div>}
        {anchorTransactionId && others.length > 0 && !showOthers && (
          <button type="button" className={styles.moreButton} onClick={() => setShowOthers(true)}>
            다른 정산 예정 지출 {others.length}건도 함께 받기
          </button>
        )}
        {showOthers && others.length > 0 && (
          <>
            {others.length > 1 && (
              <button type="button" className={styles.linkButton} onClick={selectAllOthers}>
                {anchor ? "다른 지출 모두 선택" : "모두 선택"}
              </button>
            )}
            <div className={styles.rows}>{others.map(renderRow)}</div>
          </>
        )}
        {!anchor && others.length === 0 && !loadError && (
          <p className={styles.notice}>
            정산 예정으로 표시한 지출이 없어요. 지출을 입력하거나 수정할 때 ‘정산받을 예정’을
            체크하면 여기에 나타나요.
          </p>
        )}
      </section>

      {selectedItems.length > 0 && (
        <p className={styles.summary}>
          선택 {selectedItems.length}건 · 남은 금액 합계 {formatMoney(remainingSum)} · 반영{" "}
          <strong>{formatMoney(appliedTotal)}</strong>
          {allocation.overflow > 0 && (
            <span className={styles.overflow}> · {formatMoney(allocation.overflow)} 초과</span>
          )}
        </p>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        {onCancel && (
          <Button variant="secondary" size="sm" disabled={saving} onClick={onCancel}>
            취소
          </Button>
        )}
        <Button
          size="sm"
          loading={saving}
          loadingLabel="반영 중..."
          disabled={!accountId || selectedItems.length === 0}
          onClick={() => void save()}
        >
          {appliedCount > 1 ? `${appliedCount}건 ${submitLabel}` : submitLabel}
        </Button>
      </div>
    </div>
  );
}
