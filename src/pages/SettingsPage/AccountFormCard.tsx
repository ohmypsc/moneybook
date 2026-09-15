import type {
  Dispatch,
  SetStateAction
} from "react";

import type {
  AutomationSettings,
  BenefitKind
} from "../../api/automation";
import type { ManagedAccount } from "../../api/settingsManagement";
import { Button } from "../../components/common/Button/Button";
import { Card } from "../../components/common/Card/Card";
import {
  ACCOUNT_KIND_OPTIONS
} from "./accountDomain";
import type {
  AccountFormState,
  AccountKindDefinition
} from "./accountDomain";
import styles from "./SettingsPage.module.css";

interface AccountFormCardProps {
  editingId: string | null;
  busyKey: string;
  form: AccountFormState;
  ownerOptions: string[];
  selectedKind: AccountKindDefinition | null;
  paymentAccountOptions: ManagedAccount[];
  automationSettings: AutomationSettings | null;
  error: string;
  closeForm: () => void;
  updateForm: (key: keyof AccountFormState, value: string) => void;
  handleKindChange: (value: string) => void;
  setForm: Dispatch<SetStateAction<AccountFormState>>;
  handleSave: () => Promise<void>;
}

export function AccountFormCard({
  editingId,
  busyKey,
  form,
  ownerOptions,
  selectedKind,
  paymentAccountOptions,
  automationSettings,
  error,
  closeForm,
  updateForm,
  handleKindChange,
  setForm,
  handleSave
}: AccountFormCardProps) {
  const isCard = form.subType === "체크카드" || form.subType === "신용카드";

  return (
            <Card as="section" className={styles.formCard}>
                                                <div
                                                    className={
                                                        styles.formHeader
                                                    }
                                                >
                                                    <div>
                                                        <h2>
                                                            {
                                                                editingId
                                                                    ? "항목 수정"
                                                                    : "새 항목 추가"
                                                            }
                                                        </h2>

                                                        <p>
                                                            종류만 선택하면 내부 자산·부채 분류와 잔액 방식은 앱이 자동으로 정합니다.
                                                        </p>
                                                    </div>

                                                    <Button
                                                        variant="soft"
                                                        size="sm"
                                                        iconOnly
                                                        aria-label="입력창 닫기"
                                                        disabled={
                                                            Boolean(
                                                                busyKey
                                                            )
                                                        }
                                                        onClick={
                                                            closeForm
                                                        }
                                                    >
                                                        ×
                                                    </Button>
                                                </div>

                                                <div
                                                    className={
                                                        styles.formGrid
                                                    }
                                                >
                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            이름
                                                        </span>

                                                        <input
                                                            type="text"
                                                            value={
                                                                form.accountName
                                                            }
                                                            maxLength={
                                                                60
                                                            }
                                                            disabled={
                                                                Boolean(
                                                                    busyKey
                                                                )
                                                            }
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "accountName",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        />
                                                    </label>

                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            명의자
                                                        </span>

                                                        <select
                                                            value={
                                                                form.owner
                                                            }
                                                            disabled={
                                                                Boolean(
                                                                    busyKey
                                                                )
                                                            }
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "owner",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        >
                                                            {
                                                                ownerOptions.map(
                                                                    owner => (
                                                                        <option
                                                                            key={
                                                                                owner
                                                                            }
                                                                            value={
                                                                                owner
                                                                            }
                                                                        >
                                                                            {owner}
                                                                        </option>
                                                                    )
                                                                )
                                                            }
                                                        </select>
                                                    </label>

                                                    <label
                                                        className={`${styles.field} ${styles.fullField}`}
                                                    >
                                                        <span>
                                                            종류
                                                        </span>

                                                        <select
                                                            value={
                                                                selectedKind
                                                                    ?.value ||
                                                                "__legacy__"
                                                            }
                                                            disabled={
                                                                Boolean(
                                                                    busyKey
                                                                )
                                                            }
                                                            onChange={
                                                                event => {
                                                                    if (
                                                                        event.target.value ===
                                                                        "__legacy__"
                                                                    ) {
                                                                        return;
                                                                    }

                                                                    handleKindChange(
                                                                        event.target.value
                                                                    );
                                                                }
                                                            }
                                                        >
                                                            {
                                                                !selectedKind && (
                                                                    <option
                                                                        value="__legacy__"
                                                                    >
                                                                        기존 분류 · {
                                                                            form.subType ||
                                                                            form.accountType ||
                                                                            "기타"
                                                                        }
                                                                    </option>
                                                                )
                                                            }

                                                            {
                                                                ACCOUNT_KIND_OPTIONS.map(
                                                                    option => (
                                                                        <option
                                                                            key={
                                                                                option.value
                                                                            }
                                                                            value={
                                                                                option.value
                                                                            }
                                                                        >
                                                                            {
                                                                                option.label
                                                                            }
                                                                        </option>
                                                                    )
                                                                )
                                                            }
                                                        </select>
                                                    </label>

                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            시작 잔액
                                                        </span>

                                                        <input
                                                            type="number"
                                                            inputMode="numeric"
                                                            value={
                                                                form.openingBalance
                                                            }
                                                            disabled={
                                                                Boolean(
                                                                    busyKey
                                                                )
                                                            }
                                                            placeholder="0"
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "openingBalance",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        />
                                                    </label>

                                                    {
                                                        form.subType ===
                                                            "선불/지역화폐" && (
                                                            <label
                                                                className={`${styles.field} ${styles.fullField}`}
                                                            >
                                                                <span>
                                                                    시작 잔액 중 캐시백
                                                                </span>

                                                                <input
                                                                    type="number"
                                                                    min={
                                                                        0
                                                                    }
                                                                    inputMode="numeric"
                                                                    value={
                                                                        form.rewardOpeningBalance
                                                                    }
                                                                    disabled={
                                                                        Boolean(
                                                                            busyKey
                                                                        ) ||
                                                                        Boolean(
                                                                            editingId &&
                                                                            !automationSettings
                                                                        )
                                                                    }
                                                                    placeholder={
                                                                        editingId &&
                                                                        !automationSettings
                                                                            ? "캐시백 정보 불러오는 중"
                                                                            : "0"
                                                                    }
                                                                    onChange={
                                                                        event =>
                                                                            updateForm(
                                                                                "rewardOpeningBalance",
                                                                                event.target.value
                                                                            )
                                                                    }
                                                                />

                                                                <small
                                                                    className={
                                                                        styles.fieldHelp
                                                                    }
                                                                >
                                                                    가계부 추적을 시작한 시점의 잔액 중 캐시백 금액만 입력합니다. 시작 잔액에 추가로 더해지지 않습니다. 온누리처럼 캐시백이 없는 경우 0원으로 두세요.
                                                                </small>
                                                            </label>
                                                        )
                                                    }

                                                    {
                                                        form.subType ===
                                                            "선불/지역화폐" && (
                                                            <div
                                                                className={`${styles.fullField} ${styles.automationBenefitCard}`}
                                                            >
                                                                <div
                                                                    className={
                                                                        styles.automationBenefitTitle
                                                                    }
                                                                >
                                                                    <strong>
                                                                        혜택 설정
                                                                    </strong>

                                                                    <span>
                                                                        이 자산에서 함께 관리
                                                                    </span>
                                                                </div>

                                                                <div
                                                                    className={
                                                                        styles.automationGrid
                                                                    }
                                                                >
                                                                    <label
                                                                        className={
                                                                            styles.field
                                                                        }
                                                                    >
                                                                        <span>
                                                                            혜택 방식
                                                                        </span>

                                                                        <select
                                                                            value={
                                                                                form.benefitKind
                                                                            }
                                                                            disabled={
                                                                                Boolean(
                                                                                    busyKey
                                                                                )
                                                                            }
                                                                            onChange={
                                                                                event => {
                                                                                    const kind =
                                                                                        event.target.value as BenefitKind;

                                                                                    setForm(
                                                                                        current => ({
                                                                                            ...current,
                                                                                            benefitKind:
                                                                                                kind,
                                                                                            benefitRatePercent:
                                                                                                kind ===
                                                                                                    "none"
                                                                                                    ? ""
                                                                                                    : current.benefitRatePercent,
                                                                                            benefitMonthlyCap:
                                                                                                kind ===
                                                                                                    "none"
                                                                                                    ? ""
                                                                                                    : current.benefitMonthlyCap,
                                                                                            benefitValidFrom:
                                                                                                kind ===
                                                                                                    "none"
                                                                                                    ? ""
                                                                                                    : current.benefitValidFrom,
                                                                                            benefitValidTo:
                                                                                                kind ===
                                                                                                    "none"
                                                                                                    ? ""
                                                                                                    : current.benefitValidTo
                                                                                        })
                                                                                    );
                                                                                }
                                                                            }
                                                                        >
                                                                            <option
                                                                                value="none"
                                                                            >
                                                                                혜택 없음
                                                                            </option>
                                                                            <option
                                                                                value="post_reward"
                                                                            >
                                                                                결제 후 즉시 캐시백
                                                                            </option>
                                                                            <option
                                                                                value="pre_discount"
                                                                            >
                                                                                충전 시 선할인
                                                                            </option>
                                                                        </select>
                                                                    </label>

                                                                    <label
                                                                        className={
                                                                            styles.field
                                                                        }
                                                                    >
                                                                        <span>
                                                                            혜택률 (%)
                                                                        </span>

                                                                        <input
                                                                            type="number"
                                                                            min={
                                                                                0
                                                                            }
                                                                            max={
                                                                                100
                                                                            }
                                                                            step="0.1"
                                                                            value={
                                                                                form.benefitRatePercent
                                                                            }
                                                                            disabled={
                                                                                Boolean(
                                                                                    busyKey
                                                                                ) ||
                                                                                form.benefitKind ===
                                                                                    "none"
                                                                            }
                                                                            placeholder="예: 10"
                                                                            onChange={
                                                                                event =>
                                                                                    updateForm(
                                                                                        "benefitRatePercent",
                                                                                        event.target.value
                                                                                    )
                                                                            }
                                                                        />
                                                                    </label>

                                                                    <label
                                                                        className={
                                                                            styles.field
                                                                        }
                                                                    >
                                                                        <span>
                                                                            월 최대 혜택
                                                                        </span>

                                                                        <input
                                                                            type="number"
                                                                            min={
                                                                                0
                                                                            }
                                                                            inputMode="numeric"
                                                                            value={
                                                                                form.benefitMonthlyCap
                                                                            }
                                                                            disabled={
                                                                                Boolean(
                                                                                    busyKey
                                                                                ) ||
                                                                                form.benefitKind ===
                                                                                    "none"
                                                                            }
                                                                            placeholder="제한 없으면 비움"
                                                                            onChange={
                                                                                event =>
                                                                                    updateForm(
                                                                                        "benefitMonthlyCap",
                                                                                        event.target.value
                                                                                    )
                                                                            }
                                                                        />
                                                                    </label>

                                                                    <label
                                                                        className={
                                                                            styles.field
                                                                        }
                                                                    >
                                                                        <span>
                                                                            적용 시작일
                                                                        </span>

                                                                        <input
                                                                            type="date"
                                                                            value={
                                                                                form.benefitValidFrom
                                                                            }
                                                                            disabled={
                                                                                Boolean(
                                                                                    busyKey
                                                                                ) ||
                                                                                form.benefitKind ===
                                                                                    "none"
                                                                            }
                                                                            onChange={
                                                                                event =>
                                                                                    updateForm(
                                                                                        "benefitValidFrom",
                                                                                        event.target.value
                                                                                    )
                                                                            }
                                                                        />
                                                                    </label>

                                                                    <label
                                                                        className={
                                                                            styles.field
                                                                        }
                                                                    >
                                                                        <span>
                                                                            적용 종료일
                                                                        </span>

                                                                        <input
                                                                            type="date"
                                                                            value={
                                                                                form.benefitValidTo
                                                                            }
                                                                            disabled={
                                                                                Boolean(
                                                                                    busyKey
                                                                                ) ||
                                                                                form.benefitKind ===
                                                                                    "none"
                                                                            }
                                                                            onChange={
                                                                                event =>
                                                                                    updateForm(
                                                                                        "benefitValidTo",
                                                                                        event.target.value
                                                                                    )
                                                                            }
                                                                        />
                                                                    </label>
                                                                </div>

                                                                {
                                                                    form.benefitKind ===
                                                                        "post_reward" && (
                                                                        <p
                                                                            className={
                                                                                styles.automationNote
                                                                            }
                                                                        >
                                                                            결제 후 캐시백을 즉시 적립합니다. 결제에 사용한 기존 캐시백 금액에는 새 캐시백을 적립하지 않습니다.
                                                                        </p>
                                                                    )
                                                                }

                                                                {
                                                                    form.benefitKind ===
                                                                        "pre_discount" && (
                                                                        <p
                                                                            className={
                                                                                styles.automationNote
                                                                            }
                                                                        >
                                                                            지역화폐 충전 시 충전액은 전액 반영하고, 출금 계좌에서는 할인된 실제 결제액만 빠지도록 계산합니다.
                                                                        </p>
                                                                    )
                                                                }
                                                            </div>
                                                        )
                                                    }

                                                    {
                                                        isCard && (
                                                            <label
                                                                className={`${styles.field} ${styles.fullField}`}
                                                            >
                                                                <span>
                                                                    카드 결제계좌
                                                                </span>

                                                                <select
                                                                    value={
                                                                        form.paymentAccountId
                                                                    }
                                                                    disabled={
                                                                        Boolean(
                                                                            busyKey
                                                                        )
                                                                    }
                                                                    onChange={
                                                                        event =>
                                                                            updateForm(
                                                                                "paymentAccountId",
                                                                                event.target.value
                                                                            )
                                                                    }
                                                                >
                                                                    <option
                                                                        value=""
                                                                    >
                                                                        선택해주세요
                                                                    </option>

                                                                    {
                                                                        paymentAccountOptions.map(
                                                                            account => (
                                                                                <option
                                                                                    key={
                                                                                        account.accountId
                                                                                    }
                                                                                    value={
                                                                                        account.accountId
                                                                                    }
                                                                                >
                                                                                    {
                                                                                        account.displayName
                                                                                    }
                                                                                </option>
                                                                            )
                                                                        )
                                                                    }
                                                                </select>
                                                            </label>
                                                        )
                                                    }

                                                    {
                                                        form.subType ===
                                                            "신용카드" && (
                                                            <>
                                                                <label
                                                                    className={
                                                                        styles.field
                                                                    }
                                                                >
                                                                    <span>
                                                                        청구 마감일
                                                                    </span>

                                                                    <input
                                                                        type="number"
                                                                        min={
                                                                            1
                                                                        }
                                                                        max={
                                                                            31
                                                                        }
                                                                        value={
                                                                            form.billingCutoffDay
                                                                        }
                                                                        placeholder="1~31"
                                                                        onChange={
                                                                            event =>
                                                                                updateForm(
                                                                                    "billingCutoffDay",
                                                                                    event.target.value
                                                                                )
                                                                        }
                                                                    />
                                                                </label>

                                                                <label
                                                                    className={
                                                                        styles.field
                                                                    }
                                                                >
                                                                    <span>
                                                                        결제일
                                                                    </span>

                                                                    <input
                                                                        type="number"
                                                                        min={
                                                                            1
                                                                        }
                                                                        max={
                                                                            31
                                                                        }
                                                                        value={
                                                                            form.paymentDay
                                                                        }
                                                                        placeholder="1~31"
                                                                        onChange={
                                                                            event =>
                                                                                updateForm(
                                                                                    "paymentDay",
                                                                                    event.target.value
                                                                                )
                                                                        }
                                                                    />
                                                                </label>
                                                            </>
                                                        )
                                                    }

                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            사용 시작 연도
                                                        </span>

                                                        <input
                                                            type="number"
                                                            min={
                                                                1900
                                                            }
                                                            max={
                                                                2200
                                                            }
                                                            value={
                                                                form.startYear
                                                            }
                                                            placeholder="선택 입력"
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "startYear",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        />
                                                    </label>

                                                    <label
                                                        className={
                                                            styles.field
                                                        }
                                                    >
                                                        <span>
                                                            사용 종료 연도
                                                        </span>

                                                        <input
                                                            type="number"
                                                            min={
                                                                1900
                                                            }
                                                            max={
                                                                2200
                                                            }
                                                            value={
                                                                form.endYear
                                                            }
                                                            placeholder="사용 중이면 비워두기"
                                                            onChange={
                                                                event =>
                                                                    updateForm(
                                                                        "endYear",
                                                                        event.target.value
                                                                    )
                                                            }
                                                        />
                                                    </label>
                                                </div>

                                                {
                                                    error && (
                                                        <p
                                                            className={
                                                                styles.error
                                                            }
                                                        >
                                                            {error}
                                                        </p>
                                                    )
                                                }

                                                <div
                                                    className={
                                                        styles.formActions
                                                    }
                                                >
                                                    <Button
                                                        variant="secondary"
                                                        onClick={
                                                            closeForm
                                                        }
                                                    >
                                                        취소
                                                    </Button>

                                                    <Button
                                                        
                                                        onClick={
                                                            () =>
                                                                void handleSave()
                                                        }
                                                    >
                                                        {
                                                            busyKey
                                                                ? "저장 중..."
                                                                : editingId
                                                                    ? "수정 저장"
                                                                    : "추가"
                                                        }
                                                    </Button>
                                                </div>
                                            </Card>
        );
}
