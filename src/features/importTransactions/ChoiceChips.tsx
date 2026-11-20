import styles from "./ImportReview.module.css";

export interface ChoiceOption {
  value: string;
  label: string;
  /** 추천(연보라)으로 표시할지 */
  suggested?: boolean;
}

interface ChoiceChipsProps {
  label: string;
  options: ChoiceOption[];
  selected: string;
  onSelect: (value: string) => void;
  /** 있으면 끝에 [전체] 칩을 붙여 전체 선택창을 엽니다. */
  onMore?: () => void;
  /** 고른 값이 추천 칩에 없을 때 칩으로 보여 줄 이름 */
  selectedLabel?: string;
  required?: boolean;
  hint?: string;
}

/**
 * 화면에 바로 누를 수 있는 칩 줄입니다. 추천에 없는 값을 [전체]에서 고르면 그 값도 칩으로 앞에 붙여
 * 지금 무엇이 골라졌는지 항상 보이게 합니다.
 */
export function ChoiceChips({
  label,
  options,
  selected,
  onSelect,
  onMore,
  selectedLabel,
  required = false,
  hint
}: ChoiceChipsProps) {
  const visible =
    selected && selectedLabel && !options.some(option => option.value === selected)
      ? [{ value: selected, label: selectedLabel }, ...options]
      : options;

  return (
    <div className={styles.field} role="group" aria-label={label}>
      <span className={styles.fieldLabel}>
        <span>
          {label}
          {required && !selected && <em> · 선택 필요</em>}
        </span>
        {hint && <span className={styles.fieldHint}>{hint}</span>}
      </span>
      <div className={styles.chips}>
        {visible.map(option => (
          <button
            key={option.value}
            type="button"
            className={[styles.chip, option.suggested ? styles.chipSuggested : ""]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={option.value === selected}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
        {onMore && (
          <button
            type="button"
            className={[styles.chip, styles.chipMore].join(" ")}
            onClick={onMore}
          >
            전체 ⌄
          </button>
        )}
      </div>
    </div>
  );
}
