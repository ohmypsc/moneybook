import { useEffect, useRef, useState } from "react";
import type { DashboardData } from "../../types/dashboard";
import { getBootstrap } from "../../api/bootstrap";
import { apiRequest } from "../../api/client";
import { subscribeLedgerChanges } from "../../utils/ledgerEvents";
import { Button } from "../common/Button/Button";
import { formatMoney } from "../common/Money/Money";
import { isLivingAccount, livingSummary } from "./householdDomain";
import styles from "./Household.module.css";

export function HouseholdOverview({
  dashboard,
  updatedLabel
}: {
  dashboard: DashboardData;
  updatedLabel: string;
}) {
  const [accountIds, setAccountIds] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const busyRef = useRef(false);
  useEffect(() => {
    let active = true;
    let generation = 0;
    async function load() {
      const request = ++generation;
      try {
        const response = await getBootstrap();
        if (!response.success || !response.data)
          throw new Error("생활비 계좌 설정을 불러오지 못했습니다.");
        if (active && request === generation) {
          setAccountIds(response.data.householdOverview?.livingAccountIds ?? null);
          setLoaded(true);
          setError("");
        }
      } catch (e) {
        if (active && request === generation)
          setError(e instanceof Error ? e.message : "계좌 설정 확인이 필요합니다.");
      }
    }
    void load();
    const unsubscribe = subscribeLedgerChanges(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [retry]);
  const summary = livingSummary(dashboard, accountIds);
  const available = dashboard.accounts.filter(isLivingAccount);
  async function save() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await apiRequest("/api/settings/household-overview", {
        method: "POST",
        body: JSON.stringify({ livingAccountIds: draft })
      });
      setAccountIds(draft);
      setLoaded(true);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "설정을 저장하지 못했습니다.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} aria-label="공동 생활비 요약">
      <div className={styles.heading}>
        <h2>이번 달 공동 생활비</h2>
        <span className={styles.hint}>{dashboard.month}</span>
      </div>
      <div className={styles.grid}>
        <div className={styles.metric}>
          <span>공동으로 분류한 지출</span>
          <strong>{formatMoney(summary.expense)}</strong>
        </div>
        <div className={styles.metric}>
          <span>생활비 계좌 잔액</span>
          <strong>
            {!loaded
              ? error
                ? "확인 필요"
                : "확인 중"
              : summary.accounts.length
                ? formatMoney(summary.balance)
                : "계좌 선택"}
          </strong>
        </div>
      </div>
      <p className={styles.hint}>
        지출은 ‘공동’으로 기록한 내역 기준입니다. 잔액은 가계부 입력 기준이며 카드 결제 예정액을
        차감한 금액은 아닙니다.{updatedLabel && ` · 가계부 갱신 ${updatedLabel}`}
      </p>
      {loaded && (
        <p className={styles.hint}>
          합산 계좌:{" "}
          {summary.accounts.map(account => account.displayName).join(" · ") || "선택된 계좌 없음"}
        </p>
      )}
      <Button
        variant="secondary"
        size="sm"
        disabled={busy || !loaded}
        onClick={() => {
          setDraft(summary.accounts.map(account => account.accountId));
          setEditing(value => !value);
        }}
      >
        생활비 계좌 {editing ? "선택 닫기" : "선택"}
      </Button>
      {editing && (
        <div className={styles.editor}>
          <p className={styles.hint}>
            각자 명의의 통장도 함께 선택할 수 있습니다. 이 선택은 두 분에게 동일하게 적용됩니다.
          </p>
          {available.map(account => (
            <label className={styles.check} key={account.accountId}>
              <input
                type="checkbox"
                disabled={busy}
                checked={draft.includes(account.accountId)}
                onChange={event =>
                  setDraft(current =>
                    event.target.checked
                      ? [...current, account.accountId]
                      : current.filter(id => id !== account.accountId)
                  )
                }
              />
              {account.displayName} · {account.owner || "명의 미지정"}
            </label>
          ))}
          <Button loading={busy} onClick={() => void save()}>
            함께 볼 계좌 저장
          </Button>
        </div>
      )}
      {error && (
        <>
          <p className={styles.hint} role="alert">
            {error}
          </p>
          <Button variant="secondary" size="sm" onClick={() => setRetry(value => value + 1)}>
            다시 불러오기
          </Button>
        </>
      )}
    </section>
  );
}
