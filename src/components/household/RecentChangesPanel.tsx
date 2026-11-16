import { useEffect, useState } from "react";
import { apiRequest } from "../../api/client";
import type { RealtimeChange } from "../../utils/realtimeSync";
import { subscribeLedgerChanges } from "../../utils/ledgerEvents";
import { Button } from "../common/Button/Button";
import { changeDescription } from "./changeDescription";
import styles from "./Household.module.css";

export function RecentChangesPanel() {
  const [changes, setChanges] = useState<RealtimeChange[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; let controller: AbortController | null = null;
    async function load() {
      controller?.abort(); controller = new AbortController(); const request = controller;
      try {
        const response = await apiRequest<{ success: boolean; data: { changes: RealtimeChange[] } }>("/api/changes?recent=1&limit=20", { signal: request.signal });
        if (active && !request.signal.aborted) { setChanges(response.data.changes); setError(""); }
      } catch (e) {
        if (active && !request.signal.aborted) setError("최근 변경 사항을 불러오지 못했습니다. 연결 후 다시 확인해주세요.");
      } finally { if (active && !request.signal.aborted) setLoading(false); }
    }
    void load();
    const unsubscribe = subscribeLedgerChanges(() => void load());
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { active = false; controller?.abort(); unsubscribe(); document.removeEventListener("visibilitychange", onVisible); };
  }, [retry]);
  return <section className={styles.panel} aria-label="최근 변경 내역">
    <div className={styles.heading}><h2>최근 함께 기록한 내용</h2>{changes.length > 5 && <Button size="sm" variant="ghost" onClick={() => setExpanded(value => !value)}>{expanded ? "접기" : "최근 20건 보기"}</Button>}</div>
    {loading && <p className={styles.hint} role="status">변경 내역을 불러오는 중입니다.</p>}
    {!loading && !error && !changes.length && <p className={styles.hint}>아직 기록된 변경 사항이 없습니다.</p>}
    <ul className={styles.list}>{(expanded ? changes : changes.slice(0, 5)).map(change => {
      const date = new Date(change.changedAt || "");
      const time = Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "시간 미상";
      return <li key={change.changeSeq}><strong>{change.changedBy || "자동 처리"} · {changeDescription(change)}</strong><span className={styles.hint}>{time}</span></li>;
    })}</ul>
    {error && <><p className={styles.hint} role="alert">{error}</p><Button size="sm" variant="secondary" onClick={() => setRetry(value => value + 1)}>다시 불러오기</Button></>}
  </section>;
}
