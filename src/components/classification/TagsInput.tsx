import styles from "./classification.module.css";
export function TagsInput({
  value,
  onChange,
  disabled = false
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={styles.field}>
      <span>거래 태그</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        maxLength={320}
        placeholder="예: 제주여행, 가족 · 쉼표로 구분"
      />
      <small>태그당 30자, 거래당 최대 10개. 카테고리와 별도로 묶어 볼 수 있어요.</small>
    </label>
  );
}
export function TagChips({ tags }: { tags?: string[] }) {
  return tags?.length ? (
    <div className={styles.chips}>
      {tags.map(tag => (
        <span key={tag}>#{tag}</span>
      ))}
    </div>
  ) : null;
}
