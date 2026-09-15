import {
  useEffect,
  useState
} from "react";

import {
  getSeoulDateString,
  getSeoulTimestampLabel
} from "../../../utils/dateTime";

import styles from "./DataFreshnessNotice.module.css";

interface DataFreshnessNoticeProps {
  fetchedAt: number;
}

function formatSnapshotTime(fetchedAt: number) {
  const date = new Date(fetchedAt);

  if (!Number.isFinite(date.getTime())) {
    return "알 수 없음";
  }

  const today = getSeoulDateString();
  const snapshotDate = getSeoulDateString(date);
  const time = getSeoulTimestampLabel(date);

  if (snapshotDate === today) {
    return `오늘 ${time}`;
  }

  const [year, month, day] = snapshotDate.split("-").map(Number);
  const currentYear = Number(today.slice(0, 4));

  return year === currentYear
    ? `${month}월 ${day}일 ${time}`
    : `${year}년 ${month}월 ${day}일 ${time}`;
}

export function DataFreshnessNotice({
  fetchedAt
}: DataFreshnessNoticeProps) {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine !== false
  );

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return (
    <div
      className={styles.notice}
      role="status"
      aria-live="polite"
    >
      <span className={styles.dot} aria-hidden="true" />
      <span>
        {online ? "최신 데이터 확인 실패" : "오프라인"}
        {" · 마지막 동기화 "}
        {formatSnapshotTime(fetchedAt)}
      </span>
    </div>
  );
}
