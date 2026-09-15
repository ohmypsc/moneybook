import { useEffect, useState } from "react";

import { getSession, logout } from "../../api/auth";
import { confirmAction } from "../../utils/confirmAction";
import PwaInstallPrompt from "../../components/pwa/PwaInstallPrompt/PwaInstallPrompt";
import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import styles from "./SettingsPage.module.css";

export function ProfileSettings() {
    const [
        userName,
        setUserName
    ] =
        useState("");

    const [
        loading,
        setLoading
    ] =
        useState(
            true
        );

    const [
        loggingOut,
        setLoggingOut
    ] =
        useState(
            false
        );


    useEffect(
        () => {
            let active =
                true;

            async function loadSession() {
                try {
                    const session =
                        await getSession();

                    if (
                        active &&
                        session.loggedIn &&
                        session.user
                    ) {
                        setUserName(
                            session.user.name
                        );
                    }
                } finally {
                    if (
                        active
                    ) {
                        setLoading(
                            false
                        );
                    }
                }
            }

            void loadSession();

            return () => {
                active =
                    false;
            };
        },
        []
    );


    async function handleLogout() {
        if (
            !(await confirmAction({
                title:
                    "로그아웃",
                message:
                    "현재 계정에서 로그아웃할까요?",
                confirmLabel:
                    "로그아웃"
            }))
        ) {
            return;
        }

        setLoggingOut(
            true
        );

        try {
            await logout();

            window.location.reload();
        } finally {
            setLoggingOut(
                false
            );
        }
    }


    return (
        <div
            className={
                styles.settingsBody
            }
        >
            <Card as="section">
                <div
                    className={
                        styles.profileRow
                    }
                >
                    <span
                        className={
                            styles.avatar
                        }
                    >
                        {
                            (
                                userName ||
                                "내"
                            ).slice(
                                0,
                                1
                            )
                        }
                    </span>

                    <span
                        className={
                            styles.itemTextGroup
                        }
                    >
                        <strong>
                            {
                                loading
                                    ? "확인 중..."
                                    : userName ||
                                        "로그인 사용자"
                            }
                        </strong>

                        <span>
                            현재 로그인한 사용자
                        </span>
                    </span>
                </div>
            </Card>

            <Card as="section">
                <div
                    className={
                        styles.sectionHeading
                    }
                >
                    <h2>
                        우리 가계부
                    </h2>

                    <p>
                        미영·승철 두 사람이 함께 사용하는
                        부부 공유 가계부입니다.
                    </p>
                </div>

                <dl
                    className={
                        styles.infoList
                    }
                >
                    <div>
                        <dt>
                            로그인 유지
                        </dt>

                        <dd>
                            접속할 때마다 최대 400일로 연장
                        </dd>
                    </div>

                    <div>
                        <dt>
                            기본 저장소
                        </dt>

                        <dd>
                            Cloudflare D1
                        </dd>
                    </div>

                    <div>
                        <dt>
                            설정 공유
                        </dt>

                        <dd>
                            부부 공통 설정은 두 계정에 동일 적용
                        </dd>
                    </div>
                </dl>
            </Card>

            <PwaInstallPrompt />

            <Button
                variant="dangerSoft"
                fullWidth
                loading={loggingOut}
                loadingLabel="로그아웃 중..."
                disabled={
                    loggingOut
                }
                onClick={
                    () =>
                        void handleLogout()
                }
            >
                로그아웃
            </Button>
        </div>
    );
}


