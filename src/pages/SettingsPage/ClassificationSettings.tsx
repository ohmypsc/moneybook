import { useEffect, useRef, useState } from "react";
import { getBootstrap } from "../../api/bootstrap";
import {
  getClassificationSettings,
  saveClassificationSettings,
  previewClassification,
  applyClassification
} from "../../api/classification";
import type {
  ClassificationRule,
  ClassificationSettings as Settings,
  ClassificationPreview
} from "../../api/classification";
import type { BootstrapData } from "../../types/bootstrap";
import { normalizeRules, normalizeTags } from "../../../shared/classification.js";
import { Button } from "../../components/common/Button/Button";
import { TagsInput, TagChips } from "../../components/classification/TagsInput";
import { getSeoulDateString } from "../../utils/dateTime";
import { markLedgerChanged } from "../../utils/ledgerEvents";
import { confirmAction } from "../../utils/confirmAction";
import styles from "../../components/classification/classification.module.css";
const blank = (): ClassificationRule => ({
  id: crypto.randomUUID(),
  name: "",
  type: "지출",
  contains: "",
  accountId: "",
  categoryId: "",
  tags: [],
  enabled: true,
  priority: 0
});
export default function ClassificationSettings() {
  const [settings, setSettings] = useState<Settings>({ rules: [], version: 0 });
  const [bootstrap, setBootstrap] = useState<BootstrapData>();
  const [draft, setDraft] = useState(blank);
  const [tags, setTags] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const today = getSeoulDateString();
  const [dateFrom, setDateFrom] = useState(`${today.slice(0, 7)}-01`);
  const [dateTo, setDateTo] = useState(today);
  const [preview, setPreview] = useState<ClassificationPreview>();
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했습니다.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function load() {
    const [saved, raw] = await Promise.all([getClassificationSettings(), getBootstrap()]);
    if (!raw.data) throw new Error("계좌와 카테고리를 불러오지 못했습니다.");
    setSettings(saved);
    setBootstrap(raw.data);
    setLoaded(true);
    setPreview(undefined);
  }
  useEffect(() => {
    void run(load);
  }, []);
  async function persist(rules: ClassificationRule[]) {
    const saved = await saveClassificationSettings({
      version: settings.version,
      rules: normalizeRules(rules)
    });
    setSettings(saved);
    setPreview(undefined);
    markLedgerChanged();
    setNotice("규칙을 저장했습니다. 새 거래에 자동 적용됩니다.");
  }
  async function showPreview(offset = 0) {
    const next = await previewClassification(dateFrom, dateTo, offset);
    setPreview(next);
    setSelected(next.items.map(i => i.transactionId));
  }
  return (
    <div className={styles.stack}>
      <section className={styles.panel}>
        <h2>자동 분류 규칙</h2>
        <p>
          위 규칙부터 확인합니다. 카테고리는 먼저 맞는 규칙 하나, 태그는 맞는 규칙 모두에서
          가져옵니다. 직접 선택한 카테고리는 유지합니다. 여러 조건을 지정하면 모두 맞아야
          적용됩니다.
        </p>
        <div className={styles.row}>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(load)}>
            다시 불러오기
          </Button>
          <span className={styles.muted}>{settings.rules.length} / 50개</span>
        </div>
        {loaded && !settings.rules.length && <p>예: 내용에 ‘스타벅스’ 포함 → 카페 카테고리</p>}
        {settings.rules.map((rule, index) => (
          <article className={styles.rule} key={rule.id}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={busy}
                onChange={() =>
                  void run(() =>
                    persist(
                      settings.rules.map(r =>
                        r.id === rule.id ? { ...r, enabled: !r.enabled } : r
                      )
                    )
                  )
                }
              />
              <strong>
                {index + 1}. {rule.name}
              </strong>
            </label>
            <p>
              {rule.type} · {rule.contains ? `내용에 ‘${rule.contains}’ 포함` : "모든 내용"}
              {rule.accountId
                ? ` · ${bootstrap?.accounts.find(a => a.accountId === rule.accountId)?.displayName || "사용 불가 계좌"}`
                : ""}
            </p>
            <p>
              카테고리:{" "}
              {rule.categoryId
                ? bootstrap?.categories.find(c => c.categoryId === rule.categoryId)?.name ||
                  "사용 불가 카테고리"
                : "유지"}
            </p>
            <TagChips tags={rule.tags} />
            <div className={styles.row}>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setDraft({ ...rule });
                  setTags(rule.tags.join(", "));
                  setEditing(true);
                }}
              >
                수정
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || index === 0}
                aria-label={`${rule.name} 우선순위 올리기`}
                onClick={() =>
                  void run(async () => {
                    const rows = [...settings.rules];
                    [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
                    await persist(rows);
                  })
                }
              >
                ↑
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || index === settings.rules.length - 1}
                aria-label={`${rule.name} 우선순위 내리기`}
                onClick={() =>
                  void run(async () => {
                    const rows = [...settings.rules];
                    [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]];
                    await persist(rows);
                  })
                }
              >
                ↓
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (
                      await confirmAction({
                        title: "규칙 삭제",
                        message: `‘${rule.name}’ 규칙을 삭제할까요? 이미 기록된 거래와 태그는 유지됩니다.`,
                        confirmLabel: "삭제"
                      })
                    ) {
                      await persist(settings.rules.filter(r => r.id !== rule.id));
                      if (draft.id === rule.id) {
                        setDraft(blank());
                        setTags("");
                        setEditing(false);
                      }
                    }
                  })
                }
              >
                삭제
              </Button>
            </div>
          </article>
        ))}
      </section>
      <form
        className={styles.panel}
        onSubmit={event => {
          event.preventDefault();
          void run(async () => {
            const rule = { ...draft, tags: normalizeTags(tags) };
            await persist(
              editing
                ? settings.rules.map(r => (r.id === draft.id ? rule : r))
                : [...settings.rules, rule]
            );
            setDraft(blank());
            setTags("");
            setEditing(false);
          });
        }}
      >
        <h2>{editing ? "규칙 수정" : "새 규칙"}</h2>
        <label className={styles.field}>
          규칙 이름
          <input
            required
            maxLength={60}
            value={draft.name}
            disabled={busy}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            placeholder="예: 카페 자동 분류"
          />
        </label>
        <div className={styles.grid}>
          <label className={styles.field}>
            거래 유형
            <select
              value={draft.type}
              disabled={busy}
              onChange={e =>
                setDraft({
                  ...draft,
                  type: e.target.value as ClassificationRule["type"],
                  categoryId: ""
                })
              }
            >
              {["지출", "수입", "이체"].map(t => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            거래 내용에 포함
            <input
              maxLength={100}
              value={draft.contains}
              disabled={busy}
              onChange={e => setDraft({ ...draft, contains: e.target.value })}
              placeholder="예: 스타벅스"
            />
          </label>
          <label className={styles.field}>
            사용 계좌·카드
            <select
              value={draft.accountId}
              disabled={busy}
              onChange={e => setDraft({ ...draft, accountId: e.target.value })}
            >
              <option value="">모든 계좌·카드</option>
              {bootstrap?.accounts
                .filter(a => a.active && !a.isDeleted)
                .map(a => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.displayName}
                  </option>
                ))}
            </select>
          </label>
          <label className={styles.field}>
            지정할 카테고리
            <select
              value={draft.categoryId}
              disabled={busy}
              onChange={e => setDraft({ ...draft, categoryId: e.target.value })}
            >
              <option value="">카테고리 유지 · 태그만 추가</option>
              {bootstrap?.categories
                .filter(c => c.type === draft.type && c.active && !c.isDeleted)
                .map(c => (
                  <option key={c.categoryId} value={c.categoryId}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <TagsInput value={tags} onChange={setTags} disabled={busy} />
        <div className={styles.row}>
          <Button type="submit" disabled={busy || !loaded}>
            {editing ? "수정 저장" : "규칙 추가"}
          </Button>
          {editing && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(blank());
                setTags("");
                setEditing(false);
              }}
            >
              취소
            </Button>
          )}
        </div>
      </form>
      <section className={styles.panel}>
        <h2>기존 거래에 적용</h2>
        <p>
          저장된 규칙으로 10건씩 확인합니다. 직접 지정한 카테고리는 유지하며 태그를 추가합니다. 자동
          분류한 일반 수입·지출은 카테고리도 갱신합니다. 이체·정산·혜택 연결 거래의 카테고리는
          유지합니다.
        </p>
        <div className={styles.grid}>
          <label className={styles.field}>
            시작일
            <input
              type="date"
              value={dateFrom}
              disabled={busy}
              onChange={e => {
                setDateFrom(e.target.value);
                setPreview(undefined);
              }}
            />
          </label>
          <label className={styles.field}>
            종료일
            <input
              type="date"
              value={dateTo}
              disabled={busy}
              onChange={e => {
                setDateTo(e.target.value);
                setPreview(undefined);
              }}
            />
          </label>
        </div>
        <Button
          variant="secondary"
          disabled={busy || !loaded}
          onClick={() => void run(() => showPreview())}
        >
          적용 전 미리보기
        </Button>
        {preview && (
          <>
            <p>
              전체 {preview.total}건 중 {preview.total ? preview.offset + 1 : 0}–
              {Math.min(preview.offset + 10, preview.total)}번째 거래 · 변경 대상{" "}
              {preview.items.length}건
            </p>
            <div className={styles.preview}>
              {preview.items.map(item => (
                <article key={item.transactionId}>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={selected.includes(item.transactionId)}
                      onChange={e =>
                        setSelected(
                          e.target.checked
                            ? [...selected, item.transactionId]
                            : selected.filter(id => id !== item.transactionId)
                        )
                      }
                    />
                    <strong>{item.description || "내용 없음"}</strong>
                  </label>
                  <p>
                    {item.date} · {item.amount.toLocaleString()}원
                  </p>
                  <p>
                    {item.beforeCategory || "미분류"} → {item.afterCategory || "미분류"}
                  </p>
                  <p>
                    태그: {item.beforeTags.join(", ") || "없음"} →{" "}
                    {item.afterTags.join(", ") || "없음"}
                  </p>
                  <p>일치 규칙: {item.matchedNames.join(", ")}</p>
                </article>
              ))}
            </div>
            {!preview.items.length && <p>이 페이지에는 변경할 거래가 없습니다.</p>}
            <div className={styles.row}>
              <Button
                disabled={busy || !selected.length}
                onClick={() =>
                  void run(async () => {
                    if (
                      !(await confirmAction({
                        title: "분류 규칙 적용",
                        message: `미리보기에서 선택한 ${selected.length}건에 적용할까요?`,
                        confirmLabel: "적용"
                      }))
                    )
                      return;
                    const result = await applyClassification(preview, selected);
                    const failed = result.results.filter(r => !r.applied);
                    await showPreview(preview.offset);
                    markLedgerChanged();
                    setNotice(
                      `${result.results.length - failed.length}건 적용 완료${failed.length ? `\n${failed.length}건 미적용: ${failed.map(r => r.error).join(" / ")}` : ""}`
                    );
                  })
                }
              >
                선택 {selected.length}건 적용
              </Button>
              <Button
                variant="secondary"
                disabled={busy || preview.offset === 0}
                onClick={() => void run(() => showPreview(Math.max(0, preview.offset - 10)))}
              >
                이전 10건
              </Button>
              <Button
                variant="secondary"
                disabled={busy || preview.nextOffset === null}
                onClick={() => void run(() => showPreview(preview.nextOffset!))}
              >
                다음 10건
              </Button>
            </div>
          </>
        )}
      </section>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
