import type { ReactNode } from "react";

import { Button } from "../../components/common/Button/Button";
import { formatMoney } from "../../components/common/Money/Money";
import { IMPORT_TYPE_LABELS, type EditableCandidate } from "./importReview";
import { needsReview } from "./importSuggestions";
import styles from "./ImportReview.module.css";

interface ImportReviewListProps {
  items: EditableCandidate[];
  imageUrls: string[];
  selectedCount: number;
  saving: boolean;
  bulkEdit: ReactNode;
  message: ReactNode;
  describe: (item: EditableCandidate) => string;
  onShowImages: () => void;
  onStartReview: () => void;
  onOpenItem: (candidateId: string) => void;
  onToggle: (candidateId: string, selected: boolean) => void;
  onAdd: () => void;
  onReanalyze: () => void;
  onSave: () => void;
}

function shortDate(date: string) {
  const match = date.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "날짜 확인";
}

export function ImportReviewList({
  items,
  imageUrls,
  selectedCount,
  saving,
  bulkEdit,
  message,
  describe,
  onShowImages,
  onStartReview,
  onOpenItem,
  onToggle,
  onAdd,
  onReanalyze,
  onSave
}: ImportReviewListProps) {
  const pending = items.filter(needsReview);
  const ready = items.filter(item => !item.queued && !needsReview(item));
  const queued = items.filter(item => item.queued);

  function renderRow(item: EditableCandidate) {
    const warning = needsReview(item) ? item.reviewReasons[0] : "";
    return (
      <div
        key={item.candidateId}
        className={[styles.row, item.queued ? styles.rowQueued : ""].filter(Boolean).join(" ")}
      >
        <input
          type="checkbox"
          checked={item.selected}
          disabled={item.kind === "refund" || item.queued || saving}
          aria-label={`${item.merchant || "거래"} 저장 선택`}
          onChange={event => onToggle(item.candidateId, event.target.checked)}
        />
        <button
          type="button"
          className={styles.rowButton}
          disabled={item.queued}
          onClick={() => onOpenItem(item.candidateId)}
        >
          <span className={styles.rowText}>
            <strong>
              {item.kind !== "expense" && `${IMPORT_TYPE_LABELS[item.kind]} · `}
              {item.merchant || "거래 내용 확인 필요"}
            </strong>
            {item.settlementLinked ? (
              <span>{shortDate(item.date)} · 정산금으로 지출에 반영됨</span>
            ) : warning ? (
              <span className={styles.rowWarning}>
                {warning}
                {item.reviewReasons.length > 1 ? ` 외 ${item.reviewReasons.length - 1}` : ""}
              </span>
            ) : (
              <span>
                {[
                  shortDate(item.date),
                  item.time,
                  describe(item),
                  item.kind === "expense" && item.settlementExpected ? "정산 예정" : ""
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </span>
          <span className={styles.rowAmount}>{formatMoney(item.amount)}</span>
        </button>
      </div>
    );
  }

  return (
    <div className={styles.list}>
      {imageUrls.length > 0 && (
        <div className={styles.thumbs}>
          {imageUrls.map((url, index) => (
            <button
              key={url}
              type="button"
              className={styles.thumbButton}
              aria-label={`원본 캡처 ${index + 1} 크게 보기`}
              onClick={onShowImages}
            >
              <img src={url} alt="" />
            </button>
          ))}
          <span>원본 캡처 · 누르면 크게 보기</span>
        </div>
      )}

      <div className={styles.stats}>
        <div className={[styles.stat, pending.length ? styles.statWarning : ""].join(" ")}>
          <strong>{pending.length}건</strong>
          <span>확인 필요</span>
        </div>
        <div className={[styles.stat, ready.length ? styles.statReady : ""].join(" ")}>
          <strong>{ready.length}건</strong>
          <span>
            {queued.length ? `바로 저장 가능 · 저장됨 ${queued.length}` : "바로 저장 가능"}
          </span>
        </div>
      </div>

      {pending.length > 0 && (
        <button type="button" className={styles.startButton} onClick={onStartReview}>
          <span>
            <strong>확인 필요한 {pending.length}건 하나씩 보기</strong>
            <small>한 건씩 넘기며 빠르게 채워요</small>
          </span>
          <span aria-hidden="true">→</span>
        </button>
      )}

      {pending.length > 0 && (
        <>
          <p className={styles.groupLabel}>확인 필요</p>
          <div className={styles.rows}>{pending.map(renderRow)}</div>
        </>
      )}
      {ready.length > 0 && (
        <>
          <p className={styles.groupLabel}>바로 저장 가능 · 누르면 고칠 수 있어요</p>
          <div className={styles.rows}>{ready.map(renderRow)}</div>
        </>
      )}
      {queued.length > 0 && (
        <>
          <p className={styles.groupLabel}>저장 대기열에 넣음</p>
          <div className={styles.rows}>{queued.map(renderRow)}</div>
        </>
      )}

      {bulkEdit}
      {message}

      <div className={[styles.footer, styles.footerWide].join(" ")}>
        <Button variant="secondary" onClick={onAdd}>
          거래 추가
        </Button>
        <Button variant="secondary" onClick={onReanalyze}>
          다시 분석
        </Button>
        <Button
          loading={saving}
          loadingLabel="추가 중..."
          disabled={selectedCount === 0}
          onClick={onSave}
        >
          선택 {selectedCount}건 저장
        </Button>
      </div>
    </div>
  );
}
