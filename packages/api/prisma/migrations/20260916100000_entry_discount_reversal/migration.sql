-- 결제 자리에서 깎인 금액 (카드 포인트 사용, 자동할인, 같은 주기 안의 취소).
-- 다리에는 이미 깎인 뒤의 금액이 들어가므로 이 값은 표시 전용이다.
ALTER TABLE "JournalEntry" ADD COLUMN "discountAmount" DECIMAL(19,4);

-- 되돌린 원 거래. 취소가 원 결제와 다른 청구 주기에 걸렸을 때만 생긴다.
ALTER TABLE "JournalEntry" ADD COLUMN "reversalOfEntryId" TEXT;

ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_reversalOfEntryId_fkey"
  FOREIGN KEY ("reversalOfEntryId") REFERENCES "JournalEntry"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "JournalEntry_reversalOfEntryId_idx" ON "JournalEntry"("reversalOfEntryId");
