import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import styles from "./SettingsPage.module.css";

export type SettingsView =
  | "home"
  | "categories"
  | "accounts"
  | "automation"
  | "ledger"
  | "profile";

export function SettingsHome({
  onOpen
}: {
  onOpen: (view: SettingsView) => void;
}) {
  const sharedItems: Array<{
    key: SettingsView;
    title: string;
    description: string;
  }> = [
    {
      key: "categories",
      title: "카테고리 관리",
      description: "카테고리 추가·수정과 입력 화면 순서"
    },
    {
      key: "accounts",
      title: "자산 관리",
      description: "자산 추가·수정과 입력 화면 노출·순서"
    },
    {
      key: "automation",
      title: "자동화",
      description: "고정 거래 자동 등록과 확인"
    },
    {
      key: "ledger",
      title: "가계부 운영·데이터",
      description: "가계부 시작일, 삭제 내역 복원, 내보내기"
    }
  ];

  return (
    <>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>설정</h1>
      </header>

      <section className={styles.menuSection}>
        <h2 className={styles.menuSectionTitle}>부부 공통</h2>

        <Card padding="none" className={styles.menuCard}>
          {sharedItems.map(item => (
            <button
              type="button"
              key={item.key}
              className={styles.menuRow}
              onClick={() => onOpen(item.key)}
            >
              <span className={styles.menuText}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </span>

              <span className={styles.chevron} aria-hidden="true">
                ›
              </span>
            </button>
          ))}
        </Card>
      </section>

      <section className={styles.menuSection}>
        <h2 className={styles.menuSectionTitle}>내 설정</h2>

        <Card padding="none" className={styles.menuCard}>
          <button
            type="button"
            className={styles.menuRow}
            onClick={() => onOpen("profile")}
          >
            <span className={styles.menuText}>
              <strong>내 계정·앱 정보</strong>
              <span>현재 사용자, 데이터 저장 방식, 로그아웃</span>
            </span>

            <span className={styles.chevron} aria-hidden="true">
              ›
            </span>
          </button>
        </Card>
      </section>
    </>
  );
}

export function DetailHeader({
  title,
  description,
  onBack
}: {
  title: string;
  description: string;
  onBack: () => void;
}) {
  return (
    <header className={styles.detailHeader}>
      <Button
        variant="secondary"
        size="sm"
        className={styles.backButton}
        onClick={onBack}
      >
        <span aria-hidden="true">‹</span>
        설정
      </Button>

      <h1 className={styles.detailTitle}>{title}</h1>
      <p className={styles.detailDescription}>{description}</p>
    </header>
  );
}
