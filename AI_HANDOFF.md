# 우리 가계부 — AI_HANDOFF

> 최종 갱신: 2026-08-10 18:02 KST  
> 이 문서는 새 AI 대화가 현재 프로젝트 상태를 즉시 이어받기 위한 **작업 인수인계 문서**다.  
> 먼저 `ARCHITECTURE.md`를 읽은 뒤 이 문서를 읽는다.

---

# 1. 한 줄 현재 상태

**Apps Script 백엔드 v2.2.0은 25/25 PASS로 완료되었고, Cloudflare → Apps Script 보안 중계와 로그인도 연결되었으며, 이제 정식 프론트엔드 구조를 결정하고 실사용 가계부 UI를 만드는 단계다.**

---

# 2. 완료된 핵심 단계

## Google Sheets 설계

완료/검증:

- 카테고리
- 계좌
- 가계부
- 보유종목
- 카드 계산 구조
- 대출 구조
- 투자 구조
- 고유 ID 구조
- soft delete
- 행 자동 확장
- 로그/무결성

사용자용 스프레드시트 대시보드는 만들지 않는 것으로 방향 변경 완료.

## Apps Script

최종 기준:

```text
Backend version: 2.2.0
```

최종 테스트:

```text
SUCCESS
PASS 25
FAIL 0
무결성 0
```

따라서 특별한 이유가 없는 한 Code.gs를 다시 대규모 개편하지 않는다.

## Cloudflare 배포

GitHub `moneybook` 저장소가 Cloudflare Worker에 연결되어 있다.

공개 주소:

```text
https://moneybook.mysc0711.workers.dev
```

GitHub `main` push 후 자동 배포가 동작한다.

## Cloudflare → Apps Script

다음 테스트 완료:

### `/api/ping`

```json
{"success":true,"message":"Cloudflare Worker is running."}
```

### `/api/health`

```json
{
  "success": true,
  "apiVersion": "2.2.0",
  "service": "부부가계부",
  "status": "ok"
}
```

### `/api/backend-test`

최종 관측:

```json
{
  "success": true,
  "backendAuthenticated": true,
  "apiVersion": "2.2.0",
  "counts": {
    "accounts": 18,
    "categories": 23,
    "members": 2,
    "spendingTargets": 3
  }
}
```

이 숫자들은 현재 데이터 상태일 뿐 하드코딩 금지.

## 로그인

Cloudflare 기반 로그인 성공 확인됨.

Secrets:

```text
APPS_SCRIPT_URL
LEDGER_API_SECRET
LOGIN_USERS
SESSION_SECRET
```

Secret 실제 값은 문서나 코드에 없음.

---

# 3. 현재 인프라 설정

## Apps Script 웹앱

Cloudflare가 로그인 없이 서버 측에서 호출해야 하므로 웹앱 접근권한을
Google 로그인 없이 접근 가능한 배포로 변경 완료.

Apps Script 자체의 실제 데이터 API는 `LEDGER_API_SECRET`을 통해 보호하는 구조.

## Cloudflare

현재 Worker는 정적 자산과 `/api/*`를 함께 제공한다.

기본 디렉터리 구조는 현재 대략:

```text
moneybook/
├─ public/
│  └─ index.html
├─ src/
│  └─ index.js
└─ wrangler.jsonc
```

주의:

- `wrangler.jsonc`는 root
- `public/wrangler.jsonc`가 아님
- 정적 파일은 `public/`
- 현재 Worker 서버 코드는 `src/index.js`

향후 프론트엔드 빌드 구조를 도입하면 Worker를 `worker/index.ts` 등으로 옮길 수 있으나 아직 확정/적용되지 않았다.

---

# 4. 현재 인증 설계

쿠키:

```text
__Host-moneybook_session
```

보안 속성:

- HttpOnly
- Secure
- SameSite=Strict
- HMAC 서명

사용자는 “90일”보다 사실상 계속 로그인되기를 원함.

최신 합의:

```text
SESSION_MAX_AGE = 400일
```

그리고 `/api/auth/session`이 성공할 때마다 새 400일 쿠키를 발급하는 **sliding session**으로 변경한다.

이렇게 하면 400일 안에 한 번 이상 앱을 계속 사용하면 로그인 상태가 계속 연장된다.

---

# 5. 매우 중요한 현재 코드 상태

## 최신 업로드한 Worker 초안은 문법 오류가 있음

사용자가 마지막으로 공유한 `src/index.js` 초안에는:

```javascript
const SESSION_MAX_AGE =
  60 * 60 * 24 * 400;
```

및 session refresh 로직은 들어갔지만,
기존 `sessionDays: 90`을 삭제하는 과정에서 로그인 성공 응답의 닫는 `}`가 하나 빠졌다.

문제가 있는 형태:

```javascript
return jsonResponse(
  {
    success: true,
    loggedIn: true,

    user: {
      name
    },

  200,
```

정상 형태는 반드시:

```javascript
return jsonResponse(
  {
    success: true,
    loggedIn: true,

    user: {
      name
    }
  },

  200,

  {
    "Set-Cookie":
      createCookie(
        token
      )
  }
);
```

이어야 한다.

### 따라서 다음 작업 전에

- 이 문법 오류 수정
- commit
- Cloudflare 자동 배포 성공 확인

이 필요하다.

**사용자가 이 수정이 실제 배포됐다고 아직 확인하지 않았으므로, “400일 sliding session 배포 완료”라고 간주하지 말 것.**

---

# 6. 현재 프론트 화면 상태

현재 화면은 **임시 로그인/보안 연결 테스트 UI**다.

사용자가 로그인한 뒤 화면에 다음과 같은 개발용 정보가 보이는 상태였다.

- 현재 사용자
- 90일 로그인 설명
- 보안 연결 확인 버튼
- API 2.2.0
- 계좌/카테고리/구성원/지출대상 개수
- 로그아웃

사용자는 이 화면을 최종 UI로 원하지 않는다.

최종 요구:

> “프론트엔드는 가계부 역할에만 충실하게 하고 싶어.”

따라서 최종 화면에서 삭제:

- `보안 연결 확인`
- API 버전
- 계좌 개수
- 카테고리 개수
- 구성원 개수
- 지출대상 개수
- 로그인 유지 기간 설명
- Apps Script URL 입력
- 개발용 ping/health 표시

앱 시작 시 백그라운드에서 자동으로:

```text
/api/auth/session
→ /api/bootstrap
→ 앱 렌더
```

하고 문제가 있을 때만 오류 UI를 보여준다.

---

# 7. 현재 프론트엔드 기술 선택 상태

**아직 최종 확정되지 않음.**

중요한 대화 흐름:

1. 사용자가 React를 예시로 들며 컴포넌트 분리 및 전역 스타일 관리를 제안
2. AI가 React를 너무 빨리 확정
3. 사용자가 “React는 예시일 뿐 꼭 React일 필요 없음”이라고 정정
4. 사용자의 실제 선정 기준은 다음과 같음

```text
- 코드는 AI를 활용해서 작성할 예정
- 장기 유지보수가 쉬워야 함
- 기능 추가가 쉬워야 함
- AI가 프로젝트 구조와 코드를 잘 이해해야 함
- 공통 요소와 색상은 전역 관리
- 컴포넌트 단위로 분리
```

현재 후보:

- React + TypeScript + Vite
- Vue 3 + TypeScript + Vite

AI가 직전에는 React + TypeScript + Vite 쪽을 추천했지만
**사용자가 최종 동의한 상태는 아니다.**

따라서 다음 AI는 프레임워크를 확정 사실로 가정하지 말 것.

---

# 8. 프론트엔드 기술 선정 시 우선순위

프레임워크 이름보다 아래 기준을 우선 평가한다.

1. AI가 코드를 잘 생성하고 수정할 수 있음
2. 장기 유지보수 용이
3. 컴포넌트 경계 명확
4. 타입으로 API 계약을 명시할 수 있음
5. 기능별 파일 구조가 명확
6. 공통 UI 재사용
7. 디자인 토큰 전역화
8. Cloudflare 배포 단순
9. 생태계/문서 충분
10. 미래 기능 추가에 유리

TypeScript 사용은 높은 우선순위로 검토 중.
프레임워크보다 “명시적인 타입과 파일 구조”가 AI 인수인계에 더 큰 도움이 될 수 있음.

---

# 9. 프론트엔드에서 반드시 유지할 원칙

## 공통 컴포넌트

예상:

- Button
- Card
- Modal
- Input
- Select
- Money
- Toast
- BottomNav
- Loading
- EmptyState

## 전역 디자인 시스템

예:

```text
styles/tokens.css
styles/global.css
```

색상, spacing, radius, shadow 등을 중앙 관리.

## 기능별 분리

예:

```text
features/transactions/
features/accounts/
features/investments/
```

## API 분리

화면에서 fetch를 직접 반복하지 말고:

```text
api/client
api/ledger
```

같은 계층을 둔다.

## 타입

예:

```text
types/account
types/transaction
types/investment
types/api
```

백엔드 JSON 계약을 명시한다.

---

# 10. 사용자용 거래 입력 UX

## 수입

보여줄 것:

- 날짜
- 금액
- 카테고리
- 입금수단
- 메모

## 지출

보여줄 것:

- 날짜
- 금액
- 카테고리
- 결제수단
- 지출대상
- 메모

## 이체

보여줄 것:

- 날짜
- 금액
- 카테고리
- 보내는 수단
- 받는 수단
- 메모

백엔드가 다시 검증하므로 프론트 검증은 UX 개선용이며 보안의 최종 방어선은 아님.

---

# 11. 최신 사용자 용어

프론트 UI에서:

```text
지출귀속  X
지출대상  O
```

계좌 사람 구분:

```text
소유자  X
명의자  O
```

거래 입력:

```text
출금계좌 → 상황별 결제수단 / 보내는 수단
입금계좌 → 상황별 입금수단 / 받는 수단
```

---

# 12. 카드 로직 — 다시 만들지 말 것

## 체크카드

프론트에서 체크카드를 선택하면 백엔드가:

```text
payment_method_id = 체크카드
from_account_id = 연결된 실제 통장
```

으로 저장.

## 신용카드

카드 자체가 부채.

지출 시 카드 부채 증가.

카드값 결제:

```text
은행 → 카드 이체
```

## 지역화폐

독립 자산.

이 로직을 프론트에서 다시 계산하지 않는다.

---

# 13. 대출

최종 결정:

- 대출 시작잔액은 가계부 시작 시점 실제 남은 원금을 **음수**로 기록
- 원금 상환 = 이체
- 이자 = 지출 `이자비용`

과거의 “원금+이자를 뭉쳐 처리” 아이디어는 폐기.

---

# 14. 투자

백엔드 v2.2에서 검증 완료:

- 매수
- 추가매수
- 매도
- 평균매입가
- 실현손익
- 예수금
- 해외주식
- 보유종목 CRUD
- 투자 CRUD

아직 실제 사용자 데이터에서 필요한 작업:

> 실제 투자계좌별 현재 예수금 기준값 최초 입력

이 작업은 시트에서 직접 시키지 않고 최종 투자 화면에서 한 번 입력시키는 UX로 만들 예정.

---

# 15. 연말정산 기능

현재 범위에서 제외.

사용자가:

> “내년부터 활용하려고 해서 일단 제외하고 가계부 먼저 만들고 싶음.”

이라고 결정.

따라서 지금 프론트엔드/시트에 연말정산 미터기 로직을 강제로 추가하지 말 것.

과거 대화에서 논의한 K~Q 열 등은 향후 참고용 아이디어다.

---

# 16. 현재 데이터 관측값

마지막 backend-test:

```text
accounts = 18
categories = 23
members = 2
spendingTargets = 3
```

과거 테스트에서 구성원 이름으로 `승철`, `미영`이 관측됨.

하지만 프론트에서는 이름을 하드코딩하지 않는다.
항상 bootstrap 데이터 사용.

---

# 17. 다음 작업 순서

현재 가장 안전한 다음 단계:

## 1단계 — Worker 코드 문법 수정

최신 초안의 로그인 성공 응답 `}` 누락 수정.

## 2단계 — 400일 sliding session 배포 검증

- GitHub commit
- Cloudflare 자동 배포
- 로그인
- 새로고침
- 세션 정상 유지

개발 UI에서 세션 기간을 보여줄 필요 없음.

## 3단계 — 프론트 기술 최종 결정

React/Vue 등의 후보를 다음 기준으로 짧게 비교한 뒤 사용자와 확정:

- 유지보수
- 확장
- AI 이해
- TypeScript
- 생태계
- Cloudflare

## 4단계 — 프로젝트 구조 전환

프레임워크 확정 후:

- 빌드 환경
- 디자인 토큰
- 전역 CSS
- 타입
- API client
- 공통 컴포넌트
- auth bootstrap

를 먼저 만든다.

## 5단계 — 임시 테스트 UI 제거

최종 로그인 흐름만 남김.

## 6단계 — 실제 가계부 홈

예상:

```text
이번 달 수입
이번 달 지출
순현금흐름
순자산
최근 거래
```

## 7단계 — 거래 입력

수입/지출/이체.

## 8단계 — 거래 내역

조회/검색/필터/수정/삭제/복원.

## 9단계 — 자산

계좌/카드/대출/지역화폐.

## 10단계 — 투자

예수금 최초 설정, 매수/매도, 보유종목/손익.

## 11단계 — PWA

핵심 기능 안정 후.

---

# 18. 새 대화에서 AI가 해야 할 첫 행동

사용자가 새 대화에서 이 두 파일을 주면:

1. `ARCHITECTURE.md`를 읽는다.
2. 이 파일의 `현재 코드 상태`와 `다음 작업 순서`를 확인한다.
3. 사용자가 이미 한 작업을 다시 시키지 않는다.
4. 현재 GitHub 파일이 필요하면 사용자가 제공한 최신 코드 기준으로 점검한다.
5. 프레임워크 선택이 아직 미확정임을 기억한다.
6. Secret 값을 요청하지 않는다.
7. 백엔드 v2.2를 처음부터 다시 설계하지 않는다.

---

# 19. 코드 제공 방식 선호

이 프로젝트에서는 수정 실수를 줄이기 위해 가능하면:

```text
“몇 줄 찾아서 조금 수정”
```

보다:

```text
“이 파일 전체를 아래 완성본으로 교체”
```

방식을 우선한다.

단, 아주 작은 1~2줄 수정이고 전체 파일 교체가 오히려 위험한 경우에는
정확한 위치와 교체 전/후를 명확히 제시한다.

---

# 20. 문서 갱신 규칙

중요한 변경이 생길 때마다 이 문서를 갱신한다.

갱신 대상 예:

- 프론트 프레임워크 최종 확정
- 디렉터리 구조 변경
- API endpoint 추가
- Worker 경로 변경
- 인증 방식 변경
- 실제 프론트 기능 완료
- PWA 완료
- 연말정산 기능 시작
- 백엔드 버전 변경

새 대화로 옮기기 전:

> “ARCHITECTURE.md와 AI_HANDOFF.md를 최신 상태로 갱신해줘.”

라고 요청하면 된다.

과거 1~12번 대화 백업은 역사 기록으로 보관할 수 있지만,
앞으로 새 대화의 기본 인수인계 자료는 이 두 문서를 사용한다.

