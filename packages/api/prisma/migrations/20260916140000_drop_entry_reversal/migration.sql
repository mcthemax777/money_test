-- 되돌리는 전표를 따로 만들지 않기로 했다.
--
-- 취소는 원 거래의 discountAmount 로 적는다. 청구 주기가 지난 뒤의 취소는 사용자가
-- 카드에 수입을 적어 맞춘다(수입도 카드를 결제수단으로 고를 수 있다).
DROP INDEX IF EXISTS "JournalEntry_reversalOfEntryId_idx";

ALTER TABLE "JournalEntry" DROP CONSTRAINT IF EXISTS "JournalEntry_reversalOfEntryId_fkey";

ALTER TABLE "JournalEntry" DROP COLUMN IF EXISTS "reversalOfEntryId";
