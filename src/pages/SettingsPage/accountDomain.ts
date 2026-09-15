import type {
  AutomationSettings,
  BenefitKind,
  BenefitRule
} from "../../api/automation";
import type {
  ManagedAccount,
  SaveAccountInput
} from "../../api/settingsManagement";
export interface AccountFormState {
    accountName:
        string;

    accountType:
        string;

    subType:
        string;

    owner:
        string;

    openingBalance:
        string;

    rewardOpeningBalance:
        string;

    benefitKind:
        BenefitKind;

    benefitRatePercent:
        string;

    benefitMonthlyCap:
        string;

    benefitValidFrom:
        string;

    benefitValidTo:
        string;

    billingCutoffDay:
        string;

    paymentDay:
        string;

    startYear:
        string;

    endYear:
        string;

    balanceMethod:
        string;

    paymentAccountId:
        string;
}


export type AccountKindValue =
    | "checking"
    | "cash"
    | "deposit"
    | "saving"
    | "prepaid"
    | "checkCard"
    | "creditCard"
    | "loan"
    | "investment";


export interface AccountKindDefinition {
    value:
        AccountKindValue;

    label:
        string;

    accountType:
        string;

    subType:
        string;

    balanceMethod:
        string;
}


export const ACCOUNT_KIND_OPTIONS:
    AccountKindDefinition[] = [
        {
            value:
                "checking",

            label:
                "입출금통장",

            accountType:
                "자산",

            subType:
                "입출금",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "cash",

            label:
                "현금",

            accountType:
                "자산",

            subType:
                "현금",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "deposit",

            label:
                "예금",

            accountType:
                "자산",

            subType:
                "예금",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "saving",

            label:
                "적금",

            accountType:
                "자산",

            subType:
                "적금",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "prepaid",

            label:
                "선불·지역화폐",

            accountType:
                "자산",

            subType:
                "선불/지역화폐",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "checkCard",

            label:
                "체크카드",

            accountType:
                "결제수단",

            subType:
                "체크카드",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "creditCard",

            label:
                "신용카드",

            accountType:
                "부채",

            subType:
                "신용카드",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "loan",

            label:
                "대출",

            accountType:
                "부채",

            subType:
                "대출",

            balanceMethod:
                "자동계산"
        },

        {
            value:
                "investment",

            label:
                "투자계좌",

            accountType:
                "자산",

            subType:
                "주식",

            balanceMethod:
                "평가입력"
        }
    ];


export function getAccountKind(
    accountType:
        string,

    subType:
        string
) {
    return (
        ACCOUNT_KIND_OPTIONS.find(
            option =>
                option.subType ===
                subType
        ) ||
        ACCOUNT_KIND_OPTIONS.find(
            option =>
                option.accountType ===
                    accountType &&
                option.subType ===
                    subType
        ) ||
        null
    );
}


export function getAccountKindLabel(
    accountType:
        string,

    subType:
        string
) {
    return (
        getAccountKind(
            accountType,
            subType
        )?.label ||
        subType ||
        accountType ||
        "기타"
    );
}


export function applyAccountKind(
    current:
        AccountFormState,

    kind:
        AccountKindDefinition
): AccountFormState {
    const isCard =
        kind.subType ===
            "체크카드" ||
        kind.subType ===
            "신용카드";

    const isCreditCard =
        kind.subType ===
        "신용카드";

    return {
        ...current,

        accountType:
            kind.accountType,

        subType:
            kind.subType,

        balanceMethod:
            kind.balanceMethod,

        rewardOpeningBalance:
            kind.subType ===
                "선불/지역화폐"
                ? current.rewardOpeningBalance
                : "",

        benefitKind:
            kind.subType ===
                "선불/지역화폐"
                ? current.benefitKind
                : "none",

        benefitRatePercent:
            kind.subType ===
                "선불/지역화폐"
                ? current.benefitRatePercent
                : "",

        benefitMonthlyCap:
            kind.subType ===
                "선불/지역화폐"
                ? current.benefitMonthlyCap
                : "",

        benefitValidFrom:
            kind.subType ===
                "선불/지역화폐"
                ? current.benefitValidFrom
                : "",

        benefitValidTo:
            kind.subType ===
                "선불/지역화폐"
                ? current.benefitValidTo
                : "",

        paymentAccountId:
            isCard
                ? current.paymentAccountId
                : "",

        billingCutoffDay:
            isCreditCard
                ? current.billingCutoffDay
                : "",

        paymentDay:
            isCreditCard
                ? current.paymentDay
                : ""
    };
}


export function formatKrw(
    value:
        number |
        undefined
) {
    if (
        value === undefined ||
        !Number.isFinite(value)
    ) {
        return "-";
    }

    return `${Math.round(value).toLocaleString("ko-KR")}원`;
}


export function createEmptyAccountForm(
    owner:
        string =
            "공동"
): AccountFormState {
    return {
        accountName:
            "",

        accountType:
            "자산",

        subType:
            "입출금",

        owner,

        openingBalance:
            "",

        rewardOpeningBalance:
            "",

        benefitKind:
            "none",

        benefitRatePercent:
            "",

        benefitMonthlyCap:
            "",

        benefitValidFrom:
            "",

        benefitValidTo:
            "",

        billingCutoffDay:
            "",

        paymentDay:
            "",

        startYear:
            "",

        endYear:
            "",

        balanceMethod:
            "자동계산",

        paymentAccountId:
            ""
    };
}


export function accountToForm(
    account:
        ManagedAccount,

    benefitRule:
        BenefitRule |
        null = null
): AccountFormState {
    const kind =
        getAccountKind(
            account.accountType,
            account.subType
        );

    return {
        accountName:
            account.accountName,

        accountType:
            kind?.accountType ||
            account.accountType,

        subType:
            kind?.subType ||
            account.subType,

        owner:
            account.owner,

        openingBalance:
            String(
                account.openingBalance ??
                    0
            ),

        rewardOpeningBalance:
            Number(
                benefitRule?.rewardOpeningBalance ||
                0
            ) > 0
                ? String(
                    benefitRule?.rewardOpeningBalance
                )
                : "",

        benefitKind:
            benefitRule?.kind ||
            "none",

        benefitRatePercent:
            Number(
                benefitRule?.ratePercent ||
                0
            ) > 0
                ? String(
                    benefitRule?.ratePercent
                )
                : "",

        benefitMonthlyCap:
            benefitRule?.monthlyCap ===
                null ||
            benefitRule?.monthlyCap ===
                undefined
                ? ""
                : String(
                    benefitRule.monthlyCap
                ),

        benefitValidFrom:
            benefitRule?.validFrom ||
            "",

        benefitValidTo:
            benefitRule?.validTo ||
            "",

        billingCutoffDay:
            account.billingCutoffDay ===
            null
                ? ""
                : String(
                    account.billingCutoffDay
                ),

        paymentDay:
            account.paymentDay ===
            null
                ? ""
                : String(
                    account.paymentDay
                ),

        startYear:
            account.startYear ===
            null
                ? ""
                : String(
                    account.startYear
                ),

        endYear:
            account.endYear ===
            null
                ? ""
                : String(
                    account.endYear
                ),

        balanceMethod:
            kind?.balanceMethod ||
            account.balanceMethod ||
            "자동계산",

        paymentAccountId:
            account.paymentAccountId ||
            ""
    };
}


export function getBenefitRuleForAccount(
    settings:
        AutomationSettings | null,

    accountId:
        string
) {
    if (
        !settings
    ) {
        return null;
    }

    return (
        settings.benefitRules.find(
            rule =>
                rule.accountId ===
                    accountId
        ) ||
        null
    );
}


export function parseRewardOpeningBalance(
    form:
        AccountFormState,

    openingBalance:
        number
) {
    if (
        form.subType !==
            "선불/지역화폐"
    ) {
        return 0;
    }

    const rewardOpeningBalance =
        Number(
            form.rewardOpeningBalance ||
                0
        );

    if (
        !Number.isFinite(
            rewardOpeningBalance
        ) ||
        rewardOpeningBalance < 0
    ) {
        throw new Error(
            "시작 잔액 중 캐시백은 0원 이상으로 입력해주세요."
        );
    }

    if (
        rewardOpeningBalance >
            Math.max(
                0,
                openingBalance
            )
    ) {
        throw new Error(
            "시작 잔액 중 캐시백은 시작 잔액보다 클 수 없습니다."
        );
    }

    return rewardOpeningBalance;
}


export function parseBenefitSettings(
    form:
        AccountFormState,

    rewardOpeningBalance:
        number
) {
    if (
        form.subType !==
            "선불/지역화폐"
    ) {
        return null;
    }

    if (
        form.benefitKind ===
            "none"
    ) {
        return {
            enabled:
                false,
            kind:
                "none" as BenefitKind,
            ratePercent:
                0,
            monthlyCap:
                null,
            validFrom:
                null,
            validTo:
                null,
            rewardOpeningBalance
        };
    }

    const ratePercent =
        Number(
            form.benefitRatePercent
        );

    if (
        !Number.isFinite(
            ratePercent
        ) ||
        ratePercent <= 0 ||
        ratePercent > 100
    ) {
        throw new Error(
            "혜택률은 0보다 크고 100 이하로 입력해주세요."
        );
    }

    const monthlyCap =
        form.benefitMonthlyCap.trim() ===
            ""
            ? null
            : Number(
                form.benefitMonthlyCap
            );

    if (
        monthlyCap !==
            null &&
        (
            !Number.isFinite(
                monthlyCap
            ) ||
            monthlyCap < 0
        )
    ) {
        throw new Error(
            "월 최대 혜택은 0원 이상으로 입력해주세요."
        );
    }

    const validFrom =
        form.benefitValidFrom ||
        null;

    const validTo =
        form.benefitValidTo ||
        null;

    if (
        validFrom &&
        validTo &&
        validFrom >
            validTo
    ) {
        throw new Error(
            "혜택 적용 시작일은 종료일보다 늦을 수 없습니다."
        );
    }

    return {
        enabled:
            true,
        kind:
            form.benefitKind,
        ratePercent,
        monthlyCap,
        validFrom,
        validTo,
        rewardOpeningBalance
    };
}


export function parseOptionalInteger(
    value:
        string,

    label:
        string,

    minimum:
        number,

    maximum:
        number
) {
    const text =
        value.trim();

    if (
        !text
    ) {
        return null;
    }

    const number =
        Number(
            text
        );

    if (
        !Number.isInteger(
            number
        ) ||
        number <
            minimum ||
        number >
            maximum
    ) {
        throw new Error(
            `${label}은 ${minimum}~${maximum} 사이의 정수여야 합니다.`
        );
    }

    return number;
}


export function buildAccountPayload(
    form:
        AccountFormState
): SaveAccountInput {
    const accountName =
        form.accountName.trim();

    const accountType =
        form.accountType.trim();

    const subType =
        form.subType.trim();

    const owner =
        form.owner.trim();

    const openingBalance =
        Number(
            form.openingBalance ||
                0
        );

    if (
        !accountName
    ) {
        throw new Error(
            "계좌 이름을 입력해주세요."
        );
    }

    if (
        !accountType ||
        !subType
    ) {
        throw new Error(
            "종류를 선택해주세요."
        );
    }

    if (
        !owner
    ) {
        throw new Error(
            "명의자를 선택해주세요."
        );
    }

    if (
        !Number.isFinite(
            openingBalance
        )
    ) {
        throw new Error(
            "시작 잔액은 숫자로 입력해주세요."
        );
    }

    const billingCutoffDay =
        parseOptionalInteger(
            form.billingCutoffDay,
            "청구 마감일",
            1,
            31
        );

    const paymentDay =
        parseOptionalInteger(
            form.paymentDay,
            "결제일",
            1,
            31
        );

    const startYear =
        parseOptionalInteger(
            form.startYear,
            "사용 시작 연도",
            1900,
            2200
        );

    const endYear =
        parseOptionalInteger(
            form.endYear,
            "사용 종료 연도",
            1900,
            2200
        );

    if (
        startYear !==
            null &&
        endYear !==
            null &&
        startYear >
            endYear
    ) {
        throw new Error(
            "사용 시작 연도는 종료 연도보다 늦을 수 없습니다."
        );
    }

    const isCard =
        subType ===
            "체크카드" ||
        subType ===
            "신용카드";

    if (
        isCard &&
        !form.paymentAccountId
    ) {
        throw new Error(
            "카드의 결제계좌를 선택해주세요."
        );
    }

    return {
        accountName,
        accountType,
        subType,
        owner,
        openingBalance,
        billingCutoffDay,
        paymentDay,
        startYear,
        endYear,

        balanceMethod:
            form.balanceMethod.trim() ||
            "자동계산",

        paymentAccountId:
            isCard
                ? form.paymentAccountId
                : null,

        assetAttribution:
            owner
    };
}
