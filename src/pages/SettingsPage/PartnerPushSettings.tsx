import { useEffect, useState } from "react";

import { getBootstrap } from "../../api/bootstrap";
import { requestTestPush } from "../../api/push";
import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getCurrentPushSubscription,
  getPushSupport
} from "../../utils/pushNotifications";
import styles from "./SettingsPage.module.css";

type Status = "checking" | "on" | "off";

function unsupportedMessage(reason: string) {
  if (reason === "ios-not-installed") {
    return "아이폰은 Safari에서 '홈 화면에 추가'한 가계부 앱으로 열었을 때만 알림을 받을 수 있어요(iOS 16.4 이상). 홈 화면 아이콘으로 다시 열어 주세요.";
  }
  if (reason === "dev") {
    return "개발 모드에서는 알림을 켤 수 없어요.";
  }
  return "이 브라우저는 알림을 지원하지 않아요.";
}

export function PartnerPushSettings({ userName }: { userName: string }) {
  const support = getPushSupport();
  const [partnerName, setPartnerName] = useState("");
  const [status, setStatus] = useState<Status>("checking");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!support.supported) {
      setStatus("off");
      return;
    }

    let active = true;
    void getCurrentPushSubscription()
      .then(subscription => {
        if (active) setStatus(subscription ? "on" : "off");
      })
      .catch(() => {
        if (active) setStatus("off");
      });

    return () => {
      active = false;
    };
  }, [support.supported]);

  useEffect(() => {
    if (!userName) return;
    let active = true;
    void getBootstrap()
      .then(response => {
        const others = (response.data?.members || []).filter(name => name && name !== userName);
        if (active && others.length === 1) setPartnerName(others[0]);
      })
      .catch(() => {
        /* 이름을 못 불러와도 '배우자'로 표시합니다. */
      });
    return () => {
      active = false;
    };
  }, [userName]);

  const partner = partnerName ? `${partnerName}님` : "배우자";

  async function handleToggle() {
    setBusy(true);
    setError("");
    setFeedback("");

    try {
      if (status === "on") {
        await disablePushOnThisDevice();
        setStatus("off");
        setFeedback("이 휴대폰의 알림을 껐어요.");
      } else {
        await enablePushOnThisDevice();
        setStatus("on");
        setFeedback(`알림을 켰어요. 이제 ${partner}이 거래를 입력하면 이 휴대폰으로 알려드려요.`);
      }
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "알림 설정을 바꾸지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setError("");
    setFeedback("");

    try {
      const result = await requestTestPush();
      setFeedback(
        result.sent > 0
          ? "테스트 알림을 보냈어요. 몇 초 안에 도착해요."
          : "알림을 보내지 못했어요. 알림을 껐다가 다시 켜 보세요."
      );
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "테스트 알림을 보내지 못했어요.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card as="section">
      <div className={styles.sectionHeading}>
        <h2>{partner} 입력 알림</h2>
        <p>
          이 휴대폰에서 켜 두면 {partner}이 지출·수입·이체를 입력할 때 알림이 와요.
          내가 입력한 거래는 나에게 알리지 않고, 알림은 켠 휴대폰에만 가요.
        </p>
      </div>

      {!support.supported ? (
        <p className={styles.feedback}>{unsupportedMessage(support.reason)}</p>
      ) : (
        <>
          <p className={styles.pushStatus}>
            이 휴대폰: <strong>{status === "checking" ? "확인 중..." : status === "on" ? "알림 켜짐" : "알림 꺼짐"}</strong>
          </p>

          <div className={styles.pushActions}>
            <Button
              variant={status === "on" ? "secondary" : "primary"}
              loading={busy}
              loadingLabel={status === "on" ? "끄는 중..." : "켜는 중..."}
              disabled={busy || status === "checking"}
              onClick={() => void handleToggle()}
            >
              {status === "on" ? "알림 끄기" : "알림 켜기"}
            </Button>

            {status === "on" && (
              <Button
                variant="ghost"
                loading={testing}
                loadingLabel="보내는 중..."
                disabled={testing}
                onClick={() => void handleTest()}
              >
                테스트 알림
              </Button>
            )}
          </div>
        </>
      )}

      {feedback && <p className={styles.feedback}>{feedback}</p>}
      {error && <p className={styles.error}>{error}</p>}
    </Card>
  );
}
