import styles from "./InputPage.module.css";

interface PickerFieldButtonProps {
  value: string;
  placeholder?: string;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function PickerFieldButton({
  value,
  placeholder = "선택하세요",
  onClick,
  disabled = false,
  ariaLabel
}: PickerFieldButtonProps) {
  const hasValue = Boolean(value);

  return (
    <button
      type="button"
      className={styles.pickerButton}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
    >
      <span className={hasValue ? styles.pickerValue : styles.pickerPlaceholder}>
        {hasValue ? value : placeholder}
      </span>
      <span className={styles.pickerChevron} aria-hidden="true">⌄</span>
    </button>
  );
}
