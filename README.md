# 우리 가계부 

React + TypeScript + Vite 프론트엔드와 Cloudflare Worker/D1로 구성된 2인용 가계부 PWA입니다.

## 개발 명령

```bash
npm install
npm run dev
npm run check
npm run build
```

`npm run check`는 TypeScript 검사, Node 기본 테스트, Worker 문법 검사, 소스 경계 검사를 순서대로 실행합니다. 기능 변경 후에는 최소한 `npm run check`를 통과시키고 배포 전에는 `npm run build`까지 확인합니다.

현재 저장소에는 `package-lock.json`이 없으므로 정상적인 npm 네트워크 환경에서 `npm install` 후 생성된 lockfile을 함께 커밋하는 것을 권장합니다.

## 주요 구조

```text
src/
  api/                  API 호출, 캐시, 오프라인 스냅샷
  components/common/    Button, Card, Money, BottomSheet, ConfirmDialog 등 공통 UI
  pages/                화면 단위 기능
  types/                공통 API/도메인 타입
  utils/                시간, 동기화, 오프라인 큐 등 공통 로직
worker/
  index.js              Worker 라우팅 및 D1 도메인 처리
  auth.js               로그인/세션
  investmentSymbols.js  투자 종목 검색
  domain/               테스트 가능한 Worker 순수 로직(날짜·자동화·검색조건 등)
tests/                  Node 기본 테스트 러너 기반 테스트
```

페이지에서 직접 `fetch()`를 호출하거나 `window.confirm()`을 사용하지 않습니다. API 요청은 `src/api/client.ts`, 확인창은 공통 `ConfirmDialog` 경로를 사용합니다. `npm run check:boundaries`가 이 규칙을 검사합니다.

## Cloudflare 구성

`wrangler.jsonc`는 다음 리소스를 사용합니다.

- D1 binding: `DB`
- Durable Object binding: `HOUSEHOLD_REALTIME`
- Cron: `5 15 * * *` — 매일 한국시간 00:05에 고정 거래 확인
- Static assets: SPA fallback + `/api/*` Worker 우선 처리

필요한 비밀값은 Cloudflare secret으로 저장합니다.

- `LOGIN_USERS`: 로그인 사용자 JSON
- `SESSION_SECRET`: 세션 HMAC 서명 키
- `LEDGER_API_SECRET`: 기존 ledger 연동 비밀값
- `APPS_SCRIPT_URL`: 기존 Apps Script 연동/관리 기능용 URL

비밀값은 저장소에 직접 커밋하지 않습니다.

## 오프라인/PWA

- 저장 요청은 IndexedDB 대기열에 넣고 `requestId`로 중복 저장을 방지합니다.
- 마지막으로 성공한 현재 대시보드는 기기에 스냅샷으로 보관해 오프라인 재실행 때 읽을 수 있습니다.
- 명시적 로그아웃 또는 세션 만료 시 로컬 대시보드 스냅샷을 삭제합니다.
- 설치된 앱 아이콘의 바로가기에서 지출/수입/이체 입력과 내역 화면으로 바로 이동할 수 있습니다.
- 설정 > 가계부 운영·데이터에서 전체 거래 CSV와 전체 데이터 JSON 백업을 만들 수 있습니다. JSON 백업에는 삭제 거래, 계좌/카테고리, 투자 보유/거래, 자산 스냅샷, 입력/자동화 설정이 포함됩니다.

## 배포

```bash
npm run deploy
```

배포 스크립트는 먼저 TypeScript/Vite 빌드를 수행한 뒤 Wrangler로 배포합니다. Durable Object migration과 Cron 설정은 `wrangler.jsonc`에 포함되어 있습니다.

> D1의 전체 `CREATE TABLE` 스키마 migration은 현재 저장소에 완전한 형태로 보존되어 있지 않습니다. 새 D1 데이터베이스를 임의로 재생성하지 말고, 운영 스키마를 먼저 정확히 추출한 뒤 별도의 schema migration으로 버전 관리하는 것이 안전합니다.
