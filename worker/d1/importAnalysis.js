// 카드/문자 내역 가져오기 분석 결과를 가계부 데이터와 매칭
import {
  chooseCategory as mbImportChooseCategory,
  choosePaymentMethod as mbImportChoosePaymentMethod,
  findDuplicateTransaction as mbImportFindDuplicate
} from "../domain/transactionImport.js";
import { analyzeTransactionImport } from "../transactionImport.js";
import {
  MB_D1_HOUSEHOLD_ID,
  mbD1All,
  mbD1CurrentDateSeoul,
  mbD1Fail,
  mbD1Members,
  mbD1Text
} from "./core.js";
import {
  mbD1MapAccountRow,
  mbD1MapCategory,
  mbD1RawAccounts,
  mbD1RecentImportTransactions
} from "./records.js";

export async function mbD1AnalyzeImportedTransactions(body, session, env) {
  const analysisPromise = analyzeTransactionImport(env, {
    text: body.text,
    images: body.images,
    today: mbD1CurrentDateSeoul()
  }).then(
    value => ({ ok: true, value }),
    error => ({ ok: false, error })
  );
  const categoriesPromise = mbD1All(
    env,
    "SELECT * FROM categories WHERE household_id=? AND deleted_at IS NULL AND is_active=1 ORDER BY name",
    [MB_D1_HOUSEHOLD_ID]
  ).then(rows => rows.map(mbD1MapCategory));
  const accountsPromise = mbD1RawAccounts(env).then(rows => rows.map(mbD1MapAccountRow));
  const recentTransactionsPromise = mbD1RecentImportTransactions(env, 800);
  const membersPromise = mbD1Members(env);

  const [analysisResult, categories, accounts, recentTransactions, memberRows] = await Promise.all([
    analysisPromise,
    categoriesPromise,
    accountsPromise,
    recentTransactionsPromise,
    membersPromise
  ]);
  const paymentMethods = accounts.filter(account => account.active && !account.isDeleted);

  let extracted;
  try {
    if (!analysisResult.ok) throw analysisResult.error;
    extracted = analysisResult.value;
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error || "");
    const looksLikeLimit =
      error?.status === 429 ||
      /(?:429|quota|rate.?limit|neuron|usage.?limit|too many requests)/i.test(rawMessage);
    if (looksLikeLimit) {
      mbD1Fail(
        "AI_DAILY_LIMIT",
        "오늘 사용할 수 있는 AI 분석량을 모두 사용했습니다. 무료 할당량이 초기화된 뒤 다시 이용해주세요.",
        429
      );
    }
    const code = error?.code || "AI_ANALYSIS_FAILED";
    const message = rawMessage || "거래 내역을 분석하지 못했습니다.";
    mbD1Fail(code, message, code === "AI_NOT_BOUND" ? 503 : 400);
  }

  const memberNames = memberRows.map(row => mbD1Text(row.display_name)).filter(Boolean);
  const defaultTarget = memberNames.includes(session?.name) ? session.name : "공동";
  return {
    model: "@cf/moondream/moondream3.1-9B-A2B",
    items: extracted.map(candidate => {
      let paymentMethod = mbImportChoosePaymentMethod(candidate.cardName, paymentMethods);

      const categoryMatch = mbImportChooseCategory(candidate, categories, recentTransactions);
      const toAccountId =
        candidate.kind === "income" &&
        paymentMethod?.accountType === "자산" &&
        !["신용카드", "체크카드"].includes(paymentMethod?.subType)
          ? paymentMethod.accountId
          : "";
      const duplicate =
        candidate.kind !== "refund"
          ? mbImportFindDuplicate(
              { ...candidate, toAccountId },
              recentTransactions,
              paymentMethod?.accountId || null
            )
          : null;
      const reasons = [];
      if (!candidate.date) reasons.push("날짜 확인 필요");
      if (!candidate.amount) reasons.push("금액 확인 필요");
      if (!candidate.merchant) reasons.push("가맹점 확인 필요");
      if (candidate.kind === "expense" && !paymentMethod) reasons.push("결제수단 선택 필요");
      if (candidate.kind === "income" && !toAccountId) reasons.push("입금계좌 선택 필요");
      if (candidate.kind === "transfer") reasons.push("출금·입금계좌 선택 필요");
      if (!categoryMatch.category) reasons.push("카테고리 선택 필요");
      if (candidate.confidence === "low") reasons.push("인식 결과 확인 필요");
      if (duplicate) reasons.push("중복 거래 의심");
      if (candidate.kind === "refund") reasons.push("취소/환불은 원거래 연결 확인 필요");
      return {
        ...candidate,
        categoryId: categoryMatch.category?.categoryId || null,
        categoryName: categoryMatch.category?.name || "",
        categorySuggestionSource: categoryMatch.source,
        fromAccountId: "",
        toAccountId,
        paymentMethodId: candidate.kind === "expense" ? paymentMethod?.accountId || null : null,
        paymentMethodName: paymentMethod?.displayName || "",
        spendingTarget: defaultTarget,
        duplicate: duplicate
          ? {
              transactionId: duplicate.transactionId,
              date: duplicate.date,
              amount: duplicate.amount,
              description: duplicate.description,
              paymentMethod: duplicate.paymentMethod,
              category: duplicate.category
            }
          : null,
        selected: candidate.kind !== "refund" && reasons.length === 0,
        reviewReasons: reasons
      };
    })
  };
}
