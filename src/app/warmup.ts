import { prefetchBootstrap } from "../api/bootstrap";
import { getCurrentCalendarMonth, loadCalendarMonth } from "../api/calendarCache";
import { getDashboard } from "../api/dashboard";
import { prefetchInvestmentTrades } from "../api/investments";
import { prefetchManagedSettings } from "../api/settingsManagement";
import { prefetchSecondaryPages } from "./pages";
import { wait } from "./splash";

const PRIMARY_WARM_TIMEOUT_MS = 2500;
const SECONDARY_WARM_DELAY_MS = 250;

/*
 * 스플래시가 보이는 동안 첫 진입에 필요한 데이터를 준비합니다.
 *
 * 홈 표시 전에는 대시보드만 기다립니다(최대 2.5초).
 * 이번 달 달력, 입력 화면용 bootstrap, 설정의 카테고리·자산 관리 데이터는
 * 같은 시점에 요청을 시작하되 완료를 기다리지 않습니다.
 * 실패해도 각 화면에서 필요할 때 다시 요청합니다.
 */
export async function warmPrimaryData() {
  const dashboardRequest = getDashboard();

  void loadCalendarMonth(getCurrentCalendarMonth()).catch(() => {});
  void prefetchBootstrap().catch(() => {});
  void prefetchManagedSettings().catch(() => {});

  await Promise.race([Promise.allSettled([dashboardRequest]), wait(PRIMARY_WARM_TIMEOUT_MS)]);
}

/** 홈이 실제로 뜬 뒤에만 필요한 투자 매매내역과 다른 화면 코드를 준비합니다. */
export function scheduleSecondaryWarm() {
  window.setTimeout(() => {
    void prefetchInvestmentTrades().catch(() => {});
    prefetchSecondaryPages();
  }, SECONDARY_WARM_DELAY_MS);
}
