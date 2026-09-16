# Moneybook 안정성 수정 적용 순서

이 묶음의 앱/Worker 코드는 기존 동작과 호환되도록 수정되어 있습니다. D1 UNIQUE 인덱스만 별도로 확인 후 적용하세요.

## 1. 먼저 현재 D1 스키마를 보관

```bash
npx wrangler d1 export moneybook-prod --remote --output=./schema-before-stability.sql --no-data
```

가능하면 Moneybook 설정 화면에서도 JSON 안전 백업을 하나 내려받아 보관하세요.

> D1 Free 플랜은 Worker 한 번의 호출에서 실행할 수 있는 D1 쿼리 수가 제한되어 있습니다. 그래서 이번 묶음은 백업 복원을 억지로 하나의 거대한 batch로 바꾸지 않습니다. 기존의 분할 복원 흐름을 유지하면서, 복원 전에 잡을 수 있는 잘못된 날짜/월/requestId 충돌 검증을 강화했습니다.

## 2. request_id 중복 확인

```bash
npx wrangler d1 execute moneybook-prod --remote --file=./database/check-request-id-duplicates.sql
```

두 SELECT 모두 **0행**이어야 합니다. 중복 행이 보이면 인덱스 적용을 중단하고 먼저 중복 데이터를 확인하세요.

## 3. UNIQUE 인덱스 적용

```bash
npx wrangler d1 execute moneybook-prod --remote --file=./migrations/0001_request_id_unique_indexes.sql
```

이 인덱스는 거래/투자거래의 `(household_id, request_id)` 중복을 DB 차원에서 차단합니다.

## 4. Worker/프론트 코드 배포

평소 배포 방식으로 배포하세요.

## 5. 로그인 비밀번호 해시 전환(선택, 권장)

코드는 기존 평문 LOGIN_USERS와 새 PBKDF2 형식을 모두 지원하므로 당장 바꾸지 않아도 로그인은 깨지지 않습니다.

새 해시 만들기:

```bash
MONEYBOOK_PASSWORD='비밀번호' node scripts/hash-login-password.mjs
```

출력된 `pbkdf2-sha256$...` 문자열을 Cloudflare Secret의 LOGIN_USERS 값에서 해당 사용자의 비밀번호 대신 넣습니다.

예:

```json
{"사용자1":"pbkdf2-sha256$210000$...$...","사용자2":"기존평문도호환"}
```

모든 계정이 해시로 바뀐 뒤에는 평문 비밀번호가 Secret에 남지 않게 됩니다.

## 포함된 안전성 수정

- 백업 거래 날짜, 청구월, 자산 스냅샷 월, 투자 거래 날짜를 실제 달력 기준으로 검증
- 복원 전에 requestId 충돌 검사를 강화하고, 기존 분할 복원/부분 실패 기록 방식은 Free 플랜 호환을 위해 유지
- 설정 화면에서 로그아웃해도 대시보드/부트스트랩/투자/설정 로컬 캐시를 정리
- 오프라인 거래 큐는 IndexedDB 저장 성공을 확인한 뒤 UI에 반영하고, IndexedDB가 정상일 때 legacy localStorage 복사본을 제거
- localStorage가 차단된 환경에서도 IndexedDB가 정상이라면 오프라인 입력을 계속 저장
- LOGIN_USERS에 PBKDF2-SHA256 해시를 사용할 수 있게 추가(기존 평문 호환)
- request_id UNIQUE 인덱스와 동시 요청 충돌 처리 추가

## 이번에 일부러 하지 않은 변경

- `worker/index.js` 대규모 모듈 분리: 구조 리팩터링이라 회귀 위험이 있어 이번 안정성 묶음에서는 제외
- 대용량 백업 복원의 완전한 단일 트랜잭션화: D1 Free 플랜의 invocation/query 제한 때문에 별도 설계 없이 강제하면 오히려 복원이 실패할 수 있어 제외
