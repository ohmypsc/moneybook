import { INPUT_MODE_OPTIONS, type InputMode } from "./inputDomain";
import styles from "./InputPage.module.css";

interface InputModeTabsProps {
  value: InputMode;
  onChange: (mode: InputMode) => void;
}

export function InputModeTabs({ value, onChange }: InputModeTabsProps) {
  return (
    <div className={styles.typeTabs} aria-label="거래 유형">
      {INPUT_MODE_OPTIONS.map(option => {
        const active = value === option.value;
        return (
          <button
            type="button"
            key={option.value}
            className={[
              styles.typeButton,
              active ? styles.typeButtonActive : ""
            ].join(" ")}
            aria-pressed={active}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
