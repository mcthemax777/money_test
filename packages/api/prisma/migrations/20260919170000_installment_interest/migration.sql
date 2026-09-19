-- 유이자 할부와 회차 수수료.
--
-- 지금까지 할부는 개월수 하나였다. 원금 회차는 총액을 개월수로 나누면 나오지만 수수료는
-- 카드사마다 다르고 회차마다 조금씩 달라, 계산으로는 명세서와 맞출 수 없다. 그래서
-- 유이자로 적은 할부는 마감된 회차마다 "수수료 미입력"으로 떠오르고, 사용자가 명세서를
-- 보고 적으면 그때 수수료 전표가 하나 생긴다 (외화 청구액 확정과 같은 손짓이다).
--
-- 지금까지 적은 할부는 전부 무이자로 본다. 수수료 전표가 없다는 뜻이라 이미 보고 있던
-- 숫자가 그대로 남는다.
ALTER TABLE "InstallmentPlan" ADD COLUMN "interestBearing" BOOLEAN NOT NULL DEFAULT false;

-- 수수료 총액 칸과 회차 표를 걷어낸다.
--
-- 둘 다 만들어 두고 한 번도 쓰지 않았다. 수수료를 계획에 총액으로 적어 두면 부채는
-- 전표 합인데 청구만 늘어나 원장이 어긋나고, 회차 금액을 표로 저장하면 마감일을 바꿨을
-- 때 다시 계산되는 값과 저장해 둔 값이 갈린다. 수수료는 전표로, 원금 회차는 계산으로
-- 간다 (설계 문서의 D7).
DROP TABLE IF EXISTS "InstallmentCharge";
ALTER TABLE "InstallmentPlan" DROP COLUMN IF EXISTS "feeAmount";

-- 수수료 전표가 어느 회차의 것인지.
--
-- 이 표가 있어야 이미 적은 회차가 다시 떠오르지 않는다. 계획이 사라져도(원 구매를
-- 지우면 다리와 함께 지워진다) 전표는 남긴다 -- 그 수수료는 실제로 나간 돈이라 지우면
-- 통장과 원장이 어긋난다.
ALTER TABLE "JournalEntry" ADD COLUMN "installmentPlanId" TEXT;
ALTER TABLE "JournalEntry" ADD COLUMN "installmentSequence" INTEGER;

ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_installmentPlanId_fkey"
  FOREIGN KEY ("installmentPlanId") REFERENCES "InstallmentPlan"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 한 회차의 수수료는 한 번만 적는다. 두 기기가 같은 회차를 동시에 확정하면 뒤엣것이 막힌다.
CREATE UNIQUE INDEX "JournalEntry_installmentPlanId_installmentSequence_key"
  ON "JournalEntry"("installmentPlanId", "installmentSequence");
