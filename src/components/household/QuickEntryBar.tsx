import { useEffect, useRef, useState } from "react";
import type { BootstrapData, BootstrapResponse } from "../../types/bootstrap";
import { getBootstrap } from "../../api/bootstrap";
import { apiRequest } from "../../api/client";
import { clearBootstrapMemoryCache } from "../../api/bootstrapCache";
import { getInputPreferences, normalizeInputPreferences, parseQuickEntries, saveInputPreferences, type QuickEntry } from "../../utils/inputPreferences";
import { Button } from "../common/Button/Button";
import { validateQuickEntry } from "./householdDomain";
import styles from "./Household.module.css";

export function QuickEntryBar({ userName, bootstrap, current, onApply }: {
  userName: string; bootstrap: BootstrapData; current: Omit<QuickEntry, "id" | "name">;
  onApply: (entry: QuickEntry) => void | Promise<void>;
}) {
  const [entries, setEntries] = useState<QuickEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    setEntries(parseQuickEntries(getInputPreferences(bootstrap.categories, bootstrap.accounts, userName).quickEntries));
  }, [bootstrap, userName]);

  async function save(removeId?: string) {
    if (busyRef.current) return;
    const entry: QuickEntry = { ...current, id: crypto.randomUUID(), name: name.trim() };
    if (!removeId) {
      if (!entry.name) { setMessage("버튼 이름을 입력해주세요. 예: 점심, 장보기"); return; }
      const issue = validateQuickEntry(entry, bootstrap);
      if (issue) { setMessage(issue); return; }
    }
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      clearBootstrapMemoryCache();
      const response = await getBootstrap<BootstrapResponse>();
      if (!response.success || !response.data || response.data.userName !== userName) throw new Error("로그인 정보를 다시 확인해주세요.");
      const data = response.data;
      const preferences = normalizeInputPreferences(data.inputPreferences?.preferences || null, data.categories, data.accounts);
      const latest = parseQuickEntries(preferences.quickEntries);
      if (!removeId && latest.length >= 5) throw new Error("빠른 입력은 최대 5개입니다. 사용하지 않는 버튼을 먼저 삭제해주세요.");
      if (!removeId) {
        const issue = validateQuickEntry(entry, data);
        if (issue) throw new Error(issue);
      }
      const next = { ...preferences, quickEntries: removeId ? latest.filter(item => item.id !== removeId) : [...latest, entry] };
      await apiRequest("/api/settings/input-preferences", { method: "POST", body: JSON.stringify({ preferences: next }) });
      saveInputPreferences(next, userName); setEntries(next.quickEntries); setName("");
      setMessage(removeId ? "버튼을 삭제했습니다." : "내 빠른 입력에 추가했습니다. 금액과 날짜는 저장하지 않습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "빠른 입력을 저장하지 못했습니다."); }
    finally { setBusy(false); busyRef.current = false; }
  }

  return <section className={styles.panel} aria-label="내 빠른 입력">
    <div className={styles.heading}><strong>{userName}님의 빠른 입력</strong><Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(value => !value)}>{editing ? "닫기" : "버튼 관리"}</Button></div>
    <div className={styles.wrap}>{entries.map(entry => <Button key={entry.id} variant="secondary" disabled={busy} onClick={() => {
      const issue = validateQuickEntry(entry, bootstrap);
      if (issue) { setMessage(`${entry.name}: ${issue} 버튼을 삭제한 뒤 새로 등록해주세요.`); return; }
      void onApply(entry);
    }}>{entry.name}</Button>)}</div>
    {!entries.length && <p className={styles.hint}>자주 쓰는 카테고리와 계좌를 선택한 뒤 버튼으로 등록하세요. 다음에는 금액만 입력하면 됩니다.</p>}
    {editing && <div className={styles.editor}>
      <label>버튼 이름<input maxLength={24} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="예: 점심, 장보기, 급여" /></label>
      <Button size="sm" loading={busy} disabled={entries.length >= 5} onClick={() => void save()}>현재 선택을 버튼으로 저장</Button>
      <p className={styles.hint}>카테고리·계좌·지출대상·거래 내용을 저장합니다. 날짜·금액·메모·할부는 매번 확인해주세요.</p>
      {entries.map(entry => <div className={styles.row} key={entry.id}><span>{entry.name}</span><Button size="sm" variant="dangerSoft" disabled={busy} onClick={() => void save(entry.id)} aria-label={`${entry.name} 빠른 입력 삭제`}>삭제</Button></div>)}
    </div>}
    {message && <p className={styles.hint} role="status">{message}</p>}
  </section>;
}
