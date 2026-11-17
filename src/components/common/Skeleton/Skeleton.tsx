import styles from "./Skeleton.module.css";

type SkeletonProps = {
  /** 화면 읽기 프로그램에 읽힐 안내 문구 */
  label: string;
  /** 회색 줄 개수 */
  lines?: number;
  /** 줄 대신 큰 블록 하나를 보여줄지 여부 (요약 카드 등) */
  variant?: "lines" | "block";
  className?: string;
};

const LINE_WIDTHS = ["42%", "88%", "70%", "94%", "60%", "80%"];

/** 데이터를 불러오는 동안 실제 화면 모양과 비슷한 회색 자리를 보여줍니다. */
export function Skeleton({ label, lines = 3, variant = "lines", className = "" }: SkeletonProps) {
  return (
    <div
      className={[styles.skeleton, className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      <span className={styles.srOnly}>{label}</span>
      {variant === "block" ? (
        <>
          <span className={styles.line} style={{ width: "28%" }} aria-hidden="true" />
          <span className={styles.block} aria-hidden="true" />
        </>
      ) : (
        Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className={styles.line}
            style={{ width: LINE_WIDTHS[index % LINE_WIDTHS.length] }}
            aria-hidden="true"
          />
        ))
      )}
    </div>
  );
}
