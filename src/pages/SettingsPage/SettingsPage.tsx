import {
  useEffect,
  useState
} from "react";

import {
  getSession,
  logout
} from "../../api/auth";

import {
  getTransactions
} from "../../api/transactions";

import type {
  Transaction
} from "../../api/transactions";

import {
  clearLedgerStartDate,
  getLedgerConfig,
  setLedgerStartDate
} from "../../api/settingsManagement";

import CategorySettings
  from "./CategorySettings";

import AssetSettings
  from "./AssetSettings";

import styles
  from "./SettingsPage.module.css";

type SettingsView =
  | "home"
  | "categories"
  | "assets"
  | "ledger"
  | "profile";

function getErrorMessage(
  error:
    unknown,

  fallback:
    string
) {
  return error instanceof Error
    ? error.message
    : fallback;
}

function csvCell(
  value:
    unknown
) {
  const text =
    value === null ||
    value === undefined
      ? ""
      : String(value);

  return `"${text.replace(
    /"/g,
    '""'
  )}"`;
}

function SettingsHome(
  {
    onOpen
  }: {
    onOpen:
      (
        view:
          SettingsView
      ) => void;
  }
) {
  const sharedItems:
    Array<{
      key:
        SettingsView;

      title:
        string;

      description:
        string;
    }> = [
      {
        key:
          "categories",

        title:
          "카테고리 관리",

        description:
          "추가·수정·삭제와 입력 화면 순서"
      },

      {
        key:
          "assets",

        title:
          "자산 관리",

        description:
          "통장·카드·대출·투자계좌와 입력 화면 설정"
      },

      {
        key:
          "ledger",

        title:
          "가계부 운영·데이터",

        description:
          "가계부 시작일, 전체 거래 내보내기, 새로고침"
      }
    ];

  return (
    <>
      <header
        className={
          styles.pageHeader
        }
      >
        <p
          className={
            styles.eyebrow
          }
        >
          설정
        </p>

        <h1
          className={
            styles.pageTitle
          }
        >
          우리 가계부 설정
        </h1>

        <p
          className={
            styles.pageDescription
          }
        >
          부부가 함께 쓰는 설정과
          내 계정 정보를 관리합니다.
        </p>
      </header>

      <section
        className={
          styles.menuSection
        }
      >
        <h2
          className={
            styles.menuSectionTitle
          }
        >
          부부 공통
        </h2>

        <div
          className={
            styles.menuCard
          }
        >
          {
            sharedItems.map(
              item => (
                <button
                  type="button"
                  key={
                    item.key
                  }
                  className={
                    styles.menuRow
                  }
                  onClick={
                    () =>
                      onOpen(
                        item.key
                      )
                  }
                >
                  <span
                    className={
                      styles.menuText
                    }
                  >
                    <strong>
                      {
                        item.title
                      }
                    </strong>

                    <span>
                      {
                        item.description
                      }
                    </span>
                  </span>

                  <span
                    className={
                      styles.chevron
                    }
                    aria-hidden="true"
                  >
                    ›
                  </span>
                </button>
              )
            )
          }
        </div>
      </section>

      <section
        className={
          styles.menuSection
        }
      >
        <h2
          className={
            styles.menuSectionTitle
          }
        >
          내 설정
        </h2>

        <div
          className={
            styles.menuCard
          }
        >
          <button
            type="button"
            className={
              styles.menuRow
            }
            onClick={
              () =>
                onOpen(
                  "profile"
                )
            }
          >
            <span
              className={
                styles.menuText
              }
            >
              <strong>
                내 계정·앱 정보
              </strong>

              <span>
                현재 사용자, 데이터 저장 방식, 로그아웃
              </span>
            </span>

            <span
              className={
                styles.chevron
              }
              aria-hidden="true"
            >
              ›
            </span>
          </button>
        </div>
      </section>
    </>
  );
}

function DetailHeader(
  {
    title,
    description,
    onBack
  }: {
    title:
      string;

    description:
      string;

    onBack:
      () => void;
  }
) {
  return (
    <header
      className={
        styles.detailHeader
      }
    >
      <button
        type="button"
        className={
          styles.backButton
        }
        onClick={
          onBack
        }
      >
        <span
          aria-hidden="true"
        >
          ‹
        </span>

        설정
      </button>

      <h1
        className={
          styles.detailTitle
        }
      >
        {title}
      </h1>

      <p
        className={
          styles.detailDescription
        }
      >
        {description}
      </p>
    </header>
  );
}

function LedgerDataSettings() {
  const [
    ledgerStartDateValue,
    setLedgerStartDateValue
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
    busyKey,
    setBusyKey
  ] =
    useState("");

  const [
    error,
    setError
  ] =
    useState("");

  const [
    feedback,
    setFeedback
  ] =
    useState("");

  useEffect(
    () => {
      let active =
        true;

      async function load() {
        setLoading(
          true
        );

        setError(
          ""
        );

        try {
          const result =
            await getLedgerConfig();

          if (
            active
          ) {
            setLedgerStartDateValue(
              result.ledgerStartDate ||
                ""
            );
          }
        } catch (
          loadError
        ) {
          if (
            active
          ) {
            setError(
              getErrorMessage(
                loadError,
                "가계부 설정을 불러오지 못했습니다."
              )
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

      void load();

      return () => {
        active =
          false;
      };
    },
    []
  );

  async function handleSaveStartDate() {
    if (
      !ledgerStartDateValue
    ) {
      setError(
        "가계부 시작일을 선택해주세요."
      );

      return;
    }

    setBusyKey(
      "start-date"
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );

    try {
      const result =
        await setLedgerStartDate(
          ledgerStartDateValue
        );

      setLedgerStartDateValue(
        result.ledgerStartDate ||
          ledgerStartDateValue
      );

      setFeedback(
        "가계부 시작일을 저장했습니다."
      );
    } catch (
      saveError
    ) {
      setError(
        getErrorMessage(
          saveError,
          "가계부 시작일을 저장하지 못했습니다."
        )
      );
    } finally {
      setBusyKey(
        ""
      );
    }
  }

  async function handleClearStartDate() {
    if (
      !window.confirm(
        "가계부 시작일 제한을 해제할까요?"
      )
    ) {
      return;
    }

    setBusyKey(
      "clear-date"
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );

    try {
      await clearLedgerStartDate();

      setLedgerStartDateValue(
        ""
      );

      setFeedback(
        "가계부 시작일 제한을 해제했습니다."
      );
    } catch (
      clearError
    ) {
      setError(
        getErrorMessage(
          clearError,
          "가계부 시작일을 해제하지 못했습니다."
        )
      );
    } finally {
      setBusyKey(
        ""
      );
    }
  }

  async function handleExport() {
    setBusyKey(
      "export"
    );

    setError(
      ""
    );

    setFeedback(
      ""
    );

    try {
      const items:
        Transaction[] = [];

      let offset =
        0;

      const limit =
        1000;

      let total =
        0;

      do {
        const response =
          await getTransactions({
            limit,
            offset
          });

        total =
          response.data.total;

        items.push(
          ...response
            .data
            .items
        );

        offset +=
          response
            .data
            .items
            .length;

        if (
          response
            .data
            .items
            .length ===
          0
        ) {
          break;
        }
      } while (
        offset <
        total
      );

      const headers = [
        "거래ID",
        "날짜",
        "유형",
        "카테고리",
        "금액",
        "출금계좌",
        "입금계좌",
        "결제수단",
        "지출대상",
        "메모",
        "청구월",
        "입력자",
        "수정자",
        "입력시각",
        "수정시각"
      ];

      const rows =
        items.map(
          transaction => [
            transaction.transactionId,
            transaction.date,
            transaction.type,
            transaction.category,
            transaction.amount,
            transaction.fromAccount ||
              "",
            transaction.toAccount ||
              "",
            transaction.paymentMethod ||
              "",
            transaction.spendingTarget ||
              "",
            transaction.memo,
            transaction.billingMonth ||
              "",
            transaction.createdBy,
            transaction.updatedBy,
            transaction.createdAt ||
              "",
            transaction.updatedAt ||
              ""
          ]
        );

      const csv =
        [
          headers,
          ...rows
        ]
          .map(
            row =>
              row
                .map(
                  csvCell
                )
                .join(
                  ","
                )
          )
          .join(
            "\r\n"
          );

      const blob =
        new Blob(
          [
            "\uFEFF",
            csv
          ],
          {
            type:
              "text/csv;charset=utf-8"
          }
        );

      const url =
        URL.createObjectURL(
          blob
        );

      const link =
        document.createElement(
          "a"
        );

      const today =
        new Date()
          .toISOString()
          .slice(
            0,
            10
          );

      link.href =
        url;

      link.download =
        `우리_가계부_거래_${today}.csv`;

      document.body.appendChild(
        link
      );

      link.click();
      link.remove();

      URL.revokeObjectURL(
        url
      );

      setFeedback(
        `거래 ${items.length.toLocaleString(
          "ko-KR"
        )}건을 내보냈습니다.`
      );
    } catch (
      exportError
    ) {
      setError(
        getErrorMessage(
          exportError,
          "거래를 내보내지 못했습니다."
        )
      );
    } finally {
      setBusyKey(
        ""
      );
    }
  }

  return (
    <div
      className={
        styles.settingsBody
      }
    >
      {
        error && (
          <p
            className={
              styles.error
            }
            role="alert"
          >
            {error}
          </p>
        )
      }

      {
        feedback && (
          <p
            className={
              styles.feedback
            }
            role="status"
          >
            {feedback}
          </p>
        )
      }

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            가계부 시작일
          </h2>

          <p>
            이 날짜보다 이전의 거래 입력을 막아
            실수를 방지합니다.
          </p>
        </div>

        {
          loading
            ? (
              <p
                className={
                  styles.state
                }
              >
                가계부 설정을 불러오는 중입니다.
              </p>
            )
            : (
              <div
                className={
                  styles.dateSettingRow
                }
              >
                <label
                  className={
                    styles.field
                  }
                >
                  <span>
                    시작일
                  </span>

                  <input
                    type="date"
                    value={
                      ledgerStartDateValue
                    }
                    disabled={
                      Boolean(
                        busyKey
                      )
                    }
                    onChange={
                      event =>
                        setLedgerStartDateValue(
                          event.target.value
                        )
                    }
                  />
                </label>

                <div
                  className={
                    styles.rowActions
                  }
                >
                  <button
                    type="button"
                    className={
                      styles.secondaryButton
                    }
                    disabled={
                      Boolean(
                        busyKey
                      ) ||
                      !ledgerStartDateValue
                    }
                    onClick={
                      () =>
                        void handleClearStartDate()
                    }
                  >
                    제한 해제
                  </button>

                  <button
                    type="button"
                    className={
                      styles.primaryButton
                    }
                    disabled={
                      Boolean(
                        busyKey
                      ) ||
                      !ledgerStartDateValue
                    }
                    onClick={
                      () =>
                        void handleSaveStartDate()
                    }
                  >
                    {
                      busyKey ===
                      "start-date"
                        ? "저장 중..."
                        : "시작일 저장"
                    }
                  </button>
                </div>
              </div>
            )
        }
      </section>

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            거래 데이터 내보내기
          </h2>

          <p>
            현재 저장된 거래를 엑셀에서도 열 수 있는
            CSV 파일로 받습니다.
          </p>
        </div>

        <button
          type="button"
          className={
            styles.fullWidthButton
          }
          disabled={
            Boolean(
              busyKey
            )
          }
          onClick={
            () =>
              void handleExport()
          }
        >
          {
            busyKey ===
            "export"
              ? "내보내는 중..."
              : "전체 거래 CSV로 내보내기"
          }
        </button>
      </section>

      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.sectionHeading
          }
        >
          <h2>
            앱 데이터 다시 불러오기
          </h2>

          <p>
            다른 계정에서 바꾼 내용이 보이지 않을 때
            최신 데이터를 다시 읽습니다.
          </p>
        </div>

        <button
          type="button"
          className={
            styles.fullWidthButton
          }
          disabled={
            Boolean(
              busyKey
            )
          }
          onClick={
            () =>
              window.location.reload()
          }
        >
          최신 데이터 다시 불러오기
        </button>
      </section>
    </div>
  );
}

function ProfileSettings() {
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
      !window.confirm(
        "로그아웃할까요?"
      )
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
      <section
        className={
          styles.cardSection
        }
      >
        <div
          className={
            styles.profileRow
          }
        >
          <span
            className={
              styles.avatar
            }
            aria-hidden="true"
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
      </section>

      <section
        className={
          styles.cardSection
        }
      >
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
              원본 데이터
            </dt>

            <dd>
              Google Sheets
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
      </section>

      <button
        type="button"
        className={
          styles.logoutButton
        }
        disabled={
          loggingOut
        }
        onClick={
          () =>
            void handleLogout()
        }
      >
        {
          loggingOut
            ? "로그아웃 중..."
            : "로그아웃"
        }
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const [
    view,
    setView
  ] =
    useState<
      SettingsView
    >(
      "home"
    );

  const detail = {
    categories: {
      title:
        "카테고리 관리",

      description:
        "카테고리를 관리하고 입력 화면 순서를 정합니다."
    },

    assets: {
      title:
        "자산 관리",

      description:
        "통장·카드·대출·투자계좌와 입력 화면 노출을 관리합니다."
    },

    ledger: {
      title:
        "가계부 운영·데이터",

      description:
        "운영 기준과 데이터 내보내기를 관리합니다."
    },

    profile: {
      title:
        "내 계정·앱 정보",

      description:
        "현재 로그인 정보와 앱의 저장 방식을 확인합니다."
    }
  } as const;

  return (
    <main
      className={
        styles.page
      }
    >
      {
        view ===
        "home"
          ? (
            <SettingsHome
              onOpen={
                setView
              }
            />
          )
          : (
            <>
              <DetailHeader
                title={
                  detail[
                    view
                  ].title
                }
                description={
                  detail[
                    view
                  ].description
                }
                onBack={
                  () =>
                    setView(
                      "home"
                    )
                }
              />

              {
                view ===
                  "categories" && (
                  <CategorySettings />
                )
              }

              {
                view ===
                  "assets" && (
                  <AssetSettings />
                )
              }

              {
                view ===
                  "ledger" && (
                  <LedgerDataSettings />
                )
              }

              {
                view ===
                  "profile" && (
                  <ProfileSettings />
                )
              }
            </>
          )
      }
    </main>
  );
}
