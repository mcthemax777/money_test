-- 은행/카드사를 자유 입력 문자열에서 FinancialInstitution 참조로 바꾼다.
--
-- 기존 Account.bankName / Card.issuer 의 텍스트는 버리지 않는다.
-- 기본 제공 목록과 이름이 정확히 일치하면 그 행을 가리키고,
-- 일치하지 않으면 그 프로젝트 전용 사용자 추가 항목을 만들어 연결한다.
-- 즉 마이그레이션 자체가 "사용자 추가" 경로를 한 번 쓰는 셈이다.

-- ─────────────────────────────────────────────
-- 1. 테이블
-- ─────────────────────────────────────────────

CREATE TYPE "FinancialInstitutionType" AS ENUM ('bank', 'card_issuer');

CREATE TABLE "FinancialInstitution" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "FinancialInstitutionType" NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialInstitution_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinancialInstitution_projectId_type_name_key"
    ON "FinancialInstitution"("projectId", "type", "name");

CREATE INDEX "FinancialInstitution_type_isActive_sortOrder_idx"
    ON "FinancialInstitution"("type", "isActive", "sortOrder");

-- 위 유니크 인덱스는 projectId가 NULL인 기본 제공 항목을 막지 못한다.
-- Postgres는 NULL을 서로 다른 값으로 취급하므로 (NULL, 'bank', '신한은행')이 여러 번 들어갈 수 있다.
-- 기본 제공 항목의 중복은 부분 인덱스로 따로 막는다.
CREATE UNIQUE INDEX "FinancialInstitution_global_type_name_key"
    ON "FinancialInstitution"("type", "name")
    WHERE "projectId" IS NULL;

ALTER TABLE "FinancialInstitution"
    ADD CONSTRAINT "FinancialInstitution_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 2. 기본 제공 목록 (projectId IS NULL)
-- ─────────────────────────────────────────────
-- id를 cuid가 아니라 읽을 수 있는 고정값으로 둔다. 환경마다 같은 id를 갖게 되어
-- 아래 백필과 이후 데이터 이관에서 이름 대신 id로 참조할 수 있다.

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

-- ─────────────────────────────────────────────
-- 3. Account.bankName -> Account.institutionId
-- ─────────────────────────────────────────────

ALTER TABLE "Account" ADD COLUMN "institutionId" TEXT;

-- 3-1. 기본 제공 목록과 이름이 정확히 일치하는 것부터 연결
UPDATE "Account" a
   SET "institutionId" = fi."id"
  FROM "FinancialInstitution" fi
 WHERE fi."projectId" IS NULL
   AND fi."type" = 'bank'
   AND fi."name" = a."bankName";

-- 3-2. 남은 텍스트는 프로젝트 전용 항목으로 만든다.
--      '신한' 처럼 기본 목록의 '신한은행'과 다른 표기는 자동 추측하지 않고 그대로 보존한다.
INSERT INTO "FinancialInstitution" ("id", "projectId", "type", "name", "sortOrder", "updatedAt")
SELECT DISTINCT ON (a."projectId", a."bankName")
       'fi_mig_' || md5(a."projectId" || ':bank:' || a."bankName"),
       a."projectId",
       'bank',
       a."bankName",
       0,
       CURRENT_TIMESTAMP
  FROM "Account" a
 WHERE a."institutionId" IS NULL
   AND a."bankName" IS NOT NULL
   AND btrim(a."bankName") <> ''
 ORDER BY a."projectId", a."bankName";

UPDATE "Account" a
   SET "institutionId" = fi."id"
  FROM "FinancialInstitution" fi
 WHERE a."institutionId" IS NULL
   AND fi."projectId" = a."projectId"
   AND fi."type" = 'bank'
   AND fi."name" = a."bankName";

ALTER TABLE "Account" DROP COLUMN "bankName";

CREATE INDEX "Account_institutionId_idx" ON "Account"("institutionId");

ALTER TABLE "Account"
    ADD CONSTRAINT "Account_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "FinancialInstitution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────
-- 4. Card.issuer -> Card.issuerId
-- ─────────────────────────────────────────────

ALTER TABLE "Card" ADD COLUMN "issuerId" TEXT;

-- 4-1. 기본 제공 카드사와 이름이 일치하는 것부터 연결
UPDATE "Card" c
   SET "issuerId" = fi."id"
  FROM "FinancialInstitution" fi
 WHERE fi."projectId" IS NULL
   AND fi."type" = 'card_issuer'
   AND fi."name" = c."issuer";

-- 4-2. 남은 표기는 프로젝트 전용 항목으로 보존한다.
--      issuer는 NOT NULL이었지만 빈 문자열이 들어가 있을 수 있어 그 경우는 '미지정'으로 만든다.
--      정확한 카드사를 모른 채 임의로 배정하지 않고, 사용자가 화면에서 고치도록 남겨 둔다.
INSERT INTO "FinancialInstitution" ("id", "projectId", "type", "name", "sortOrder", "updatedAt")
SELECT DISTINCT ON (c."projectId", label.name)
       'fi_mig_' || md5(c."projectId" || ':card_issuer:' || label.name),
       c."projectId",
       'card_issuer',
       label.name,
       0,
       CURRENT_TIMESTAMP
  FROM "Card" c
 CROSS JOIN LATERAL (
       SELECT CASE WHEN btrim(coalesce(c."issuer", '')) = '' THEN '미지정'
                   ELSE c."issuer" END AS name
 ) label
 WHERE c."issuerId" IS NULL
 ORDER BY c."projectId", label.name
ON CONFLICT DO NOTHING;

UPDATE "Card" c
   SET "issuerId" = fi."id"
  FROM "FinancialInstitution" fi
 WHERE c."issuerId" IS NULL
   AND fi."projectId" = c."projectId"
   AND fi."type" = 'card_issuer'
   AND fi."name" = CASE WHEN btrim(coalesce(c."issuer", '')) = '' THEN '미지정'
                        ELSE c."issuer" END;

-- 여기까지 왔는데 비어 있는 행이 있다면 위 백필에 구멍이 있다는 뜻이므로
-- 조용히 넘기지 않고 마이그레이션을 실패시킨다.
DO $$
DECLARE unmapped INTEGER;
BEGIN
    SELECT count(*) INTO unmapped FROM "Card" WHERE "issuerId" IS NULL;
    IF unmapped > 0 THEN
        RAISE EXCEPTION 'Card.issuerId 백필 실패: % 건이 매핑되지 않았습니다', unmapped;
    END IF;
END $$;

ALTER TABLE "Card" ALTER COLUMN "issuerId" SET NOT NULL;

ALTER TABLE "Card" DROP COLUMN "issuer";

CREATE INDEX "Card_issuerId_idx" ON "Card"("issuerId");

ALTER TABLE "Card"
    ADD CONSTRAINT "Card_issuerId_fkey"
    FOREIGN KEY ("issuerId") REFERENCES "FinancialInstitution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
