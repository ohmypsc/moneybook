import {
  useEffect,
  useState
} from "react";

import {
  getDashboard
} from "../../api/dashboard";

import {
  Button
} from "../../components/common/Button/Button";

import {
  Card
} from "../../components/common/Card/Card";

import {
  Money
} from "../../components/common/Money/Money";

import type {
  BootstrapData,
  User
} from "../../types/api";

import type {
  DashboardData
} from "../../types/dashboard";

import styles
  from "./HomePage.module.css";


type DashboardLoadStatus =
  | "loading"
  | "ready"
  | "error";


type HomePageProps = {
  user: User;

  /*
   * App.tsx를 다음 커밋에서 변경할 때
   * 중간 빌드가 깨지지 않도록 잠시 optional로 유지함.
   *
   * 실제 HomePage에서는 bootstrap을 사용하지 않음.
   */
  bootstrap?:
    BootstrapData;

  onLogout:
    () => Promise<void>;
};


function formatMonth(
  value: string
) {
  const [
    year,
    month
  ] =
    value.split("-");

  const monthNumber =
    Number(month);

  if (
    !year ||
    !Number.isFinite(
      monthNumber
    )
  ) {
    return value;
  }

  return (
    `${year}년 ` +
    `${monthNumber}월`
  );
}


function HomePage({
  user,
  onLogout
}: HomePageProps) {

  const [
    dashboardStatus,
    setDashboardStatus
  ] =
    useState<DashboardLoadStatus>(
      "loading"
    );

  const [
    dashboard,
    setDashboard
  ] =
    useState<
      DashboardData | null
    >(
      null
    );

  const [
    errorMessage,
    setErrorMessage
  ] =
    useState("");

  const [
    reloadKey,
    setReloadKey
  ] =
    useState(0);


  useEffect(
    () => {

      let cancelled =
        false;


      async function load() {

        setDashboardStatus(
          "loading"
        );

        setErrorMessage(
          ""
        );


        try {

          const response =
            await getDashboard();


          if (cancelled) {
            return;
          }


          setDashboard(
            response.data
          );

          setDashboardStatus(
            "ready"
          );

        } catch (error) {

          if (cancelled) {
            return;
          }


          setDashboard(
            null
          );

          setErrorMessage(
            error instanceof Error
              ? error.message
              : "가계부 현황을 불러오지 못했습니다."
          );

          setDashboardStatus(
            "error"
          );
        }
      }


      void load();


      return () => {
        cancelled =
          true;
      };
    },

    [
      reloadKey
    ]
  );


  return (
    <div
      className={
        styles.page
      }
    >
      <header
        className={
          styles.header
        }
      >
        <div
          className={
            styles.brand
          }
        >
          <p
            className={
              styles.eyebrow
            }
          >
            우리 가계부
          </p>

          <h1>
            {
              user.name
            }님
          </h1>
        </div>

        <Button
          variant="ghost"

          className={
            styles.logoutButton
          }

          onClick={
            () => {
              void onLogout();
            }
          }
        >
          로그아웃
        </Button>
      </header>


      {
        dashboardStatus ===
          "loading" && (
          <Card
            className={
              styles.stateCard
            }
          >
            <h2
              className={
                styles.stateTitle
              }
            >
              가계부를 불러오는 중
            </h2>

            <p
              className={
                styles.stateMessage
              }
            >
              이번 달 현황을
              불러오고 있습니다.
            </p>
          </Card>
        )
      }


      {
        dashboardStatus ===
          "error" && (
          <Card
            className={
              styles.stateCard
            }
          >
            <h2
              className={
                styles.stateTitle
              }
            >
              현황을 불러오지 못했습니다
            </h2>

            <p
              className={
                styles.stateMessage
              }
            >
              {
                errorMessage
              }
            </p>

            <Button
              fullWidth

              className={
                styles.retryButton
              }

              onClick={
                () =>
                  setReloadKey(
                    value =>
                      value + 1
                  )
              }
            >
              다시 불러오기
            </Button>
          </Card>
        )
      }


      {
        dashboardStatus ===
          "ready" &&
        dashboard && (
          <div
            className={
              styles.content
            }
          >
            <div
              className={
                styles.monthBlock
              }
            >
              <p
                className={
                  styles.monthLabel
                }
              >
                이번 달
              </p>

              <h2
                className={
                  styles.monthTitle
                }
              >
                {
                  formatMonth(
                    dashboard.month
                  )
                }
              </h2>
            </div>


            <section
              className={
                styles.section
              }

              aria-labelledby={
                "monthly-summary-title"
              }
            >
              <div
                className={
                  styles.sectionHeader
                }
              >
                <h2
                  id={
                    "monthly-summary-title"
                  }
                >
                  월간 요약
                </h2>
              </div>

              <Card
                className={
                  styles.summaryCard
                }
              >
                <div
                  className={
                    styles.summaryGrid
                  }
                >
                  <div
                    className={
                      styles.metric
                    }
                  >
                    <span
                      className={
                        styles.metricLabel
                      }
                    >
                      수입
                    </span>

                    <Money
                      amount={
                        dashboard
                          .summary
                          .monthIncome
                      }

                      className={[
                        styles.metricValue,
                        styles.positiveValue
                      ].join(" ")}
                    />
                  </div>


                  <div
                    className={
                      styles.metric
                    }
                  >
                    <span
                      className={
                        styles.metricLabel
                      }
                    >
                      지출
                    </span>

                    <Money
                      amount={
                        dashboard
                          .summary
                          .monthExpense
                      }

                      className={[
                        styles.metricValue,
                        styles.negativeValue
                      ].join(" ")}
                    />
                  </div>


                  <div
                    className={[
                      styles.metric,
                      styles.netMetric
                    ].join(" ")}
                  >
                    <span
                      className={
                        styles.metricLabel
                      }
                    >
                      순현금흐름
                    </span>

                    <Money
                      amount={
                        dashboard
                          .summary
                          .monthNetCashFlow
                      }

                      showPlus

                      className={[
                        styles.metricValue,

                        dashboard
                          .summary
                          .monthNetCashFlow <
                        0
                          ? styles
                              .negativeValue
                          : styles
                              .positiveValue
                      ].join(" ")}
                    />
                  </div>
                </div>
              </Card>
            </section>


            <section
              className={
                styles.section
              }

              aria-labelledby={
                "asset-summary-title"
              }
            >
              <div
                className={
                  styles.sectionHeader
                }
              >
                <h2
                  id={
                    "asset-summary-title"
                  }
                >
                  자산 요약
                </h2>
              </div>

              <Card
                className={
                  styles.netWorthCard
                }
              >
                <div>
                  <span
                    className={
                      styles.netWorthLabel
                    }
                  >
                    순자산
                  </span>

                  <Money
                    amount={
                      dashboard
                        .summary
                        .netWorth
                    }

                    className={
                      styles.netWorthValue
                    }
                  />
                </div>


                <div
                  className={
                    styles.netWorthDetails
                  }
                >
                  <div
                    className={
                      styles.netWorthDetail
                    }
                  >
                    <span
                      className={
                        styles.detailLabel
                      }
                    >
                      총자산
                    </span>

                    <Money
                      amount={
                        dashboard
                          .summary
                          .assets
                      }

                      className={
                        styles.detailValue
                      }
                    />
                  </div>


                  <div
                    className={
                      styles.netWorthDetail
                    }
                  >
                    <span
                      className={
                        styles.detailLabel
                      }
                    >
                      부채
                    </span>

                    <Money
                      amount={
                        dashboard
                          .summary
                          .liabilities
                      }

                      className={
                        styles.detailValue
                      }
                    />
                  </div>
                </div>
              </Card>


              <div
                className={
                  styles.assetGrid
                }
              >
                <Card
                  compact
                  flat

                  className={
                    styles.assetCard
                  }
                >
                  <span
                    className={
                      styles.assetLabel
                    }
                  >
                    현금성 자산
                  </span>

                  <Money
                    amount={
                      dashboard
                        .summary
                        .cashLikeValue
                    }

                    className={
                      styles.assetValue
                    }
                  />
                </Card>


                <Card
                  compact
                  flat

                  className={
                    styles.assetCard
                  }
                >
                  <span
                    className={
                      styles.assetLabel
                    }
                  >
                    투자자산
                  </span>

                  <Money
                    amount={
                      dashboard
                        .summary
                        .investmentValue
                    }

                    className={
                      styles.assetValue
                    }
                  />
                </Card>
              </div>
            </section>
          </div>
        )
      }
    </div>
  );
}


export default HomePage;
