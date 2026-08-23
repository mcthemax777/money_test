# 기능 개선 백로그 (2026-08-20, 구현 완료)

각 항목마다 현재 코드 상태(파일:줄 근거)와 확정된 결정을 적었다.
F와 G1은 의도적으로 삭제한 항목이라 번호를 비워 둔다. I·J·K는 코드 검토에서 새로 찾은 항목이다.

## 진행 상태

A~K 전 항목을 구현했다. 아래 본문은 착수 당시의 근거와 결정을 그대로 남겨 둔 기록이며,
줄 번호는 수정 전 기준이라 지금 코드와 다를 수 있다.

| 항목 | 내용 | 상태 |
| --- | --- | --- |
| J | 죽은 코드 4개 페이지 + 중복 모달 삭제 | 완료 |
| I1 | 타임존 통일 (저장은 UTC, 경계는 프로젝트 타임존) | 완료 |
| I2 | `Project.timezone` + 설정 화면 선택 UI | 완료 |
| D2 | 계좌·카드 상세/수정 모달 state 분리 | 완료 |
| D3 | 모달 재오픈 시 빈 폼 버그 (계좌·카드) | 완료 |
| E1 | 카드 번호·만료일 저장, 결제일 입력 추가, 카드 유형 읽기 전용 | 완료 |
| B | `Modal` 하단 고정 버튼 슬롯 + 전 모달 적용 | 완료 |
| A1 | 계좌·카드 통합 드롭다운 + 추가 유형 선택 팝업 재사용 | 완료 |
| A2 | 날짜·시간 최상단 이동, 시각 기본값 = 지금 | 완료 |
| A3 | 선택 항목 접기 (거래처·상세설명·이체수수료) | 완료 |
| C1 | 빈 소분류 행 제거 | 완료 |
| E2 | 마감일·결제일 옵션 공통화, 31일 "말일" 표기 | 완료 |
| G2 | 사람 필터 이동 + 고정 필터 추가, 둘 다 서버 필터로 | 완료 |
| G3 | 수단별 탭에 미사용 계좌·카드 0원 노출 | 완료 |
| D1 | 잔액 기준일 (as-of 잔액 기준 차액 계산) | 완료 |
| H1 | `ProjectMember.personId` = "구성원 중 나" | 완료 |
| H2 | 카테고리·구성원·계좌·카드 드래그 정렬 | 완료 |

### 마이그레이션

개발 서버를 테이블부터 새로 만들기로 해서, 이번 작업의 마이그레이션 세 개를
init 하나로 합쳤다(`20260821100000_init`). 배포 스크립트가 `migrate reset` 또는
`migrate deploy`를 쓰기 때문에(`scripts/deploy.sh:50,53`) 파일 자체는 여전히 필요하다.

합칠 때 `prisma migrate diff`로 재생성하지 않고 기존 init에 이어 붙였다.
init에는 Prisma 스키마로 표현할 수 없는 것들이 손으로 들어 있어 재생성하면 사라진다.
  - `posting_target_exclusive`, `posting_quantity_requires_account` CHECK 제약
  - `FinancialInstitution_global_type_name_key` 부분 유니크 인덱스
  - 기본 제공 금융기관 seed와 아이콘 경로 UPDATE

### 검증

`packages/api/scripts/*-smoke.ts` 15종 전부 통과한다. 실행 방법은 아래 "스모크 테스트 실행"을 참고한다.
새로 추가한 스크립트:

- `timezone-smoke.ts` — 서울/뉴욕 프로젝트에서 같은 인스턴트가 다른 달에 잡히는지, 카드 마감일이 지역 달력으로 잘리는지
- `filters-smoke.ts` — 사람·고정 필터가 목록·합계·구성비·시계열·수단별에 같이 걸리는지, 미사용 수단이 0원으로 오는지
- `opening-balance-smoke.ts` — 잔액을 고치면 기초잔액 전표 하나를 덮어쓰고(조정 전표가 쌓이지 않는다) 기존 거래는 그대로 남는지. `balance-date-smoke.ts`(기준일 기능)를 대체한다
- `permissions-smoke.ts` — owner/editor/viewer 역할별로 쓰기가 갈리는지, 응답에 카드번호 원문이 섞이지 않는지
- `currency-smoke.ts` — 달러 통장·원화 카드 외화 결제·환전이 원장 균형(환산액 합계 0)과 계좌별 통화 잔액을 지키는지, 리포트·순자산이 통화를 섞지 않는지
- `currency-edge-smoke.ts` — 환율 경계: 반올림(엔화·분할), 잘못된 환율, 다룰 수 없는 통화 조합, 외화 거래 수정·삭제 왕복, 저장 환율 우선순위, 기준통화 변경과 되돌리기
- `edge-cases-smoke.ts` — 조용히 틀린 값이 나오던 경계들(대분류 이름 중복, 거래 날짜 상한, 청구 주기 폭발, 예산 기간 분할, 숨기기·되돌리기, 200건 초과 커서)

### 스모크 테스트 실행

`scripts/`는 tsconfig의 `include` 밖이고 경로 별칭(`@/`) 런타임 해석기가 설치돼 있지 않다.
아래처럼 별칭 훅을 하나 만들어 붙여 돌린다.

```bash
cat > /tmp/alias.js <<'JS'
const path = require('path');
const Module = require('module');
const orig = Module._resolveFilename;
const root = '<repo>/packages/api/src';
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(root, request.slice(2));
  return orig.call(this, request, ...rest);
};
JS

cd packages/api
export TS_NODE_COMPILER_OPTIONS='{"module":"commonjs","target":"ES2020","esModuleInterop":true,"experimentalDecorators":true,"emitDecoratorMetadata":true,"strict":false,"skipLibCheck":true}'
node -r ts-node/register -r /tmp/alias.js scripts/timezone-smoke.ts
```

### 남겨 둔 것

- 예산 사용액(`/budgets/:year/:month`)도 2026-08-21에 같은 필터를 타도록 바꿨다.
  왼쪽 예산 카드와 오른쪽 상세 통계가 다른 숫자를 보여주는 문제 때문이다.
  예산액 자체는 프로젝트 단위 값이라 필터와 무관하게 그대로 둔다.
- 계좌 `sortOrder`는 프로젝트 단위 값인데 화면은 구성원별로 묶어 보여준다. 한 묶음 안의
  순서만 다시 매기므로 묶음끼리는 서로 영향을 주지 않는다.
- 표시 전용 사용자 타임존(`User.timezone`)은 만들지 않았다. 집계 경계는 프로젝트 기준이어야 한다.
- 기존 데이터 재해석 스크립트는 만들지 않았다. 날짜만 입력한 거래는 UTC 자정으로 저장돼
  있어 서울 기준으로는 09:00이 되지만 같은 날짜에 머물러 월 집계가 바뀌지 않는다.

---

## A. 거래 추가 팝업

### A1. 계좌/카드 한 번에 선택
현재는 2단계다. `dashboard/page.tsx:1176-1199`에서 라디오로 "계좌"/"카드"를 고르고, `1206-1229`에서 그 수단에 맞는 별도 `CustomSelect`가 뜬다.

**결정**: 항목 이름 앞에 "(계좌)", "(카드)" 접두사를 붙여 하나의 드롭다운으로 합친다. 예: "(계좌) 신한 통장", "(카드) 삼성카드".

구현 시 지켜야 할 것:
- `formData.method`는 상태에 그대로 두고 선택한 항목 id에서 유도한다. 카드를 고르면 `type: 'expense'`로 강제하고 분류를 초기화하는 기존 동작(`1192-1196`)을 유지해야 한다. 유형 드롭다운은 이미 `method === 'card'`면 "지출"만 남긴다(`1250-1258`).
- `CustomSelect`의 `onAddClick` 슬롯은 하나뿐이다(`CustomSelect.tsx:17-18`). **결정**: 기존 "추가 유형 선택" 팝업(`assets/page.tsx:943-` / `addType === 'select'`)을 재사용해 계좌·카드 추가를 한 버튼으로 받는다.
- `lockedPeriod`가 있으면 통합 드롭다운도 `disabled`여야 한다(현재 두 셀렉트 모두 잠긴다).

### A2. 날짜/시간 위치 및 기본값
필드 순서: 수단선택 → 계좌/카드 → 사용자 → 유형 → 분류 → 금액 → 설명 → 거래처 → 상세설명 → 고정 체크박스 → **날짜**(`1471-1485`) → **시간**(`1487-1497`).
초기값(`page.tsx:115-116`): `date`는 오늘, `time`은 빈 문자열.

**할 일**: 날짜/시간을 폼 최상단으로 옮기고 `time` 기본값을 현재 시각으로 채운다.
**선행 조건**: I1(타임존 통일)을 먼저 끝내야 한다. 지금 구조에서 `time`을 항상 채우면 월 집계가 어긋난다.

### A3. 선택 항목을 "고급" 섹션으로 분리
접을 후보: 거래처(`merchant`), 상세메모(`detailedNote`), 이체수수료 관련 필드(`transferFee`, `transferFeeMainCategoryId`, `transferFeeSubCategoryId` — 이체 유형에서만 표시됨). 최종 범위는 화면 설계 때 정한다.

---

## B. 모든 팝업 공통 (Modal.tsx)

닫기 아이콘은 `sticky top-0` 헤더에 있어 스크롤해도 보인다(`Modal.tsx:17-26`). 문제는 제출 버튼이다 — 스크롤 컨테이너는 바깥 `div`(`overflow-y-auto`)이고 sticky footer 슬롯이 없어, 폼이 길면 버튼이 화면 밖에 있다(예: `dashboard/page.tsx:1505-1511`).

`AddAccountModal`, `EditAccountModal`, `EditCardModal`, `PersonModal`, `BudgetDetailModal` 모두 이미 공통 `Modal.tsx`를 쓴다. 컴포넌트 교체는 필요 없다.

**할 일**: `Modal.tsx`에 `footer` 슬롯을 추가하고(`sticky bottom-0` + 배경색 + 상단 보더), 각 모달의 제출/삭제/닫기 버튼을 그 슬롯으로 옮긴다.
**결정**: footer는 `children` 안의 `<form>` 밖에 놓이므로, `<form id="...">` + `<button type="submit" form="...">`로 묶는다.

---

## C. 카테고리

### C1. 빈 소분류 행 제거
`categories/page.tsx`의 초기값(`28`), `handleModalClose`(`65`), 제출 후 리셋(`222`)이 모두 `subCategories: [{ id: '', name: '', defaultIsFixed: false }]`로 시작해 빈 입력행이 항상 하나 뜬다.

**할 일**: 위 세 곳을 빈 배열로 바꾼다. 상세/수정 진입 시 기존 소분류가 없을 때 빈 행을 채우는 `80-85`, `100-105`도 함께 빈 배열로 통일한다. 추가 버튼(`496`)이 있으므로 행이 0개여도 문제없다.

---

## D. 계좌

### D1. 잔액 기준일
개설 시에는 이미 지원한다(`AddAccountModal.tsx:157-170`, `accounts.service.ts:97-107`). 개설 이후 잔액 수정에는 기준일이 없다 — `accounts.service.ts:171-177`이 `date: new Date()`로 오늘을 고정한다.

**주의(검토에서 확인)**: `ledger.service.ts:394-414`의 `adjustBalanceTo`는 delta를 **현재 총잔액** 기준으로 계산한다(`402`줄). 과거 기준일을 그냥 허용하면, 기준일 이후 거래가 있는 계좌에서 "그 날짜의 잔액"이 사용자가 입력한 값과 달라진다.

**할 일**:
1. `ledger.service.ts`에 as-of 잔액 계산을 추가한다(해당 계좌 posting 중 `date <= 기준일` 합계).
2. `adjustBalanceTo`가 `delta = targetBalance - asOfBalance(date)`로 계산하게 바꾼다.
3. `AccountDto.UpdateRequest`에 `balanceDate`를 추가하고 `EditAccountModal`에 기준일 입력을 넣는다(기본값 오늘).

### D2. 계좌 상세 팝업 — 조회 먼저, 수정은 버튼으로 (버그)
실제 화면은 `assets/page.tsx`다. 이미 조회 전용 "계좌 상세정보" 모달이 있다(`537-608`, "수정하기" 버튼 `594`).
문제는 조회 모달과 `EditAccountModal`이 **같은 state**를 쓴다는 점이다:
- 조회 모달: `isEditAccountModalOpen && selectedAccount` (`537`)
- 수정 폼: `<EditAccountModal isOpen={isEditAccountModalOpen} .../>` (`916-927`)

"계좌 상세정보" 버튼(`389-394`)이 `setIsEditAccountModalOpen(true)` 하나로 두 모달을 동시에 연다. "수정하기를 누르지도 않았는데 수정 화면이 나온다"의 원인이다.

**카드도 같은 증상이다(검토에서 확인)**: 카드 상세 모달은 `detailType === 'card'`로 열리고(`655`) `EditCardModal`은 `isEditCardModalOpen`으로 열린다(`929-940`). `handleEditCardClick`(`306-308`)이 `detailType`을 끄지 않아 수정 모달 뒤에 상세 모달이 그대로 남는다.

**할 일**: state를 분리한다.
- 계좌: `isAccountDetailOpen` / `isAccountEditOpen`. 상세 버튼은 조회만 켜고, 조회 모달의 "수정하기"가 조회를 끄고 수정을 켠다.
- 카드: `handleEditCardClick`에서 `setDetailType(null)`을 함께 호출하거나 계좌와 같은 방식으로 분리한다.

### D3. 팝업 재오픈 시 데이터 초기화 안 되는 버그
`EditAccountModal.tsx:51-61`의 `useEffect(..., [account])`는 `account` 참조가 바뀔 때만 값을 채우는데, `handleClose`(`102-106`)는 폼을 `EMPTY_FORM`으로 리셋한다. 같은 계좌로 다시 열면 effect가 재실행되지 않아 빈 폼이 보인다.

**동일 버그가 `EditCardModal.tsx:46-61`에도 있다** (deps `[card]` + `handleClose`가 `EMPTY_FORM`).

**할 일**: 두 모달 모두 `useEffect` deps에 `isOpen`을 추가하고 `if (isOpen && account)` 조건으로 채운다. `handleClose`의 리셋은 남겨도 되고 지워도 된다.

---

## E. 카드

### E1. 신용카드 수정이 안 되는 문제
`EditCardModal.tsx`에 카드 유형(`163-176`), 카드 번호(`150-161`), 만료일(`191-201`) 입력이 있지만 실제로는 다음을 고쳐야 한다.

1. **저장 자체가 안 됨**: 제출 payload(`82-88`)에는 `name`, `issuerId`, `creditLimit`, `statementClosingDay`, `paymentDueDay`만 담긴다. `cardNumber`/`expiryDate`는 전송되지 않고, `isoDate`(`79`)는 계산만 하고 버려진다. 백엔드 `cards.service.ts:125-176`도 이 두 필드를 처리하지 않는다. 프론트와 백엔드를 모두 고쳐야 한다.
2. **카드번호는 마스킹만 내려온다(검토에서 확인)**: 서버 응답은 `cardNumberMasked`뿐이고(`cards.service.ts:211-224`), `EditCardModal.tsx:52`가 그 마스킹 문자열을 입력창에 채운다. payload에 `cardNumber`를 그대로 넣으면 `****-****-****-1234`가 저장된다. **규칙**: 입력창을 비워 두면 기존 값 유지, 전체 번호를 새로 입력하면 교체. placeholder에 현재 마스킹 값을 보여주고 `value`는 빈 문자열로 시작한다.
3. **라벨-필드 불일치**: `218-233`의 "결제일 (매월 몇 일?)" 라벨이 실제로는 `statementClosingDay`에 붙어 있고, `paymentDueDay` 입력 필드는 폼에 없다(값은 `card`에서 읽어 그대로 되돌려 보낸다). 라벨을 "마감일"로 바로잡고 `paymentDueDay` 입력을 새로 추가한다.
4. **그대로 유지**: `paymentAccountId`, `cardType`은 원장 정합성 때문에 의도적으로 잠긴 값이다(주석 `80-81`). 바꿀 수 있어 보이는 `cardType` 셀렉트(`163-176`)만 읽기 전용 표시로 바꾼다.

### E2. 마감일/결제일 31일에 "말일" 표기
1~31 드롭다운이 `EditCardModal.tsx:227-231`, `assets/page.tsx:1129,1148`, `dashboard/page.tsx:1698,1715`에 같은 패턴(`{day}일`)으로 중복되어 있다. (`assets/cards/page.tsx`는 J1에서 삭제하므로 대상이 아니다.)

**할 일**: 공통 옵션 목록(예: `lib/day-of-month.ts`)으로 뽑고 31일 라벨에 "(말일)"을 붙인다.
**주의**: `statement-period.ts:10-13`의 `clampDayOfMonth`는 29·30일도 2월에는 말일로 자른다. 31일만 표기하면 오해를 부르므로 셀렉트 아래에 "그 달에 없는 날짜는 말일로 처리합니다" 안내 한 줄을 함께 둔다.

---

## G. 가계(대시보드) 화면

### G2. 사람 필터 위치 이동 + 고정수입지출 필터
사람 필터 체크박스는 `DashboardSidebar.tsx:207-227`에 있고, 이 사이드바는 `dashboard`, `assets`, `categories`, `settings` 4개 레이아웃 공용이다.

**결정**: 자산/카테고리/설정 화면은 사람 필터 없이 항상 전체를 보여준다. 필터를 실제로 쓰는 곳은 `assets/page.tsx`(`154-155`, `319-320`)와 `dashboard/page.tsx`(`263-270`)뿐이다.

**현재 동작의 문제(검토에서 확인)**:
- `dashboard/page.tsx:263-270`은 `selectedPersonIds.includes(...)`로 목록만 거른다. 배열이 비면 아무 거래도 안 보인다(자산 화면은 `319`줄에서 "비면 전체"로 다르게 처리한다).
- summary·차트는 서버에서 사람 필터 없이 받아온다. 그래서 지금도 목록 합계와 상단 요약이 어긋난다.

**결정**: 사람 필터와 고정(`isFixed`) 필터를 **모두 서버 필터로** 올린다. 목록뿐 아니라 summary·차트·수단별 탭까지 같은 조건을 적용한다.

**기준 변경 (2026-08-21)**: 사람 필터의 기준을 "거래를 입력한 사람"(`JournalEntry.personId`)에서
**돈이 오간 계좌의 주인**으로 바꿨다. 화면 라벨도 "사용자" → "자산주인".
남의 통장으로 결제한 건이 입력자 쪽에 잡히면서, 소유자 기준으로 목록을 만드는
수단별 탭과 숫자가 어긋났기 때문이다. 규칙은 entry-view의 표시 규칙과 같다.
  - 돈이 나간 다리(음수)의 계좌 주인. 이체는 보내는 계좌.
  - 나간 다리가 없으면(수입, 잔액 증가 조정) 들어온 계좌 주인.
  - 자본 계정은 주인이 없어 "나간 다리" 판단에서 제외한다(기초잔액 전표가 사라지지 않게).
구현은 `common/entry-filter.ts`의 `assetOwnerCondition`(Prisma)과 `reports.service.ts`의
`personFilter`(같은 규칙의 SQL) 두 곳이다.

**체크박스 의미 (2026-08-21)**: "전체" 버튼을 없애고 체크박스만으로 표현한다.
전부 체크 = 전체(파라미터 미전송), 일부 체크 = 그 사람들만, 0개 체크 = 결과 없음(빈 값 전송).
고정/변동도 같다. 단 수단별 탭은 고정/변동 0개일 때도 어떤 수단이 있는지는 보여줘야 하므로
금액만 0으로 두고 목록은 유지한다.

**할 일**:
- 사람 필터 UI를 `DashboardSidebar.tsx`에서 떼어 가계 화면 안으로 옮긴다. 고정 필터 UI(전체/고정/변동)도 같은 자리에 만든다. 고정은 수입·지출 공통 개념으로 다룬다.
- `assets/page.tsx`의 `selectedPersonIds` 기반 필터링(`154-155`, `319-320`)을 제거해 항상 전체를 보여준다.
- 서버 쿼리 파라미터를 확장한다.
  - `EntryDto.ListQuery`(`types/src/dtos.ts:236-`)에 `isFixed?: boolean`, `personIds?: string[]` 추가. `entries.service.ts:144`의 단일 `personId`를 `in` 조건으로 확장하고, `isFixed`는 `postingFilters`(`152-190`)에 `{ isFixed: true }`로 추가한다.
  - `ReportDto.MonthQuery`/`TrendQuery`에 같은 두 필드를 추가하고 `reports.service.ts:519-529`의 `entryScope`, posting `groupBy` where(`37-45`, `82-84`)에 반영한다. 대상 엔드포인트는 `/reports/summary`, `/reports/category-breakdown`, `/reports/trend`, `/reports/payment-methods`다. `/reports/net-worth`는 자산 화면 전용이라 손대지 않는다.
- **재요청 범위는 활성 탭으로 제한한다(이미 그런 구조다).** 대시보드는 월 단위로 `entries` + `summary`만 받고(`dashboard/page.tsx:213-231`), 수단별 탭은 `PaymentMethodTab` 안에서 마운트될 때 `payment-methods`를 직접 받는다(`PaymentMethodTab.tsx:76-93`). 탭은 조건부 렌더링이라 안 보는 탭은 요청하지 않는다(`dashboard/page.tsx:1118-1126`). 필터를 바꿀 때 탭별 요청 수는 캘린더 탭 2건, 수단별 탭 1건(수단을 고른 상태면 +2건)이다.
- 프론트에서는 체크박스 변경을 200~300ms 디바운스하고, 진행 중 요청은 `AbortController`로 취소한다(`PaymentMethodTab.tsx`는 이미 `cancelled` 플래그로 같은 일을 한다). 전체 선택 상태면 파라미터를 아예 보내지 않는다(서버가 필터 없는 기본 경로를 타게).

### G3. 수단별 탭 — 이번 달 미사용 계좌/카드도 노출 + 0 그래프
`reports.service.ts:424-503`의 `getPaymentMethods`는 엔트리를 순회하며 버킷을 만들기 때문에 거래가 없는 수단은 항목 자체가 생기지 않는다. 프론트(`PaymentMethodTab.tsx`)는 받은 목록만 렌더링한다. 차트는 이미 전부 0인 경우를 대비해 뒀다(`PaymentMethodTab.tsx:53-57`).

**할 일**: 서버에서 프로젝트의 전체 계좌·카드로 버킷을 미리 만들고 거래가 없으면 금액 0으로 내려준다.
**선행 버그(검토에서 확인)**: `dashboard/page.tsx:1116-1119`가 `entries.length === 0`이면 "거래가 없습니다"를 먼저 반환해 수단별 탭 자체가 마운트되지 않는다. 그 달 거래가 하나도 없으면 0 그래프도 볼 수 없으므로, 이 조기 반환을 캘린더 탭에만 적용하도록 고쳐야 한다. (같은 조건이 `visibleEntries`가 아니라 필터 전 `entries`를 보는 점도 함께 정리한다.)

**주의(검토에서 확인)**: `436-442`의 조회에는 `isActive`와 `HIDDEN_ACCOUNT_TYPES` 필터가 없다. 지금은 거래가 있는 것만 버킷이 되어 드러나지 않지만, 0원 항목을 채우면 카드 부채 계정과 자본 계정(`opening_balance`)까지 화면에 뜬다. 계좌는 `isActive: true` + `type: { notIn: HIDDEN_ACCOUNT_TYPES }`, 카드는 `isActive: true`로 걸러야 한다. G2의 사람 필터가 적용된 경우 소유자 기준으로도 걸러야 한다.

---

## H. 정렬 / "나" 지정

### H1. "구성원 중 나" 지정
`Person`(`schema.prisma:188-203`)에 `User` 참조가 없고 역방향도 없다.

**결정**: `Person.userId`가 아니라 **`ProjectMember.personId`**로 간다(`schema.prisma:126-140`). 같은 프로젝트에 여러 사용자가 있어도 각자 다른 Person을 "나"로 지정할 수 있다. 마이그레이션 + 지정 UI(설정 화면) + 기본 필터/정렬에서 "나" 우선 노출이 필요하다.

### H2. 카테고리/구성원/계좌 순서 변경 (드래그앤드랍)
`Category`, `Person`, `Account` 세 모델 모두 정렬 필드가 없다(`FinancialInstitution`만 `sortOrder` 보유, `schema.prisma:219`). 세 모델 전부 컬럼 추가 마이그레이션 + 목록 API `orderBy` 변경(`accounts.service.ts:125`는 현재 `createdAt: desc`) + 드래그앤드랍 UI가 필요하다.

**Card 추가 (2026-08-21)**: 카드도 같은 방식으로 정렬한다. `Card.sortOrder` 컬럼과
`PATCH /cards/reorder`를 추가하고, 자산 화면에서 계좌 아래 카드 목록을 드래그로 옮긴다.
카드 sortOrder도 프로젝트 단위지만 화면은 계좌별로 묶여 있어 묶음 안에서만 다시 매긴다.

---

## I. 타임존 통일 (신규, A2의 선행 조건)

### I1. 시간 입력이 월/청구주기 집계를 어긋나게 한다
- 프론트는 `new Date(\`${date}T${time}\`)`로 **로컬시각을 UTC 인스턴트로** 바꿔 보낸다(`dashboard/page.tsx:283-291`). 시간을 비우면 `new Date(date)`로 UTC 자정이 된다.
- 서버 경계 계산은 전부 UTC다: `monthRange`(`reports.service.ts:576-582`), `currentYearMonth`(`584-587`), 트렌드 구간(`330,346,555-568`), 예산 기간(`budgets.service.ts:222-223`), 청구주기(`statement-period.ts` 전체), 명세서 기준일(`statements.service.ts:171`).
- 결과: KST 00:00~09:00에 시간까지 입력한 거래는 전월(또는 이전 청구주기)로 집계된다.
- 또 `extractTime`(`dashboard/page.tsx:456-461`)은 "자정이면 시간을 비운 것"으로 판단하지만, UTC 자정 저장분은 KST에서 09:00으로 읽힌다. 그래서 시간을 입력하지 않은 거래를 수정하려 열면 항상 09:00이 채워지고, 상세보기도 "오전 9:00"으로 표시된다(`1996-2003`).

**결정**: 저장·전송은 ISO 8601 UTC 인스턴트로 통일하고, 애플리케이션 기준 타임존은 **Asia/Seoul**로 고정한다. 표시는 클라이언트 로컬 변환을 쓴다. 한국은 현재 서머타임이 없어 고정 +09:00 오프셋으로 처리해도 안전하다.

**할 일**:
1. 공용 헬퍼를 하나 만든다(예: `packages/api/src/common/tz.ts`, `packages/web/src/lib/tz.ts`). 서울 기준 "그 달의 시작/끝", "그 날의 시작/끝"을 UTC 인스턴트로 돌려주는 함수를 둔다(월 시작은 전월 말일 15:00Z).
2. 위에 열거한 서버 경계 계산 전부를 그 헬퍼로 바꾼다.
3. 프론트는 날짜만 입력한 경우에도 서울 기준 그 날 00:00을 UTC로 변환해 보낸다. `extractTime`의 "자정" 판정도 서울 기준으로 바꾼다.
4. 계좌 개설/잔액 기준일(`accounts.service.ts:105`, D1)도 같은 헬퍼로 서울 기준 그 날 시작으로 해석한다.
5. `PaymentMethodTab.tsx:108-109`의 월 범위도 같이 고친다. `Date.UTC(year, month, 0)`은 말일 00:00Z이고 서버 `endDate`는 `lte`(`entries.service.ts:149`)라, 시간이 붙은 말일 거래가 목록에서 빠진다.
6. 기존 데이터: 시간을 입력한 거래는 이미 로컬→UTC로 저장돼 있어 재해석이 맞고, 날짜만 입력한 거래는 UTC 자정으로 저장돼 있어 서울 기준으로는 09:00이 된다. 같은 날짜에 머무르므로 월 집계는 바뀌지 않는다. 정리하려면 `date`가 정확히 00:00Z인 엔트리를 전월 15:00Z로 옮기는 일회성 스크립트를 쓴다(선택).

### I2. 기준 타임존을 DB에 저장한다
현재 타임존 설정은 어디에도 없다. `Project`는 `baseCurrency`만 갖고(`schema.prisma:141-146`), `User`에도 관련 필드가 없다. DB 세션 타임존은 UTC로 확인했다(`show timezone` → UTC, 컬럼은 전부 `TIMESTAMP(3)` = timestamp without time zone이며 Prisma가 UTC 인스턴트로 읽고 쓴다).

**결정**: 타임존은 **프로젝트 단위**로 저장한다 — `Project.timezone String @default("Asia/Seoul")`.
이유: 월 합계·청구주기 경계는 프로젝트 구성원 모두가 같은 값을 봐야 한다. 사용자별 타임존으로 경계를 계산하면 같은 가계부를 열어도 사람마다 8월 지출이 달라진다.

**할 일**:
1. 마이그레이션으로 `Project.timezone` 추가, 프로젝트 설정 화면에 선택 UI(기본값 Asia/Seoul).
2. I1의 경계 헬퍼가 하드코딩 대신 이 값을 받게 한다.
3. `docker-compose.yml`의 postgres 서비스에 `TZ: UTC`를 명시해 둔다. 지금은 이미지 기본값이라 UTC지만, 명시하지 않으면 `createdAt`의 `CURRENT_TIMESTAMP` 기본값이 환경에 따라 흔들린다.
4. 표시 전용 사용자 타임존(`User.timezone`)은 이번 범위에서 제외한다. 필요해지면 "표시만 로컬, 집계는 프로젝트 기준"으로 분리해 추가한다.

---

## J. 죽은 코드 삭제 (신규)

### J1. 도달 불가 페이지 4개
`/assets`로 가는 링크는 `DashboardSidebar.tsx:24` 하나뿐이고, 하위 경로로 이동하는 코드는 어디에도 없다. 따라서 다음 네 파일은 도달 불가다.
- `packages/web/src/app/assets/accounts/page.tsx`
- `packages/web/src/app/assets/cards/page.tsx`
- `packages/web/src/app/assets/people/page.tsx`
- `packages/web/src/app/assets/budgets/page.tsx`

**결정**: 전부 삭제한다.

### J2. 중복 컴포넌트
`packages/web/src/components/EditPersonModal.tsx`는 `PersonModal.tsx`와 바이트 단위로 동일하고 참조하는 곳이 없다. **삭제한다.**

---

## K. 작업 순서 제안

1. **J** (죽은 코드 삭제) — 이후 작업의 검색 범위를 줄인다.
2. **I1·I2** (타임존 + `Project.timezone`) — A2와 모든 집계의 전제.
3. **D2·D3 + E1** (모달 버그와 카드 수정) — 서로 같은 파일을 건드린다.
4. **B** (sticky footer) — 이후 모든 폼 수정에 영향.
5. **A1·A2·A3** (거래 추가 팝업 개편).
6. **C1**, **E2** (작은 항목).
7. **G2·G3** (서버 필터 확장 + 수단별 탭).
8. **D1** (as-of 잔액 조정).
9. **H1·H2** (마이그레이션 필요 항목).

---

## L. 고정 여부를 거래 입력에서 정한다 (2026-08-21 추가, 완료)

카테고리 화면에서 고정 체크박스를 없애고, 거래를 저장할 때 그 거래가 쓴 카테고리에
고정 여부를 기록하는 방식으로 바꿨다.

- **카테고리 폼**: 대분류 "기본 고정 지출/수입"과 소분류별 체크박스를 제거했다
  (`categories/page.tsx`). 목록·상세의 "고정" 표시는 읽기 전용으로 남겼고, 기존 값은
  폼이 그대로 되돌려 보내므로 보존된다.
- **서버 write-back**: `entries.service.syncCategoryDefaults`가 생성·수정 후
  `Category.defaultIsFixed`를 갱신한다. 대상은 요청에 `isFixed`가 명시적으로 담긴
  카테고리 다리뿐이다(값을 안 보낸 클라이언트가 기존 설정을 덮어쓰면 안 된다).
  소분류를 골랐으면 소분류가, 대분류만 골랐으면 대분류가 대상이다.
- **이체**: 카테고리 다리가 수수료뿐이므로 화면의 체크는 수수료 분류에 붙는다.
  `TransferInput.feeIsFixed`를 추가하고, 수수료 다리도 `resolveLines`를 거치게 해
  기본값 상속과 검증(프로젝트·지출 유형)을 함께 받는다.
- **응답 보정**: `entry-view`의 `isFixed`가 이체에서는 항상 false였다. 수정 폼이 그
  값을 되돌려 보내기 때문에 체크가 저장 즉시 풀리는 문제가 있어 수수료 다리를 읽게 고쳤다.
- **거래 폼**: 체크박스를 팝업 맨 아래에서 소분류(이체는 수수료 소분류) 바로 아래로
  옮기고, 라벨을 유형에 따라 "고정수입"/"고정지출"로 바꿨다. 소분류를 "없음"으로
  되돌리면 대분류 기본값으로 돌아간다.
- **A3 철회**: "선택 항목 더 보기" 접기를 없애고 거래처·상세설명·이체수수료를 항상 보여준다.
- **클라이언트 검증**: 수수료를 넣고 수수료 대분류를 비우면 서버 오류 대신 폼에서
  "수수료 대분류를 선택해주세요."로 막는다.

검증: `scripts/category-fixed-smoke.ts` 추가. 기본값 write-back, 다음 거래의 상속,
수정 시 갱신, 이체 수수료 경로, 다른 프로젝트 카테고리 거부를 확인한다.
