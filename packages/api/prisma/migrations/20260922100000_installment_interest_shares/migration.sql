-- 유이자 할부의 회차별 이자와 그것을 만든 입력값.
--
-- 이자는 계산으로 기본값을 채우지만 명세서와 다르면 사용자가 고쳐 적는다. 고쳐 적은
-- 값이 사실이라 계산식이 아니라 값을 담는다. monthlyPayment(고정형)와 annualRate(변동형)는
-- 표를 다시 계산할 때 쓰는 입력이고, 둘 다 null 이면 사용자가 손으로 적은 이자다.
ALTER TABLE "InstallmentPlan" ADD COLUMN "interestShares" JSONB;
ALTER TABLE "InstallmentPlan" ADD COLUMN "monthlyPayment" DECIMAL(19,4);
ALTER TABLE "InstallmentPlan" ADD COLUMN "annualRate" DECIMAL(19,4);
