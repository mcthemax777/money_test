-- 할부 이자를 전표 금액에 넣는다. 수수료 전표라는 것이 없어진다.
--
-- 지금까지 유이자 할부의 이자는 회차가 마감될 때마다 사람이 명세서를 보고 적어
-- 별도의 수수료 전표로 남았다. 그래서 산 날에는 카드 빚이 원금만큼만 잡히고, 매달
-- 갚을 돈도 적히기 전까지는 어디에도 없었다.
--
-- 이제 이자는 거래를 적을 때 회차별로 함께 적고 전표 금액에 들어간다(조립의
-- `buildExpense`). 카드에 갚을 돈이 산 날 하루에 전부 잡히고, 회차 기준으로 보면
-- 달마다 그 회차의 원금과 이자가 선다.
--
-- 그래서 "어느 회차의 수수료를 이미 적었는가"를 가리키던 두 칸이 필요 없어진다.
-- 이 마이그레이션을 적용하기 전에 `scripts/installment-interest-migrate.ts` 를 먼저
-- 돌려야 한다 -- 옛 수수료 전표를 지우고 이자를 원 거래에 옮겨 담는 스크립트이고,
-- 이 칸이 사라지면 그 전표를 가려낼 길이 없다.
ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_installmentPlanId_fkey";
DROP INDEX IF EXISTS "JournalEntry_installmentPlanId_installmentSequence_key";
ALTER TABLE "JournalEntry" DROP COLUMN IF EXISTS "installmentPlanId";
ALTER TABLE "JournalEntry" DROP COLUMN IF EXISTS "installmentSequence";
