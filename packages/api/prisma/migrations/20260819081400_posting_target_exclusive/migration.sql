-- Posting은 accountId와 categoryId 중 정확히 하나만 가리켜야 한다.
-- Prisma 스키마로 표현할 수 없어 raw SQL로 추가한다.
ALTER TABLE "Posting"
  ADD CONSTRAINT "posting_target_exclusive"
  CHECK (("accountId" IS NULL) != ("categoryId" IS NULL));

-- 투자 계좌가 아닌 posting에 수량이 들어가는 것을 막는다.
ALTER TABLE "Posting"
  ADD CONSTRAINT "posting_quantity_requires_account"
  CHECK ("quantity" IS NULL OR "accountId" IS NOT NULL);
