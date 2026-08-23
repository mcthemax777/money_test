-- 복식부기 원장 스키마 초기 생성.
--
-- 여러 개로 나뉘어 있던 마이그레이션을 하나로 합친 것이다.
-- 이전 마이그레이션들에는 bankName/issuer 문자열을 기관 참조로 옮기는 백필이 들어 있었는데,
-- 빈 데이터베이스에서는 옮길 것이 없으므로 뺐다.

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('deposit', 'savings', 'investment', 'cash', 'credit_card', 'loan', 'real_estate', 'opening_balance');

-- CreateEnum
CREATE TYPE "FinancialInstitutionType" AS ENUM ('bank', 'card_issuer');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('owner', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('pending', 'accepted', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "JoinRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "googleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatar" TEXT,
    "defaultProjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    -- 통화가 둘이다. ledgerCurrency 는 Posting.baseAmount 가 담긴 통화로 만든 뒤
    -- 바뀌지 않고, displayCurrency 는 리포트를 어느 통화로 볼지라 언제든 바뀐다.
    -- 표시 환산은 읽을 때 합계에 한 번 곱하므로 저장값은 영향을 받지 않는다.
    "ledgerCurrency" TEXT NOT NULL DEFAULT 'KRW',
    "displayCurrency" TEXT NOT NULL DEFAULT 'KRW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'editor',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectInvitation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "invitationCode" TEXT NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'editor',
    "status" "InvitationStatus" NOT NULL DEFAULT 'pending',
    "invitedByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectJoinRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "JoinRequestStatus" NOT NULL DEFAULT 'pending',
    "message" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialInstitution" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "FinancialInstitutionType" NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "iconPath" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialInstitution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "institutionId" TEXT,
    "accountNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "balance" DECIMAL(19,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentDetail" (
    "accountId" TEXT NOT NULL,
    "assetClass" TEXT NOT NULL,
    "ticker" TEXT,
    "quantity" DECIMAL(19,8) NOT NULL DEFAULT 0,

    CONSTRAINT "InvestmentDetail_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "AssetValuation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantity" DECIMAL(19,8) NOT NULL,
    "price" DECIMAL(19,4) NOT NULL,
    "marketValue" DECIMAL(19,4) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "CategoryType" NOT NULL,
    "icon" TEXT,
    "defaultIsFixed" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "liabilityAccountId" TEXT,
    "name" TEXT NOT NULL,
    "cardType" "CardType" NOT NULL,
    "issuerId" TEXT NOT NULL,
    "cardNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "creditLimit" DECIMAL(19,4),
    "statementClosingDay" INTEGER,
    "paymentDueDay" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardStatement" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentPlan" (
    "id" TEXT NOT NULL,
    "postingId" TEXT NOT NULL,
    "totalMonths" INTEGER NOT NULL,
    "feeAmount" DECIMAL(19,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstallmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstallmentCharge" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "statementId" TEXT,

    CONSTRAINT "InstallmentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "detailedNote" TEXT,
    -- 원화 카드로 외화 결제를 했을 때의 원 통화 금액. 표시 전용이다.
    -- 청구되는 돈은 원화이므로 posting 은 전부 원화로 남지만, "$50 결제"라는
    -- 사실이 사라지면 카드 명세서와 대조할 수 없어 전표에 함께 적어 둔다.
    -- 계좌 자체가 외화면 posting.currency 가 외화이므로 이 필드를 쓰지 않는다.
    "originalCurrency" TEXT,
    "originalAmount" DECIMAL(19,4),
    -- 환산액이 서버 추정 환율로 만들어졌다는 표시. 명세서로 실제 청구액을
    -- 확정하면 false가 되어 대조 목록에서 빠진다.
    "rateProvisional" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Posting" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT,
    "categoryId" TEXT,
    "amount" DECIMAL(19,4) NOT NULL,
    "quantity" DECIMAL(19,8),
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "baseAmount" DECIMAL(19,4) NOT NULL,
    "exchangeRate" DECIMAL(19,8) NOT NULL DEFAULT 1,
    "isFixed" BOOLEAN NOT NULL DEFAULT false,
    "statementId" TEXT,
    "cardId" TEXT,

    CONSTRAINT "Posting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    -- 환율은 프로젝트마다 따로 둔다. 한 가계부에서 바꾼 값이 다른 가계부의
    -- 과거 리포트까지 흔들면 안 된다.
    "projectId" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL,
    "quoteCurrency" TEXT NOT NULL,
    "rate" DECIMAL(19,8) NOT NULL,
    "date" DATE NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "categoryId" TEXT,
    "type" "CategoryType",
    "monthlyAmount" DECIMAL(19,4) NOT NULL,
    "effectiveFrom" TEXT,
    "effectiveTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetOverride" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetOverride_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE INDEX "User_defaultProjectId_idx" ON "User"("defaultProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectKey_key" ON "Project"("projectKey");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_idx" ON "ProjectMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectInvitation_invitationCode_key" ON "ProjectInvitation"("invitationCode");

-- CreateIndex
CREATE INDEX "ProjectInvitation_projectId_status_idx" ON "ProjectInvitation"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectInvitation_invitedByUserId_idx" ON "ProjectInvitation"("invitedByUserId");

-- CreateIndex
CREATE INDEX "ProjectJoinRequest_projectId_status_idx" ON "ProjectJoinRequest"("projectId", "status");

-- CreateIndex
CREATE INDEX "ProjectJoinRequest_userId_idx" ON "ProjectJoinRequest"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectJoinRequest_projectId_userId_key" ON "ProjectJoinRequest"("projectId", "userId");

-- CreateIndex
CREATE INDEX "Person_projectId_isActive_idx" ON "Person"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "FinancialInstitution_type_isActive_sortOrder_idx" ON "FinancialInstitution"("type", "isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialInstitution_projectId_type_name_key" ON "FinancialInstitution"("projectId", "type", "name");

-- CreateIndex
CREATE INDEX "Account_projectId_ownerId_isActive_idx" ON "Account"("projectId", "ownerId", "isActive");

-- CreateIndex
CREATE INDEX "Account_projectId_type_idx" ON "Account"("projectId", "type");

-- CreateIndex
CREATE INDEX "Account_institutionId_idx" ON "Account"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetValuation_accountId_date_key" ON "AssetValuation"("accountId", "date");

-- CreateIndex
CREATE INDEX "Category_projectId_type_isActive_idx" ON "Category"("projectId", "type", "isActive");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Category_projectId_name_parentId_key" ON "Category"("projectId", "name", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Card_liabilityAccountId_key" ON "Card"("liabilityAccountId");

-- CreateIndex
CREATE INDEX "Card_projectId_isActive_idx" ON "Card"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "Card_paymentAccountId_idx" ON "Card"("paymentAccountId");

-- CreateIndex
CREATE INDEX "Card_issuerId_idx" ON "Card"("issuerId");

-- CreateIndex
CREATE INDEX "CardStatement_cardId_dueDate_idx" ON "CardStatement"("cardId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CardStatement_cardId_periodEnd_key" ON "CardStatement"("cardId", "periodEnd");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentPlan_postingId_key" ON "InstallmentPlan"("postingId");

-- CreateIndex
CREATE INDEX "InstallmentCharge_statementId_idx" ON "InstallmentCharge"("statementId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallmentCharge_planId_sequence_key" ON "InstallmentCharge"("planId", "sequence");

-- CreateIndex
CREATE INDEX "JournalEntry_projectId_date_id_idx" ON "JournalEntry"("projectId", "date", "id");

-- CreateIndex
CREATE INDEX "JournalEntry_projectId_personId_date_idx" ON "JournalEntry"("projectId", "personId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_createdByUserId_idx" ON "JournalEntry"("createdByUserId");

-- CreateIndex
CREATE INDEX "Posting_entryId_idx" ON "Posting"("entryId");

-- CreateIndex
CREATE INDEX "Posting_accountId_entryId_idx" ON "Posting"("accountId", "entryId");

-- CreateIndex
CREATE INDEX "Posting_categoryId_idx" ON "Posting"("categoryId");

-- CreateIndex
CREATE INDEX "Posting_statementId_idx" ON "Posting"("statementId");

-- CreateIndex
CREATE INDEX "Posting_cardId_idx" ON "Posting"("cardId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_projectId_baseCurrency_quoteCurrency_date_key" ON "ExchangeRate"("projectId", "baseCurrency", "quoteCurrency", "date");

-- CreateIndex
CREATE INDEX "ExchangeRate_projectId_idx" ON "ExchangeRate"("projectId");

-- CreateIndex
CREATE INDEX "Budget_projectId_categoryId_idx" ON "Budget"("projectId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_projectId_categoryId_type_effectiveFrom_key" ON "Budget"("projectId", "categoryId", "type", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetOverride_budgetId_year_month_key" ON "BudgetOverride"("budgetId", "year", "month");

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectInvitation" ADD CONSTRAINT "ProjectInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJoinRequest" ADD CONSTRAINT "ProjectJoinRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectJoinRequest" ADD CONSTRAINT "ProjectJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialInstitution" ADD CONSTRAINT "FinancialInstitution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "FinancialInstitution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentDetail" ADD CONSTRAINT "InvestmentDetail_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetValuation" ADD CONSTRAINT "AssetValuation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_issuerId_fkey" FOREIGN KEY ("issuerId") REFERENCES "FinancialInstitution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_liabilityAccountId_fkey" FOREIGN KEY ("liabilityAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardStatement" ADD CONSTRAINT "CardStatement_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentPlan" ADD CONSTRAINT "InstallmentPlan_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "Posting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentCharge" ADD CONSTRAINT "InstallmentCharge_planId_fkey" FOREIGN KEY ("planId") REFERENCES "InstallmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallmentCharge" ADD CONSTRAINT "InstallmentCharge_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CardStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "CardStatement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Posting" ADD CONSTRAINT "Posting_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetOverride" ADD CONSTRAINT "BudgetOverride_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─────────────────────────────────────────────
-- Prisma 스키마로 표현할 수 없어 raw SQL로 넣는 것들
-- ─────────────────────────────────────────────

-- Posting은 accountId와 categoryId 중 정확히 하나만 가리켜야 한다.
ALTER TABLE "Posting"
  ADD CONSTRAINT "posting_target_exclusive"
  CHECK (("accountId" IS NULL) != ("categoryId" IS NULL));

-- 투자 계좌가 아닌 posting에 수량이 들어가는 것을 막는다.
ALTER TABLE "Posting"
  ADD CONSTRAINT "posting_quantity_requires_account"
  CHECK ("quantity" IS NULL OR "accountId" IS NOT NULL);

-- 기본 제공 항목(projectId IS NULL)의 중복 방지.
-- Postgres는 NULL을 서로 다른 값으로 보므로 일반 유니크 인덱스가 걸리지 않는다.
CREATE UNIQUE INDEX "FinancialInstitution_global_type_name_key"
    ON "FinancialInstitution"("type", "name")
    WHERE "projectId" IS NULL;

-- 원 통화 금액은 통화와 금액이 함께 있거나 함께 없어야 한다.
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "journal_entry_original_currency_pair"
  CHECK (("originalCurrency" IS NULL) = ("originalAmount" IS NULL));

-- 대분류 이름 중복 방지. 위 FinancialInstitution 과 같은 NULL 함정이다.
-- @@unique([projectId, name, parentId]) 는 parentId 가 있는 소분류에만 걸린다.
-- 이름에 type 을 묶어 지출 "기타"와 수입 "기타"는 공존할 수 있게 한다.
CREATE UNIQUE INDEX "Category_project_root_type_name_key"
    ON "Category"("projectId", "type", "name")
    WHERE "parentId" IS NULL;

-- ─────────────────────────────────────────────
-- 표시 순서 / 기준 타임존 / "구성원 중 나"
--
-- 원래는 별도 마이그레이션 세 개였다. 개발 서버를 테이블부터 새로 만들기로 해서
-- 이 파일 하나로 합쳤다.
-- ─────────────────────────────────────────────

-- 프로젝트 단위 집계 기준 타임존.
-- 월 합계와 카드 청구주기 경계를 이 타임존의 벽시계로 계산한다.
ALTER TABLE "Project" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul';

-- 표시 순서. 사용자가 드래그로 바꾼다. 같은 값이면 createdAt 순으로 본다.
ALTER TABLE "Category" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Person" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Account" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Card" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Person_projectId_sortOrder_idx" ON "Person"("projectId", "sortOrder");
CREATE INDEX "Account_projectId_sortOrder_idx" ON "Account"("projectId", "sortOrder");
CREATE INDEX "Card_projectId_sortOrder_idx" ON "Card"("projectId", "sortOrder");

-- "구성원 중 나". 사용자-프로젝트 조합마다 자기 Person을 지정한다.
ALTER TABLE "ProjectMember" ADD COLUMN "personId" TEXT;
CREATE INDEX "ProjectMember_personId_idx" ON "ProjectMember"("personId");
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_personId_fkey"
  FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 기본 제공 금융기관
-- ─────────────────────────────────────────────
INSERT INTO "FinancialInstitution" ("id", "projectId", "type", "name", "sortOrder", "updatedAt") VALUES
    -- 시중은행
    ('fi_bank_kb',            NULL, 'bank', 'KB국민은행',   10, CURRENT_TIMESTAMP),
    ('fi_bank_shinhan',       NULL, 'bank', '신한은행',     11, CURRENT_TIMESTAMP),
    ('fi_bank_hana',          NULL, 'bank', '하나은행',     12, CURRENT_TIMESTAMP),
    ('fi_bank_woori',         NULL, 'bank', '우리은행',     13, CURRENT_TIMESTAMP),
    ('fi_bank_sc',            NULL, 'bank', 'SC제일은행',   14, CURRENT_TIMESTAMP),
    -- 인터넷전문은행
    ('fi_bank_kakao',         NULL, 'bank', '카카오뱅크',   20, CURRENT_TIMESTAMP),
    ('fi_bank_k',             NULL, 'bank', '케이뱅크',     21, CURRENT_TIMESTAMP),
    ('fi_bank_toss',          NULL, 'bank', '토스뱅크',     22, CURRENT_TIMESTAMP),
    -- 특수은행
    ('fi_bank_nh',            NULL, 'bank', 'NH농협은행',   30, CURRENT_TIMESTAMP),
    ('fi_bank_ibk',           NULL, 'bank', 'IBK기업은행',  31, CURRENT_TIMESTAMP),
    ('fi_bank_kdb',           NULL, 'bank', 'KDB산업은행',  32, CURRENT_TIMESTAMP),
    ('fi_bank_sh',            NULL, 'bank', 'Sh수협은행',   33, CURRENT_TIMESTAMP),
    -- 지방은행
    ('fi_bank_busan',         NULL, 'bank', '부산은행',     40, CURRENT_TIMESTAMP),
    ('fi_bank_kyongnam',      NULL, 'bank', '경남은행',     41, CURRENT_TIMESTAMP),
    -- 2024년 대구은행에서 사명이 바뀌었다. 옛 이름으로 찾는 사용자를 위해 함께 적는다.
    ('fi_bank_im',            NULL, 'bank', 'iM뱅크(대구은행)', 42, CURRENT_TIMESTAMP),
    ('fi_bank_kwangju',       NULL, 'bank', '광주은행',     43, CURRENT_TIMESTAMP),
    ('fi_bank_jeonbuk',       NULL, 'bank', '전북은행',     44, CURRENT_TIMESTAMP),
    ('fi_bank_jeju',          NULL, 'bank', '제주은행',     45, CURRENT_TIMESTAMP),
    -- 상호금융 및 기타
    ('fi_bank_mg',            NULL, 'bank', '새마을금고',   50, CURRENT_TIMESTAMP),
    ('fi_bank_cu',            NULL, 'bank', '신협',         51, CURRENT_TIMESTAMP),
    ('fi_bank_post',          NULL, 'bank', '우체국',       52, CURRENT_TIMESTAMP),
    -- 증권사 (investment 계좌용)
    ('fi_bank_mirae',         NULL, 'bank', '미래에셋증권', 60, CURRENT_TIMESTAMP),
    ('fi_bank_samsungsec',    NULL, 'bank', '삼성증권',     61, CURRENT_TIMESTAMP),
    ('fi_bank_nhsec',         NULL, 'bank', 'NH투자증권',   62, CURRENT_TIMESTAMP),
    ('fi_bank_kbsec',         NULL, 'bank', 'KB증권',       63, CURRENT_TIMESTAMP),
    ('fi_bank_kis',           NULL, 'bank', '한국투자증권', 64, CURRENT_TIMESTAMP),
    ('fi_bank_kiwoom',        NULL, 'bank', '키움증권',     65, CURRENT_TIMESTAMP),
    ('fi_bank_shinhansec',    NULL, 'bank', '신한투자증권', 66, CURRENT_TIMESTAMP),
    ('fi_bank_hanasec',       NULL, 'bank', '하나증권',     67, CURRENT_TIMESTAMP),
    ('fi_bank_tosssec',       NULL, 'bank', '토스증권',     68, CURRENT_TIMESTAMP),

    -- 카드사
    ('fi_card_shinhan',       NULL, 'card_issuer', '신한카드',     10, CURRENT_TIMESTAMP),
    ('fi_card_samsung',       NULL, 'card_issuer', '삼성카드',     11, CURRENT_TIMESTAMP),
    ('fi_card_kb',            NULL, 'card_issuer', 'KB국민카드',   12, CURRENT_TIMESTAMP),
    ('fi_card_hyundai',       NULL, 'card_issuer', '현대카드',     13, CURRENT_TIMESTAMP),
    ('fi_card_lotte',         NULL, 'card_issuer', '롯데카드',     14, CURRENT_TIMESTAMP),
    ('fi_card_hana',          NULL, 'card_issuer', '하나카드',     15, CURRENT_TIMESTAMP),
    ('fi_card_woori',         NULL, 'card_issuer', '우리카드',     16, CURRENT_TIMESTAMP),
    ('fi_card_bc',            NULL, 'card_issuer', 'BC카드',       17, CURRENT_TIMESTAMP),
    ('fi_card_nh',            NULL, 'card_issuer', 'NH농협카드',   18, CURRENT_TIMESTAMP),
    ('fi_card_ibk',           NULL, 'card_issuer', 'IBK기업은행',  19, CURRENT_TIMESTAMP),
    -- 체크카드는 은행이 직접 발급한다
    ('fi_card_kakao',         NULL, 'card_issuer', '카카오뱅크',   30, CURRENT_TIMESTAMP),
    ('fi_card_k',             NULL, 'card_issuer', '케이뱅크',     31, CURRENT_TIMESTAMP),
    ('fi_card_toss',          NULL, 'card_issuer', '토스뱅크',     32, CURRENT_TIMESTAMP),
    ('fi_card_mg',            NULL, 'card_issuer', '새마을금고',   33, CURRENT_TIMESTAMP),
    ('fi_card_cu',            NULL, 'card_issuer', '신협',         34, CURRENT_TIMESTAMP),
    ('fi_card_post',          NULL, 'card_issuer', '우체국',       35, CURRENT_TIMESTAMP);
-- 각 기관에 아이콘 경로 할당
UPDATE "FinancialInstitution" SET "iconPath" = CASE "id"
  -- 은행
  WHEN 'fi_bank_kb' THEN '/icons/banks/fi_bank_kb.svg'
  WHEN 'fi_bank_shinhan' THEN '/icons/banks/fi_bank_shinhan.svg'
  WHEN 'fi_bank_hana' THEN '/icons/banks/fi_bank_hana.svg'
  WHEN 'fi_bank_woori' THEN '/icons/banks/fi_bank_woori.svg'
  WHEN 'fi_bank_sc' THEN '/icons/banks/fi_bank_sc.svg'
  WHEN 'fi_bank_kakao' THEN '/icons/banks/fi_bank_kakao.svg'
  WHEN 'fi_bank_k' THEN '/icons/banks/fi_bank_k.svg'
  WHEN 'fi_bank_toss' THEN '/icons/banks/fi_bank_toss.svg'
  WHEN 'fi_bank_nh' THEN '/icons/banks/fi_bank_nh.svg'
  WHEN 'fi_bank_ibk' THEN '/icons/banks/fi_bank_ibk.svg'
  WHEN 'fi_bank_kdb' THEN '/icons/banks/fi_bank_kdb.svg'
  WHEN 'fi_bank_sh' THEN '/icons/banks/fi_bank_sh.svg'
  WHEN 'fi_bank_busan' THEN '/icons/banks/fi_bank_busan.svg'
  WHEN 'fi_bank_kyongnam' THEN '/icons/banks/fi_bank_kyongnam.svg'
  WHEN 'fi_bank_im' THEN '/icons/banks/fi_bank_im.svg'
  WHEN 'fi_bank_kwangju' THEN '/icons/banks/fi_bank_kwangju.svg'
  WHEN 'fi_bank_jeonbuk' THEN '/icons/banks/fi_bank_jeonbuk.svg'
  WHEN 'fi_bank_jeju' THEN '/icons/banks/fi_bank_jeju.svg'
  WHEN 'fi_bank_mg' THEN '/icons/banks/fi_bank_mg.svg'
  WHEN 'fi_bank_cu' THEN '/icons/banks/fi_bank_cu.svg'
  WHEN 'fi_bank_post' THEN '/icons/banks/fi_bank_post.svg'
  -- 카드사
  WHEN 'fi_card_shinhan' THEN '/icons/card-issuers/fi_card_shinhan.svg'
  WHEN 'fi_card_samsung' THEN '/icons/card-issuers/fi_card_samsung.svg'
  WHEN 'fi_card_kb' THEN '/icons/card-issuers/fi_card_kb.svg'
  WHEN 'fi_card_hyundai' THEN '/icons/card-issuers/fi_card_hyundai.svg'
  WHEN 'fi_card_lotte' THEN '/icons/card-issuers/fi_card_lotte.svg'
  WHEN 'fi_card_hana' THEN '/icons/card-issuers/fi_card_hana.svg'
  WHEN 'fi_card_woori' THEN '/icons/card-issuers/fi_card_woori.svg'
  WHEN 'fi_card_bc' THEN '/icons/card-issuers/fi_card_bc.svg'
  WHEN 'fi_card_nh' THEN '/icons/card-issuers/fi_card_nh.svg'
  WHEN 'fi_card_ibk' THEN '/icons/card-issuers/fi_card_ibk.svg'
END WHERE "projectId" IS NULL;
