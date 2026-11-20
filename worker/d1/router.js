// /api/* D1 라우터와 배우자 푸시 대기열
import { isSameOrigin } from "../auth.js";
import { ensureClassificationSchema, getClassificationSettings } from "../classification.js";
import { BackupValidationError } from "../domain/backupRestore.js";
import { summarizeTransactionForPush } from "../domain/webPush.js";
import { errorResponse, readJsonObject } from "../http.js";
import {
  deletePushSubscription,
  getPushConfig,
  notifyPartnersOfTransaction,
  PushError,
  savePushSubscription,
  sendTestPush
} from "../push.js";
import { resolveLegalRegion } from "../realEstate.js";
import {
  mbD1AutomationSettingsData,
  mbD1HandleAutomationSettings,
  mbD1ProcessRecurring
} from "./automation.js";
import {
  mbD1BuildBackupDocument,
  mbD1PreviewBackupRestore,
  mbD1RestoreBackupMerge
} from "./backup.js";
import { mbD1BenefitRewardBalancesData, mbD1PreviewBenefit } from "./benefits.js";
import {
  mbApplyClassification,
  mbClassificationPreview,
  mbD1EnsureInstallmentSchema,
  mbSaveClassification
} from "./classification.js";
import {
  getHouseholdRealtimeStub,
  MB_D1_HOUSEHOLD_ID,
  mbD1Envelope,
  MbD1Error,
  mbD1Fail,
  mbD1GetLedgerConfigData,
  mbD1RealtimePoke,
  mbD1Text
} from "./core.js";
import { mbD1BuildBootstrap, mbD1BuildDashboard } from "./dashboard.js";
import { mbD1AnalyzeImportedTransactions } from "./importAnalysis.js";
import {
  mbD1HandleCashBaseline,
  mbD1HandleHoldingUpdate,
  mbD1HandleTradeMutation,
  mbD1RefreshQuotes
} from "./investments.js";
import {
  mbD1GetAccountsData,
  mbD1GetAssetSnapshotsData,
  mbD1GetCategoriesData,
  mbD1GetHoldingsData,
  mbD1GetInvestmentAccountsData,
  mbD1GetInvestmentCashData,
  mbD1GetTradesData,
  mbD1GetTransactionsData,
  mbD1SettlementCandidatesData,
  mbD1SettlementSummaryData
} from "./queries.js";
import {
  mbD1DeleteRealEstate,
  mbD1GetRealEstateData,
  mbD1RefreshRealEstate,
  mbD1SaveRealEstate
} from "./realEstate.js";
import {
  mbD1HandleAccountMutation,
  mbD1HandleAssetSnapshot,
  mbD1HandleCategoryMutation,
  mbD1HandleInputPreferences,
  mbD1HandleLedgerConfig,
  mbD1SaveHouseholdOverview
} from "./settings.js";
import {
  mbD1HandleTaxCategory,
  mbD1HandleTaxPreset,
  mbD1HandleTaxProfile,
  mbD1TaxSummaryData
} from "./tax.js";
import { mbD1HandleTransactionMutation } from "./transactions.js";

export async function mbD1ProductionRoute(request, url, session, env, ctx) {
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const getPaths = new Set([
    "/api/bootstrap",
    "/api/dashboard",
    "/api/categories",
    "/api/accounts",
    "/api/settings/ledger-config",
    "/api/settings/automation",
    "/api/benefits/reward-balances",
    "/api/transactions",
    "/api/transactions/settlement-summary",
    "/api/transactions/settlement-candidates",
    "/api/asset-snapshots",
    "/api/investments/accounts",
    "/api/investments/holdings",
    "/api/investments/trades",
    "/api/investments/cash",
    "/api/real-estate",
    "/api/real-estate/regions",
    "/api/backup/export",
    "/api/push/config",
    "/api/settings/classification",
    "/api/tax/summary"
  ]);
  const postPaths = new Set([
    "/api/transactions",
    "/api/transactions/update",
    "/api/transactions/delete",
    "/api/transactions/restore",
    "/api/transactions/settle",
    "/api/transactions/settle-batch",
    "/api/categories",
    "/api/categories/update",
    "/api/categories/delete",
    "/api/categories/restore",
    "/api/accounts",
    "/api/accounts/update",
    "/api/accounts/delete",
    "/api/accounts/restore",
    "/api/settings/ledger-start-date",
    "/api/settings/ledger-start-date/clear",
    "/api/settings/input-preferences",
    "/api/settings/household-overview",
    "/api/settings/automation",
    "/api/automations/recurring/process",
    "/api/automations/recurring/create",
    "/api/benefits/preview",
    "/api/asset-snapshots",
    "/api/investments/cash-baseline",
    "/api/investments/holdings/update",
    "/api/investments/trades",
    "/api/investments/trades/update",
    "/api/investments/trades/delete",
    "/api/investments/trades/restore",
    "/api/import/transactions/analyze",
    "/api/real-estate/save",
    "/api/real-estate/delete",
    "/api/real-estate/refresh",
    "/api/backup/preview",
    "/api/backup/restore",
    "/api/push/subscribe",
    "/api/push/unsubscribe",
    "/api/push/test",
    "/api/tax/profile",
    "/api/tax/category",
    "/api/settings/classification",
    "/api/classification/preview",
    "/api/classification/apply",
    "/api/tax/preset"
  ]);
  if (request.method === "GET" && !getPaths.has(path)) return null;
  if (request.method === "POST" && !postPaths.has(path)) return null;
  if (!["GET", "POST"].includes(request.method)) return null;
  if (!env.DB) {
    return errorResponse(
      "D1_NOT_BOUND",
      "D1 바인딩 DB가 연결되어 있지 않습니다. Cloudflare Bindings에서 DB를 moneybook-prod에 연결해주세요.",
      500
    );
  }
  try {
    await mbD1EnsureInstallmentSchema(env);
    await ensureClassificationSchema(env);
    if (request.method === "GET") {
      if (path === "/api/settings/classification")
        return mbD1Envelope(await getClassificationSettings(env, MB_D1_HOUSEHOLD_ID));
      if (path === "/api/bootstrap") return mbD1Envelope(await mbD1BuildBootstrap(env, session));
      if (path === "/api/dashboard") {
        const refreshQuotes = url.searchParams.get("refreshQuotes") === "1";

        if (refreshQuotes) {
          await mbD1RefreshQuotes(env, true);
        } else if (ctx?.waitUntil) {
          ctx.waitUntil(mbD1RefreshQuotes(env, false));
        }

        return mbD1Envelope(await mbD1BuildDashboard(env, mbD1Text(url.searchParams.get("month"))));
      }
      if (path === "/api/categories") return mbD1Envelope(await mbD1GetCategoriesData(env, url));
      if (path === "/api/accounts") return mbD1Envelope(await mbD1GetAccountsData(env, url));
      if (path === "/api/settings/ledger-config")
        return mbD1Envelope(await mbD1GetLedgerConfigData(env));
      if (path === "/api/settings/automation")
        return mbD1Envelope(await mbD1AutomationSettingsData(env));
      if (path === "/api/benefits/reward-balances")
        return mbD1Envelope(await mbD1BenefitRewardBalancesData(env));
      if (path === "/api/transactions/settlement-summary") {
        const transactionId = mbD1Text(url.searchParams.get("transactionId"));
        if (!transactionId) mbD1Fail("TRANSACTION_ID_REQUIRED", "transactionId가 필요합니다.");
        return mbD1Envelope(await mbD1SettlementSummaryData(env, transactionId));
      }
      if (path === "/api/transactions/settlement-candidates")
        return mbD1Envelope(await mbD1SettlementCandidatesData(env, url));
      if (path === "/api/transactions")
        return mbD1Envelope(await mbD1GetTransactionsData(env, url));
      if (path === "/api/asset-snapshots")
        return mbD1Envelope(await mbD1GetAssetSnapshotsData(env, url));
      if (path === "/api/investments/accounts")
        return mbD1Envelope(await mbD1GetInvestmentAccountsData(env));
      if (path === "/api/investments/holdings") {
        if (ctx?.waitUntil) ctx.waitUntil(mbD1RefreshQuotes(env, false));
        return mbD1Envelope(await mbD1GetHoldingsData(env, url));
      }
      if (path === "/api/investments/trades")
        return mbD1Envelope(await mbD1GetTradesData(env, url));
      if (path === "/api/investments/cash")
        return mbD1Envelope(await mbD1GetInvestmentCashData(env, url));
      if (path === "/api/real-estate") return mbD1Envelope(await mbD1GetRealEstateData(env));
      if (path === "/api/real-estate/regions") {
        let items;
        try {
          items = await resolveLegalRegion(env, mbD1Text(url.searchParams.get("q")));
        } catch (error) {
          mbD1Fail(
            error?.code || "REGION_LOOKUP_FAILED",
            error instanceof Error ? error.message : "주소의 지역코드를 찾지 못했습니다.",
            400
          );
        }
        return mbD1Envelope({ items });
      }
      if (path === "/api/backup/export") return mbD1Envelope(await mbD1BuildBackupDocument(env));
      if (path === "/api/push/config")
        return mbD1Envelope(await getPushConfig(env, MB_D1_HOUSEHOLD_ID, session));
      if (path === "/api/tax/summary") return mbD1Envelope(await mbD1TaxSummaryData(env, url));
    }
    if (!isSameOrigin(request))
      return errorResponse("INVALID_ORIGIN", "허용되지 않은 요청입니다.", 403);
    const allowEmpty = path === "/api/settings/ledger-start-date/clear";
    const body = await readJsonObject(request, { allowEmptyBody: allowEmpty });
    if (!body) return errorResponse("INVALID_JSON", "요청 형식이 올바르지 않습니다.", 400);

    // 알림 구독은 가계부 데이터를 바꾸지 않으므로 실시간 동기화 신호 없이 바로 응답합니다.
    if (path === "/api/push/subscribe") {
      return mbD1Envelope(
        await savePushSubscription(
          env,
          MB_D1_HOUSEHOLD_ID,
          session,
          body,
          request.headers.get("User-Agent")
        )
      );
    }
    if (path === "/api/push/unsubscribe") {
      return mbD1Envelope(await deletePushSubscription(env, MB_D1_HOUSEHOLD_ID, session, body));
    }
    if (path === "/api/push/test") {
      return mbD1Envelope(await sendTestPush(env, MB_D1_HOUSEHOLD_ID, session, url.origin));
    }

    let data;
    if (path === "/api/classification/preview")
      return mbD1Envelope(await mbClassificationPreview(body, env));
    if (path === "/api/settings/classification")
      data = await mbSaveClassification(body, session, env);
    else if (path === "/api/classification/apply")
      data = await mbApplyClassification(body, session, env);
    else if (path.startsWith("/api/transactions"))
      data = await mbD1HandleTransactionMutation(path, body, session, env);
    else if (path.startsWith("/api/categories"))
      data = await mbD1HandleCategoryMutation(path, body, session, env);
    else if (path.startsWith("/api/accounts"))
      data = await mbD1HandleAccountMutation(path, body, session, env);
    else if (path.startsWith("/api/settings/ledger-start-date"))
      data = await mbD1HandleLedgerConfig(path, body, session, env);
    else if (path === "/api/settings/input-preferences")
      data = await mbD1HandleInputPreferences(body, session, env);
    else if (path === "/api/settings/household-overview")
      data = await mbD1SaveHouseholdOverview(body, session, env);
    else if (path === "/api/settings/automation")
      data = await mbD1HandleAutomationSettings(body, session, env);
    else if (path === "/api/automations/recurring/process")
      data = await mbD1ProcessRecurring(env, session, {});
    else if (path === "/api/automations/recurring/create")
      data = await mbD1ProcessRecurring(env, session, { ruleId: body.ruleId, month: body.month });
    else if (path === "/api/benefits/preview") data = await mbD1PreviewBenefit(env, body);
    else if (path === "/api/asset-snapshots")
      data = await mbD1HandleAssetSnapshot(body, session, env);
    else if (path === "/api/investments/cash-baseline")
      data = await mbD1HandleCashBaseline(body, session, env);
    else if (path === "/api/investments/holdings/update")
      data = await mbD1HandleHoldingUpdate(body, session, env);
    else if (path.startsWith("/api/investments/trades"))
      data = await mbD1HandleTradeMutation(path, body, session, env, ctx);
    else if (path === "/api/import/transactions/analyze")
      data = await mbD1AnalyzeImportedTransactions(body, session, env);
    else if (path === "/api/real-estate/save") data = await mbD1SaveRealEstate(body, session, env);
    else if (path === "/api/real-estate/delete")
      data = await mbD1DeleteRealEstate(body, session, env);
    else if (path === "/api/real-estate/refresh")
      data = await mbD1RefreshRealEstate(body, session, env);
    else if (path === "/api/tax/profile") data = await mbD1HandleTaxProfile(body, session, env);
    else if (path === "/api/tax/category") data = await mbD1HandleTaxCategory(body, session, env);
    else if (path === "/api/tax/preset") data = await mbD1HandleTaxPreset(body, session, env);
    else if (path === "/api/backup/preview")
      data = await mbD1PreviewBackupRestore(body.backup, env);
    else if (path === "/api/backup/restore") {
      if (body.confirm !== "RESTORE_MERGE")
        mbD1Fail("BACKUP_RESTORE_CONFIRM_REQUIRED", "복원 확인 문구가 올바르지 않습니다.", 400);
      data = await mbD1RestoreBackupMerge(body.backup, session, env);
    } else return null;
    if (ctx?.waitUntil) {
      ctx.waitUntil(mbD1RealtimePoke(env, { path, changedBy: session?.name || null }));
      // 새 거래가 실제로 만들어졌을 때만(중복 재전송 제외) 배우자 기기에 알림을 보냅니다.
      if (path === "/api/transactions" && data?.created && !data?.duplicate && session?.name) {
        ctx.waitUntil(
          mbD1QueuePartnerPush(env, session.name, data.transaction, url.origin).catch(error =>
            console.warn("[moneybook push] notify failed", error)
          )
        );
      }
    }
    return mbD1Envelope(data);
  } catch (error) {
    if (error instanceof MbD1Error) {
      return errorResponse(error.code, error.message, error.status || 400);
    }
    if (error instanceof PushError) {
      return errorResponse(error.code, error.message, error.status || 400);
    }
    if (error instanceof BackupValidationError) {
      return errorResponse(error.code || "BACKUP_INVALID", error.message, 400);
    }
    throw error;
  }
}

/**
 * 배우자 알림을 바로 보내지 않고 실시간 Durable Object의 대기열에 넣습니다.
 * 잠깐(PUSH_BATCH_QUIET_MS) 더 입력이 없으면 그동안 모인 거래를 알림 하나로 보냅니다.
 * Durable Object를 쓸 수 없으면 예전처럼 바로 한 건씩 보냅니다.
 */
export async function mbD1QueuePartnerPush(env, actorName, transaction, origin) {
  if (!transaction) return;
  const stub = await getHouseholdRealtimeStub(env);
  if (stub) {
    try {
      const response = await stub.fetch("https://moneybook-realtime.internal/push/enqueue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actor: actorName,
          origin,
          transaction: summarizeTransactionForPush(transaction)
        })
      });
      if (response.ok) return;
    } catch (error) {
      console.warn("[moneybook push] queue failed, sending directly", error);
    }
  }
  await notifyPartnersOfTransaction(env, MB_D1_HOUSEHOLD_ID, actorName, transaction, origin);
}
