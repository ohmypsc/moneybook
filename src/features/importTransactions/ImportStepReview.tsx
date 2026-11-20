import { TagChips, TagsInput } from "../../components/classification/TagsInput";
import { Button } from "../../components/common/Button/Button";
import { formatMoney } from "../../components/common/Money/Money";
import { ChoiceChips, type ChoiceOption } from "./ChoiceChips";
import type { EditableCandidate, ImportKind } from "./importReview";
import styles from "./ImportReview.module.css";

export type StepPickerKind = "category" | "paymentMethod" | "fromAccount" | "toAccount";

export interface StepChoices {
  category: ChoiceOption[];
  categoryHint?: string;
  paymentMethod: ChoiceOption[];
  paymentHint?: string;
  fromAccount: ChoiceOption[];
  toAccount: ChoiceOption[];
  spendingTargets: string[];
  labelOf: (kind: StepPickerKind, value: string) => string;
}

export interface SameMerchantPrompt {
  count: number;
  categoryName: string;
}

interface ImportStepReviewProps {
  item: EditableCandidate;
  position: number;
  total: number;
  choices: StepChoices;
  hasImages: boolean;
  sameMerchant: SameMerchantPrompt | null;
  error: string;
  disabled: boolean;
  onShowImages: () => void;
  onPatch: (patch: Partial<EditableCandidate>) => void;
  onOpenPicker: (kind: StepPickerKind) => void;
  onApplySameMerchant: () => void;
  onDismissSameMerchant: () => void;
  onConfirm: () => void;
  onSkip: () => void;
  onBack: () => void;
  /** 수입(입금)을 정산 예정 지출에 정산금으로 연결 */
  onLinkSettlement: () => void;
}

const KIND_OPTIONS: Array<{ value: Exclude<ImportKind, "refund">; label: string }> = [
  { value: "expense", label: "지출" },
  { value: "income", label: "수입" },
  { value: "transfer", label: "이체" }
];

export function ImportStepReview({
  item,
  position,
  total,
  choices,
  hasImages,
  sameMerchant,
  error,
  disabled,
  onShowImages,
  onPatch,
  onOpenPicker,
  onApplySameMerchant,
  onDismissSameMerchant,
  onConfirm,
  onSkip,
  onBack,
  onLinkSettlement
}: ImportStepReviewProps) {
  const warnings = item.reviewReasons.filter(reason => reason !== "중복 거래 의심");

  return (
    <fieldset disabled={disabled} className={styles.step}>
      <div className={styles.progress}>
        <button type="button" className={styles.backButton} onClick={onBack}>
          ‹ 목록
        </button>
        <div className={styles.bar} aria-hidden="true">
          <i style={{ width: `${Math.round((position / Math.max(total, 1)) * 100)}%` }} />
        </div>
        <span>
          {position} / {total}
        </span>
      </div>

      {(item.sourceText || hasImages) && (
        <div className={styles.source}>
          <div>
            캡처에서 읽은 줄<strong>{item.sourceText || "원문 없음"}</strong>
          </div>
          {hasImages && (
            <button type="button" className={styles.linkButton} onClick={onShowImages}>
              원본 보기
            </button>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <ul className={styles.reasons}>
          {warnings.map(reason => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {item.duplicate && (
        <p className={styles.duplicate}>
          이미 입력된 거래와 비슷해요: {item.duplicate.date} ·{" "}
          {item.duplicate.description || item.duplicate.category} ·{" "}
          {formatMoney(item.duplicate.amount)}
        </p>
      )}

      {item.kind === "refund" ? (
        <p className={styles.duplicate}>
          취소/환불은 원래 거래와 연결해야 해서 여기서 저장할 수 없어요. 건너뛰고 내역 화면에서
          처리해주세요.
        </p>
      ) : (
        <div className={styles.segment} role="group" aria-label="거래 유형">
          {KIND_OPTIONS.map(option => (
            <button
              key={option.value}
              type="button"
              aria-pressed={item.kind === option.value}
              onClick={() => onPatch({ kind: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.basics}>
        <label className={[styles.field, styles.wide].join(" ")}>
          <span className={styles.fieldLabel}>거래 내용·가맹점</span>
          <input
            className={styles.input}
            value={item.merchant}
            onChange={event => onPatch({ merchant: event.target.value })}
          />
        </label>
        <label className={[styles.field, styles.wide].join(" ")}>
          <span className={styles.fieldLabel}>금액</span>
          <input
            className={[styles.input, styles.amountInput].join(" ")}
            inputMode="numeric"
            value={item.amount ? item.amount.toLocaleString("ko-KR") : ""}
            placeholder="0"
            onChange={event =>
              onPatch({ amount: Number(event.target.value.replace(/[^0-9]/g, "")) || 0 })
            }
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>날짜</span>
          <input
            className={styles.input}
            type="date"
            value={item.date}
            onChange={event => onPatch({ date: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>시간</span>
          <input
            className={styles.input}
            type="time"
            value={item.time}
            onChange={event => onPatch({ time: event.target.value })}
          />
        </label>
      </div>

      {item.kind !== "refund" && (
        <>
          <ChoiceChips
            label="카테고리"
            required
            hint={choices.categoryHint}
            options={choices.category}
            selected={item.categoryId || ""}
            selectedLabel={item.categoryName}
            onSelect={value =>
              onPatch({ categoryId: value, categoryName: choices.labelOf("category", value) })
            }
            onMore={() => onOpenPicker("category")}
          />

          {sameMerchant && (
            <div className={styles.applyAll} role="status">
              <p>
                같은 가맹점 거래가 <strong>{sameMerchant.count}건 더</strong> 있어요. 모두{" "}
                {sameMerchant.categoryName}(으)로 바꿀까요?
              </p>
              <div className={styles.applyAllActions}>
                <button type="button" onClick={onDismissSameMerchant}>
                  이 건만
                </button>
                <button type="button" onClick={onApplySameMerchant}>
                  {sameMerchant.count + 1}건 모두 적용
                </button>
              </div>
            </div>
          )}

          {item.kind === "expense" && (
            <>
              <ChoiceChips
                label="결제수단"
                required
                hint={choices.paymentHint}
                options={choices.paymentMethod}
                selected={item.paymentMethodId || ""}
                selectedLabel={item.paymentMethodName}
                onSelect={value =>
                  onPatch({
                    paymentMethodId: value,
                    paymentMethodName: choices.labelOf("paymentMethod", value)
                  })
                }
                onMore={() => onOpenPicker("paymentMethod")}
              />
              <ChoiceChips
                label="지출대상"
                required
                options={choices.spendingTargets.map(target => ({ value: target, label: target }))}
                selected={item.spendingTarget}
                onSelect={value => onPatch({ spendingTarget: value })}
              />
              <label className={styles.settlementToggle}>
                <input
                  type="checkbox"
                  checked={Boolean(item.settlementExpected)}
                  onChange={event => onPatch({ settlementExpected: event.target.checked })}
                />
                <span>
                  <strong>정산받을 예정</strong>
                  <small>회식비처럼 나중에 돌려받을 지출이면 체크하세요</small>
                </span>
              </label>
            </>
          )}

          {item.kind === "income" && (
            <div className={styles.settlementLink}>
              <p>
                <strong>회식비 정산금 입금인가요?</strong>
                수입으로 저장하지 않고 ‘정산 예정’ 지출에 나눠 반영할 수 있어요.
              </p>
              <button type="button" onClick={onLinkSettlement}>
                지출에 연결하기
              </button>
            </div>
          )}

          {item.kind === "transfer" && (
            <ChoiceChips
              label="출금계좌"
              required
              options={choices.fromAccount}
              selected={item.fromAccountId || ""}
              selectedLabel={
                item.fromAccountId ? choices.labelOf("fromAccount", item.fromAccountId) : ""
              }
              onSelect={value => onPatch({ fromAccountId: value })}
              onMore={() => onOpenPicker("fromAccount")}
            />
          )}

          {(item.kind === "income" || item.kind === "transfer") && (
            <ChoiceChips
              label="입금계좌"
              required
              options={choices.toAccount}
              selected={item.toAccountId || ""}
              selectedLabel={item.toAccountId ? choices.labelOf("toAccount", item.toAccountId) : ""}
              onSelect={value => onPatch({ toAccountId: value })}
              onMore={() => onOpenPicker("toAccount")}
            />
          )}

          <TagsInput value={item.tagsText || ""} onChange={value => onPatch({ tagsText: value })} />
          <TagChips tags={item.automaticTags} />

          <label className={styles.field}>
            <span className={styles.fieldLabel}>메모</span>
            <input
              className={styles.input}
              value={item.memo}
              placeholder="선택 사항"
              onChange={event => onPatch({ memo: event.target.value })}
            />
          </label>
        </>
      )}

      {error && (
        <p className={styles.duplicate} role="alert">
          {error}
        </p>
      )}

      <div className={styles.footer}>
        <Button variant="secondary" onClick={onSkip}>
          건너뛰기
        </Button>
        <Button onClick={onConfirm} disabled={item.kind === "refund"}>
          {position >= total ? "확인 완료" : "확인하고 다음 →"}
        </Button>
      </div>
    </fieldset>
  );
}
