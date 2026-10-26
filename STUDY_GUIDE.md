# 코드 공부 안내 (2026-10-26)

이 저장소를 처음부터 읽을 때의 지도다. 무엇이 어디 있고, 어떤 차례로 읽으면 흐름이 잡히는지 적었다.
리팩터링(2026-10-26)으로 큰 파일을 나눈 뒤의 모양이다. 예전 import 경로는 그대로 쓸 수 있다
(원래 파일이 새 모듈을 다시 내보낸다).

## 1. 다섯 패키지

| 패키지 | 하는 일 | 먼저 볼 파일 |
|---|---|---|
| `types` | 서버·기기가 함께 쓰는 **규칙**. 전표 조립, 금액(Dec), 시계(HLC), 오류 코드, DTO | `entry-build.ts`, `decimal.ts`, `hlc.ts`, `errors.ts`, `dtos.ts` |
| `api` | NestJS + Prisma(Postgres). 인증, 원장, 동기화 재생, 결제 웹훅 | `main.ts`, `app.module.ts`, `modules/ledger`, `modules/sync` |
| `core` | 웹·앱이 함께 쓰는 훅·상태·API 클라이언트, 앱의 **기기 사본(SQLite)** | `lib/api-client.ts`, `store/auth.ts`, `data/home-port.ts`, `data/local-store.ts` |
| `app` | Expo(안드로이드). 화면, 오프라인 연결, 알림 캡처, 결제 | `boot.ts`, `offline.ts`, `shell/AppShell.tsx` |
| `web` | Next.js 14. 쿠키 세션, 같은 core 훅으로 화면 | `app/layout.tsx`, `app/(app)/layout.tsx`, `components/AppShell.tsx` |

빌드 순서는 늘 `types → core → api·app·web` 이다(`npx turbo run build --filter=@money/types --filter=@money/core`).

## 2. 가장 중요한 생각 셋

1. **복식부기 원장.** 거래(전표) 하나는 다리(posting) 여럿으로 저장된다. 지출은 "통장 −, 분류 +" 처럼 합이 0 이다.
   잔액·카드 대금·예산은 모두 다리를 더해 낸다. 조립 규칙은 `types/src/entry-build.ts` 하나뿐이고 서버와 기기가 같은 것을 쓴다.
2. **창구(port)를 갈아 끼운다.** 화면은 `homeDataPort()`·`entryWritePort()` 로 읽고 쓴다.
   웹은 HTTP 창구(`httpHomePort`)를, 앱은 기기 사본 창구(`createLocalHomePort`)를 꽂는다(`app/src/offline.ts`).
   그래서 같은 훅이 웹에서는 서버를, 앱에서는 오프라인 사본을 본다.
3. **앱은 오프라인이 먼저다.** 쓰기는 사본에 바로 적고 명령(mutation)을 아웃박스에 쌓는다.
   동기화가 명령을 서버로 보내고(push) 바뀐 줄을 받아(pull) 사본을 맞춘다. 충돌은 HLC 시계로 가린다.

## 3. 흐름별로 따라 읽기

### 로그인
`web/app/login/page.tsx` 또는 `app/screens/LoginScreen.tsx` → `core/store/auth.ts` 의 `signInWithGoogle`
→ `core/lib/api-client.ts` → `api/modules/auth/auth.service.ts`. 웹은 HttpOnly 쿠키, 앱은 토큰 저장소(`app/src/token-storage.ts`).
새 가입은 약관 동의가 있어야 한다(`TERMS_REQUIRED`).

### 가계부 고르기·만들기·참여
`core/hooks/useProjectBootstrap.ts`(목록 받기) → 없으면 시작 화면(`useProjectStart.ts`, 웹 `app/start`, 앱 `StartScreen`).
서버는 `api/modules/projects/projects.service.ts`, 기본 분류는 `categories/default-categories.ts`.

### 거래 쓰기
- 폼 상태: `core/hooks/useEntryForm.ts`(앱) — 값·검사·요청 조립은 `core/data/entry-form-*.ts` 넷.
  웹 편집기는 자기 폼 모양을 따로 든다(`web/components/entry-editor/editor-form*.ts`) — 아래 "알아 둘 중복" 참고.
- 저장: `entryWritePort().createEntry(...)`.
  - 웹: `httpEntryWritePort` → `api/modules/entries` → `ledger/ledger.service.ts`.
  - 앱: `core/data/local-entry-writer.ts` → `buildEntry`(types) → `local-store` 에 적고 아웃박스에 명령.

### 동기화(앱)
`app/shell/OfflineSync.tsx` → `core/data/sync-engine.ts` 의 `syncProject`
- push: `local-store-outbox.ts`(쌓기·결과 정리) → 서버 `api/modules/sync/mutation-replay.service.ts`
  → 종류별 재생 `entry-mutations.ts`·`asset-mutations.ts`·`catalog-mutations.ts`·`settings-mutations.ts`,
  명령 기록은 `mutation-claim.ts`.
- pull: 서버 `sync.service.ts` → 기기 `local-store-pull.ts` 의 `applyPull`.
- 실시간: 서버 `modules/realtime` 이 "바뀌었다"만 흘리고, 기기는 그때 pull 한다(`core/data/sync-events.ts`).

### 화면 읽기
- 거래 탭: `core/hooks/useTransactions.ts`(검색 `lib/transaction-search.ts`, 기간 `transaction-periods.ts`,
  줄 `transaction-rows.ts`, 고르기 `useTransactionSelection.ts`) → 웹 `components/TransactionsView.tsx`, 앱 `screens/TransactionsScreen.tsx`.
- 홈(예산): `useHomeData.ts`, 자산: `useAssetsData.ts`, 분석: `useAnalysis.ts`.
- 기기 사본에서 읽는 쪽은 `core/data/local-home-*.ts`(목록·자산·예산·리포트·카드·거래), 서버는 `api/modules/reports`, `cards`.

### 결제·광고
앱 `billing.ts`(RevenueCat) → 서버 `api/modules/plans/billing-webhook.service.ts` → 권한 줄 `ProjectPlanGrant`.
광고는 `core/lib/ads.ts`(횟수·간격) + 앱 `ads.ts`.

## 4. 기기 사본(local-store) 파일 지도

`local-store.ts` 는 `LocalStore` 클래스(바깥에서 부르는 메서드 전부)이고, 긴 몸통은 옆 파일에 있다.

| 파일 | 내용 |
|---|---|
| `local-store-types.ts` | 내보내는 타입, `REBUILD_PENDING` |
| `local-store-values.ts` | 칸 값 읽기(`asText`·`asMoney`·`asInt`), 자리표 |
| `local-store-mappers.ts` | 행 → 화면 모양 변환 |
| `local-store-schema-shape.ts` | 표·열 목록, 지운 줄 표 |
| `local-store-entry-filters.ts` | 거래 조회의 WHERE 조립 |
| `local-store-entry-view.ts` | 거래 줄에 다리 붙이기 |
| `local-store-commit.ts` | 거래·자산 적기 |
| `local-store-writes.ts` | upsert 와 연결 줄 정리 |
| `local-store-bulk-edits.ts` | 여러 거래의 분류·태그 바꾸기 |
| `local-store-card-postings.ts` | 카드 사용·대금 다리 |
| `local-store-clocks.ts` | 필드별 HLC 시계 |
| `local-store-outbox.ts` | 아웃박스(쌓기·결과·다시 내기·별칭) |
| `local-store-pull.ts` | 받은 변경 적용 |
| `schema.ts` | SQLite 표와 색인 |

## 5. 서버 큰 서비스의 지도

- `ledger/`: `ledger.service.ts`(공개 메서드) + `ledger-types`·`ledger-rows`(순수 변환)·`ledger-writes`(트랜잭션 안 검사)·`ledger-payback`·`opening-balance`.
- `sync/`: 위 "동기화" 참고. 모양 검사 `mutation-shape.ts`, 공통 답 `mutation-results.ts`, 90일 지난 기록 지우기 `mutation-log-cleanup.service.ts`.
- `reports/`: `report-period`(기간 읽기)·`report-scope`(조회 조건)·`report-rows`(행 변환).
- `cards/`: `card-ledger.service.ts` + `card-period-walk`(주기 커서·누계)·`card-usage-rows`.
- 공통: `common/` 의 `project-access.guard.ts`(역할), `ledger-lock.ts`(가계부 잠금), `app-error.ts`(코드 달린 오류).

## 6. 읽을 때 알아 둘 것

- **주석은 "왜"를 적는다.** 날짜(2026-10-16 등)는 그 결정을 내린 때다. 그 전후 사정은 루트의 `*_AUDIT.md`·`*_DESIGN.md` 에 있다.
- **동시성 규칙**은 `TIMING_AUDIT.md`. 잠금 차례와 await 순서를 바꾸면 안 되는 자리가 표시돼 있다.
- **오류 코드**는 `types/src/errors.ts` → 번역 `core/lib/api-error.ts` → 문구 `core/lib/i18n/messages/{ko,en,ja}.ts`.
- **검증**: 타입 `npx turbo run type-check`, core 스모크 `packages/core/scripts/*-smoke.ts`, API 스모크 `packages/api/scripts/*-smoke.ts`(명령은 각 파일 머리말).

## 7. 알아 둘 중복 (일부러 남긴 것)

- **웹 거래 편집기의 폼**(`web/components/entry-editor/editor-form*.ts`)과 **core 폼**(`core/data/entry-form-*.ts`, 앱이 씀)이 따로 있다.
  합치면 웹 편집기의 동작이 바뀔 수 있어 이번 정리에서는 손대지 않았다. 따로 할 일이다.
- 웹 자산 화면의 원장 받기(`components/assets/useAssetPageLedger.ts`, 서버에서 100줄씩)와 core `useAccountLedger`(창구, 20줄씩).
- 거래 목록의 펼친 줄 만들기(`level2`·`entryList`)는 웹·앱 화면 안에 그대로 있다. 늦게 그리기 카운터가 렌더 차례에 묶여 있어 떼지 않았다.
- `api/modules/entries/entries.service.ts` 의 검색 조건은 `reports/report-scope.ts` 와 비슷하다. 다음에 합칠 후보.
