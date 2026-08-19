# 스키마 재설계 제안 (복식부기 기반)

이 문서는 기존 `schema.prisma`를 어떻게 고칠지가 아니라, **처음부터 다시 만든다면** 어떤 구조가 좋은지를 논의한 결과다. 코드는 아직 바꾸지 않았다. 이 문서를 다시 가져와서 요청하면 여기서부터 이어서 설계/구현을 진행한다.

**기존 데이터는 보존하지 않는다.** 사용자가 명시적으로 기존 데이터를 전부 삭제하고 새 스키마로 시작해도 된다고 확인했다. 따라서 이관 스크립트나 백필 로직은 필요 없고, `prisma migrate reset` 수준으로 스키마를 새로 적용하면 된다.

## 1. 왜 다시 설계하는가 (기존 스키마의 문제 요약)

- 모든 금액이 `Float`. 반올림 오차 누적, 나눗셈 시 합계 불일치.
- 잔액 갱신이 `$transaction` 없이 개별 쿼리로 이루어짐. 중간 실패 시 잔액 드리프트.
- 신용카드 거래 1건이 `Transaction` + `CardUsage` + `CardPayment` + `CardPaymentUsage` 4개 행을 만듦. 카드를 "결제 수단"으로 보고 그 부수효과를 테이블로 나눈 결과, 같은 사실이 중복 기록되고 정합성 책임이 전부 애플리케이션 코드에 있음.
- `credit_usage`를 지출 합계에 포함할지가 화면마다 다름 (dashboard는 포함, statistics는 제외, budgets 서버 계산은 포함). 근본 원인은 `TransactionType` enum이 "회계적 성격"과 "결제 수단"을 한 필드에 섞어놓은 것.
- `CardUsage`를 `(cardId, date, amount)`로 찾아 수정/삭제. 같은 날 같은 금액 거래가 2건이면 엉뚱한 행을 건드림.
- `relatedTransactionId`가 이체와 수수료 거래를 서로 가리키는 자기참조 순환 구조.
- 잔액이 유일한 진실이라 드리프트를 검증할 방법이 없음.
- `Account`에 자산 유형이 없어 예금/투자/대출/부동산을 구분 못함. 다통화 필드도 `Account.currency` 하나뿐, `Transaction`에는 없음.
- 인덱스: 유니크 제약과 중복되는 단일 인덱스 7개, 저카디널리티 컬럼(`isFixed`, `isDefault`, `type`, `status`) 단독 인덱스 5개, 반면 실제 조회 패턴인 `(projectId, userId, date)` 복합 인덱스는 없음.
- 서버 쿼리 패턴: N+1 쿼리 다수(`card-payments.service.ts` pending 처리 등), `take`/`skip` 없는 전량 조회, 가짜 페이지네이션.

## 2. 핵심 설계 원칙

1. **신용카드는 결제 수단이 아니라 부채 계정이다.** 사용 시점에 전액을 부채로 인식하고, 결제는 그 부채를 갚는 별개 사건이다.
2. **잔액은 postings의 합으로 검증 가능해야 한다.** 컬럼에 저장하되(성능), 그 근거가 되는 원장 행이 별도로 존재해 드리프트를 쿼리로 잡아낼 수 있어야 한다.
3. **통장(Account)과 카테고리(Category)는 물리적으로 분리하되, 둘 다 posting의 대상이 될 수 있다.** 계좌는 잔액·소유자·은행명을 갖고 카테고리는 대분류/소분류 계층을 갖는다. 구조가 다르므로 한 테이블에 합치지 않는다. 대신 `Posting`이 `accountId` 아니면 `categoryId` 중 정확히 하나를 가리키는 배타 구조로 개념을 통일한다.
4. **지출/수입의 정의를 결제수단과 분리한다.** "지출 = 지출 카테고리로 들어간 posting의 합"으로 고정하면, 카드로 샀는지 계좌에서 나갔는지와 무관하게 통계가 일관된다.
5. **평가손익(환율, 시가)은 전표화하지 않는다.** 거래 없이 가치만 변하는 사건은 posting을 만들지 않고, 화면에서 최신 시가/환율로 환산해 보여준다.

## 3. 부호 규칙

모든 `Posting.amount`는 아래 규칙을 따르면 하나의 `JournalEntry` 안에서 항상 합이 0이 된다. (plain-text 회계 도구인 hledger/Beancount류의 검증된 관례를 따른다.)

| 계좌/카테고리 유형 | 정상 부호 |
|---|---|
| 자산 (deposit, savings, cash, investment, real_estate) | 증가 = +, 감소 = - |
| 부채 (credit_card, loan) | 빚 증가 = -, 상환 = + |
| 지출 카테고리 | 지출 발생 = + |
| 수입 카테고리 | 수입 발생 = - |

## 4. 전체 스키마

```prisma
// ── 그대로 유지 (이번 논의에서 손대지 않음) ──
// User, Project, ProjectMember, ProjectInvitation, ProjectJoinRequest, Person
// Budget, BudgetOverride — 예산은 회계 개념이 아니라 계획 개념이라 별도 테이블 유지

model Project {
  // 기존 필드 + 추가
  baseCurrency String @default("KRW") // 리포트 기준통화
}

// ── 계좌 ──
enum AccountType { deposit, savings, investment, cash, credit_card, loan, real_estate }

model Account {
  id        String      @id @default(cuid())
  projectId String
  ownerId   String      // Person
  type      AccountType
  name      String
  bankName  String?
  currency  String      @default("KRW")
  balance   Decimal     @db.Decimal(19,4) @default(0) // 캐시. Posting 합으로 검증 가능
  isActive  Boolean     @default(true)

  investmentDetail InvestmentDetail?
  valuations       AssetValuation[]
  postings         Posting[]
  cards            Card[]

  @@index([projectId, ownerId, isActive])
}

// 투자성 계좌(investment, real_estate)에만 존재하는 위성 테이블
model InvestmentDetail {
  accountId  String  @id
  assetClass String  // stock, fund, real_estate, gold
  ticker     String? // 주식 종목코드. 부동산은 null
  quantity   Decimal @db.Decimal(19,8) @default(0) // 캐시. Posting.quantity 합으로 검증 가능

  account Account @relation(fields: [accountId], references: [id])
}

// 시가/감정가 스냅샷. Posting과 무관 (거래가 아니라 외부 평가값)
model AssetValuation {
  id          String   @id @default(cuid())
  accountId   String
  date        DateTime @db.Date
  quantity    Decimal  @db.Decimal(19,8)
  price       Decimal  @db.Decimal(19,4)
  marketValue Decimal  @db.Decimal(19,4)
  source      String   @default("manual")

  account Account @relation(fields: [accountId], references: [id])

  @@unique([accountId, date])
}

// ── 카테고리 (기존 구조 유지, level 필드만 제거 권장) ──
model Category {
  id             String   @id @default(cuid())
  projectId      String
  userId         String
  name           String
  parentId       String?  // level은 parentId 체인에서 유도 가능하므로 저장하지 않는다
  type           String   // income, expense
  icon           String?
  defaultIsFixed Boolean  @default(false)
  isDefault      Boolean  @default(false)

  parent   Category?  @relation("CategoryHierarchy", fields: [parentId], references: [id])
  children Category[] @relation("CategoryHierarchy")
  postings Posting[]

  @@unique([projectId, userId, name, parentId])
}

// ── 카드 ──
enum CardType { debit, credit }

model Card {
  id                  String   @id @default(cuid())
  projectId           String
  accountId           String   // credit: 카드 자체 부채 Account, debit: 연결된 예금 Account
  cardType            CardType
  issuer              String
  cardNumber          String?
  statementClosingDay Int?     // credit만 사용
  paymentDueDay       Int?     // credit만 사용
  isActive            Boolean  @default(true)

  account    Account         @relation(fields: [accountId], references: [id])
  statements CardStatement[]
  postings   Posting[]       // 표시/분석용. 잔액에는 영향 없음 (accountId가 이미 처리)
}

model CardStatement {
  id          String   @id @default(cuid())
  cardId      String
  periodStart DateTime @db.Date
  periodEnd   DateTime @db.Date // 마감일
  dueDate     DateTime @db.Date // 결제일
  status      String   @default("open") // open, closed, paid, partial

  card     Card                @relation(fields: [cardId], references: [id])
  postings Posting[]
  charges  InstallmentCharge[]

  @@unique([cardId, periodEnd])
  @@index([cardId, dueDate])
  @@index([cardId, status])
}

// ── 할부 ──
model InstallmentPlan {
  id          String   @id @default(cuid())
  postingId   String   @unique // 원 구매의 카드측 posting
  totalMonths Int
  feeAmount   Decimal? @db.Decimal(19,4) // 일반할부 수수료 총액. 무이자면 null

  posting Posting             @relation(fields: [postingId], references: [id])
  charges InstallmentCharge[]
}

model InstallmentCharge {
  id          String   @id @default(cuid())
  planId      String
  sequence    Int      // 1회차~N회차
  amount      Decimal  @db.Decimal(19,4)
  statementId String?  // 귀속 청구서. 마감 전이면 null

  plan      InstallmentPlan @relation(fields: [planId], references: [id])
  statement CardStatement?  @relation(fields: [statementId], references: [id])

  @@unique([planId, sequence])
  @@index([statementId])
}

// ── 원장 ──
model JournalEntry {
  id          String   @id @default(cuid())
  projectId   String
  date        DateTime
  description String
  personId    String

  postings Posting[]

  @@index([projectId, date])
}

model Posting {
  id          String   @id @default(cuid())
  entryId     String
  accountId   String?  // accountId, categoryId 중 정확히 하나만 채운다 (앱 레이어 강제 + 가능하면 DB CHECK)
  categoryId  String?
  amount      Decimal  @db.Decimal(19,4)
  quantity    Decimal? @db.Decimal(19,8) // 투자 계좌 posting에서만 사용 (매수/매도 수량)
  currency    String
  baseAmount  Decimal  @db.Decimal(19,4)
  exchangeRate Decimal @db.Decimal(19,8) @default(1)
  statementId String?  // 신용카드 posting만 사용
  cardId      String?  // 표시/분석용. 체크카드 사용 시에도 채운다

  entry            JournalEntry     @relation(fields: [entryId], references: [id], onDelete: Cascade)
  account          Account?         @relation(fields: [accountId], references: [id])
  category         Category?        @relation(fields: [categoryId], references: [id])
  statement        CardStatement?   @relation(fields: [statementId], references: [id])
  card             Card?            @relation(fields: [cardId], references: [id])
  installmentPlan  InstallmentPlan?

  @@index([accountId, entryId])
  @@index([categoryId])
  @@index([statementId])
}

// ── 환율 ──
model ExchangeRate {
  id            String   @id @default(cuid())
  baseCurrency  String
  quoteCurrency String
  rate          Decimal  @db.Decimal(19,8)
  date          DateTime @db.Date
  source        String   @default("manual")

  @@unique([baseCurrency, quoteCurrency, date])
}
```

## 5. 시나리오별 예시

**체크카드 커피 5,000원**
```
JournalEntry(8/3, "스타벅스")
  Posting(category=식비,   +5000)
  Posting(account=보통예금, -5000, cardId=체크카드)
```

**신용카드 커피 5,000원**
```
JournalEntry(8/3, "스타벅스")
  Posting(category=식비,   +5000)
  Posting(account=신한카드, -5000, cardId=신한카드, statementId=8월청구서)
```

**할부 3개월 30만원**
```
JournalEntry(8/3, "가전제품 3개월 할부")
  Posting(category=가전,   +300000)
  Posting(account=신한카드, -300000, cardId=신한카드)  ← 이 posting에 InstallmentPlan(totalMonths=3) 연결
    InstallmentCharge(seq=1, amount=100000, statementId=8월청구서)
    InstallmentCharge(seq=2, amount=100000, statementId=9월청구서)
    InstallmentCharge(seq=3, amount=100000, statementId=10월청구서)
```
원금 30만원은 구매 즉시 전액 부채로 잡힌다. `InstallmentCharge`는 "언제 청구되는지"의 일정표일 뿐, 새 posting을 만들지 않는다.

**카드대금 결제 (이번 달 결제 예정액만큼)**
```
JournalEntry(9/25, "신한카드 결제")
  Posting(account=보통예금, -150000)
  Posting(account=신한카드, +150000, statementId=8월청구서)
```

**이체 + 수수료 (3-leg, 한 사건)**
```
JournalEntry(8/5, "이체")
  Posting(account=계좌A,  -100500)
  Posting(account=계좌B,  +100000)
  Posting(category=수수료, +500)
```

**한 결제를 카테고리 분할**
```
JournalEntry(8/10, "이마트")
  Posting(account=보통예금, -40000)
  Posting(category=식비,    +30000)
  Posting(category=생활용품, +10000)
```

**주식 매수/매도**
```
JournalEntry(8/1, "삼성전자 10주 매수")
  Posting(account=보통예금,    -700000)
  Posting(account=삼성전자보유, +700000, quantity=+10)

JournalEntry(9/1, "삼성전자 5주 매도")
  Posting(account=보통예금,    +440000)
  Posting(account=삼성전자보유, -350000, quantity=-5)  // 원가 회수분
  Posting(category=투자수익,   -90000)                // 실현손익
```
실현손익이 급여·이자와 같은 수입 카테고리 메커니즘을 타므로 통계 화면에서 특별 취급이 필요 없다.

## 6. 정합성 검증

```sql
-- 전표 단위: 합이 0이 아니면 버그
SELECT entryId FROM Posting GROUP BY entryId HAVING SUM(amount) <> 0;

-- 계좌 단위: 캐시된 balance와 실제 postings 합이 다르면 드리프트
SELECT accountId, SUM(amount) AS computed, a.balance AS cached
FROM Posting p JOIN Account a ON a.id = p.accountId
GROUP BY accountId, a.balance
HAVING SUM(amount) <> a.balance;
```

## 7. 순자산/지출 계산 공식

```
현금성 계좌(deposit, savings, cash, credit_card, loan): balance 그대로 사용
투자성 계좌(investment, real_estate): 최신 AssetValuation.marketValue 사용

순자산 = SUM(현금성 계좌.balance) + SUM(투자성 계좌 최신 marketValue)
미실현손익 = SUM(투자성 계좌 최신 marketValue) - SUM(투자성 계좌.balance)
월 지출 = SUM(Posting.amount WHERE categoryId IN 지출카테고리 AND date 범위)
월 수입 = SUM(Posting.amount WHERE categoryId IN 수입카테고리 AND date 범위) 의 절댓값
```
"지출"의 정의가 결제수단과 무관해지므로, 지금처럼 화면마다 `credit_usage` 포함 여부가 갈리는 문제가 정의상 사라진다.

## 8. 알려진 한계 / 향후 확장이 필요한 부분

정직하게 남겨두는 미해결 사항이다.

- **환율 평가손익, 시가 평가손익은 전표화하지 않는다.** 거래 없이 가치만 변하는 경우이므로 화면 계산으로 남긴다.
- **리볼빙(카드값 일부만 결제)**: 미납 잔액 이월 자체는 추가 설계 없이 된다. 결제 `Posting`을 여러 `statementId`에 나눠 태그하면 되고, 각 청구서의 미결제액은 `SUM(Posting.amount WHERE statementId = X)`로 구해진다.
  - **이자 자동 계산은 만들지 않기로 결정.** 이 프로젝트는 은행/카드사 API(마이데이터, 오픈뱅킹) 연동이 없는 수기 입력 앱이다 (코드에서 확인, `packages/web`/`packages/api` 전체에 해당 연동 없음). 이자율, 계산 방식(단리/일할), 최소결제 규칙은 카드사마다 다르고 실제 청구 데이터 없이는 정확히 재현할 수 없다.
  - 실제 업계에서도 수기 입력형 가계부는 대부분 이 계산을 하지 않는다. 마이데이터 연동형 앱(뱅크샐러드, 토스 등)은 카드사가 이미 계산한 값을 API로 받아 표시할 뿐, 앱이 직접 계산하지 않는다.
  - 따라서 사용자가 실제 카드 명세서를 보고 이자를 **일반 지출 거래로 직접 입력**하도록 한다. `Posting(category=카드이자, account=해당카드)` 형태의 평범한 2-leg 거래이며, 지금 설계된 구조로 이미 충분하다.
  - `Card.revolvingInterestRate`, 배치 작업, `JournalEntry.source` 플래그는 필요 없다. 이 항목들은 설계에서 제외한다.
- **주식 매도 손익은 평균 매입원가 방식으로 단순화했다.** 세무 신고용 정밀도(선입선출/로트별 회계)가 필요하면 `Lot` 테이블을 별도로 추가해야 한다. 지금 요구사항에는 과한 설계라 보류했다.
- **목록 조회 조립 비용이 있다.** "커피 5,000원 식비 신한카드" 한 줄을 보여주려면 `JournalEntry` + `Posting` 2~3행을 조인해 어느 쪽이 계좌고 어느 쪽이 카테고리인지 판별해야 한다. 서비스 레이어에 `createExpense`, `createIncome`, `createTransfer`, `createCardCharge` 같은 조립 헬퍼를 두어 90% 이상의 코드가 `Posting`을 직접 다루지 않게 해야 한다.
- **개발 인지 부하가 실재한다.** 기능 하나를 추가할 때마다 "이건 몇 개의 posting인가"를 먼저 정해야 한다.
- **`accountId`/`categoryId` 배타 조건은 DB가 강제하지 못한다.** 애플리케이션에서 강제하고, 가능하면 raw SQL로 `CHECK ((accountId IS NULL) != (categoryId IS NULL))`을 추가한다.

## 9. API 설계 (현재 웹 기능 대비)

`packages/web`의 기존 화면을 조사한 결과, 대부분 화면이 거래 전량을 받아 브라우저에서 합산하고 있었다 (근거: dashboard `page.tsx:287-300`, statistics `page.tsx:93-111`, assets `page.tsx:495,628`, BudgetDetailModal/PaymentMethodTab의 12개월 시계열 각자 구현). 또한 서버 쿼리 자체에 N+1, 무제한 조회, 가짜 페이지네이션이 다수 있었다 (근거: `transactions.service.ts:344-365`, `card-payments.service.ts:282-316`, `categories.service.ts:196-208`, `users.service.ts:97-142`).

### 스키마와 무관하게 고쳐야 하는 것 (지금 당장도 문제)

- `GET /transactions`(신 `/entries`)의 페이지네이션을 커서 기반으로 실제 구현한다. `(projectId, date, id)` 복합 인덱스로 뒷받침한다.
- 카테고리 소분류 수정을 배열 upsert로 바꾼다: `PATCH /categories/{parentId}/children`. 지금은 순차 요청(5개면 8회 이상).
- `GET /projects?include=counts`로 멤버/초대/가입요청 카운트를 한 응답에 포함한다. 지금은 프로젝트당 3회씩, 총 1+3N.
- `POST /entries/bulk`로 엑셀 임포트를 배치 삽입으로 바꾼다. 지금은 행마다 순차 생성.
- 카드 결제 pending 처리의 N×7 쿼리 루프를 `updateMany`/배치로 정리한다.

### 새 스키마(Posting)가 가능하게 하는 집계 API

`Posting` 구조에서는 이 합산들이 인덱스를 탄 `groupBy` 한 번으로 끝나므로, 클라이언트 계산 대신 서버 엔드포인트로 옮긴다.

| 신규 엔드포인트 | 대체하는 것 |
|---|---|
| `GET /reports/summary?projectId&yearMonth` | dashboard 월 수입/지출 합계, statistics 헤더 합계 |
| `GET /reports/category-breakdown?projectId&yearMonth&type` | statistics 페이지 카테고리별 구성비 |
| `GET /reports/net-worth?projectId` | assets 총자산·사람별 소계 (7절 공식: 현금성 balance + 투자성 최신 marketValue) |
| `GET /reports/trend?projectId&target=account\|category&targetId&months` | BudgetDetailModal, PaymentMethodTab의 12개월 시계열 (중복 구현되어 있던 것을 통합) |
| `GET /accounts/{id}/postings` | 계좌 원장 조회. `accountId OR toAccountId` 조합 필터 대신 단순 조회 |
| `GET /cards/{id}/statements?status=` | `/card-payments/pending` 대체. 미결제액이 `SUM(Posting.amount WHERE statementId=X)`로 응답에 계산되어 나옴 |

핵심 효과: "지출"의 정의가 서버에서 "지출 카테고리 posting의 합"으로 고정되므로, `credit_usage` 포함 여부로 statistics와 dashboard의 지출 합계가 어긋나던 문제가 재발할 수 없다.

### 없애도 되는 엔드포인트

`GET /card-payments/pending`, `budgets.service.ts`가 지출/수입을 나눠 호출하던 4개의 `groupBy`.

## 10. 이 문서를 다시 가져올 때 할 일

1. 이 파일을 다시 읽고, 그 사이 `schema.prisma`가 바뀌었는지 대조한다.
2. 8절의 미해결 항목 중 지금 필요한 것이 있는지 확인한다 (특히 리볼빙, 로트 회계 여부).
3. 기존 데이터는 삭제 대상이므로, 4절의 스키마를 `schema.prisma`에 그대로 반영하고 `prisma migrate reset`(또는 새 초기 마이그레이션)으로 적용한다.
4. 서비스 레이어 조립 헬퍼(`createExpense`, `createIncome`, `createTransfer`, `createCardCharge`) 설계부터 시작한다.
5. `packages/types`의 DTO/엔티티 타입을 새 스키마에 맞춰 다시 정의하고, 프론트엔드(`packages/web`)의 API 연동 지점을 함께 확인한다.