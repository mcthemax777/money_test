-- 보관함. 아직 거래가 아닌 후보를 담는 표.
--
-- 기기가 알림(카드 승인 문구)과 화면 캡처에서 읽어 낸 것을 담아 두고, 사용자가
-- 눌러 저장할 때 비로소 JournalEntry 가 만들어진다. 그래서 이 표는 합계·잔액·예산
-- 어디에도 들지 않는다 -- 읽는 곳은 보관함 화면뿐이다.
--
-- 파싱한 값은 전부 NULL 을 허용한다. 금액만 읽히고 분류를 모르는 후보가 정상이라,
-- NOT NULL 로 묶으면 반쯤 읽힌 것을 버려야 한다.
CREATE TABLE "EntryDraft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    -- notification | capture
    "source" TEXT NOT NULL,
    -- pending | registered | dismissed
    "status" TEXT NOT NULL DEFAULT 'pending',

    "rawText" TEXT NOT NULL,
    "appPackage" TEXT,
    "appTitle" TEXT,

    "kind" TEXT,
    "amount" DECIMAL(18,4),
    "currency" TEXT,
    "occurredAt" TIMESTAMP(3),
    "merchant" TEXT,
    "description" TEXT,
    "installmentMonths" INTEGER,

    "personId" TEXT,
    "categoryId" TEXT,
    "accountId" TEXT,
    "cardId" TEXT,

    "confidence" INTEGER NOT NULL DEFAULT 0,
    "parser" TEXT,

    -- 같은 알림이 두 번 도착하거나 같은 캡처를 두 번 올려도 후보는 하나로 남는다.
    "dedupeKey" TEXT NOT NULL,

    "registeredEntryId" TEXT,
    "createdByUserId" TEXT,

    "updatedVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EntryDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EntryDraft_projectId_dedupeKey_key" ON "EntryDraft"("projectId", "dedupeKey");
-- 보관함 화면이 고르는 길. 탭(source)마다 대기 중인 것을 본다.
CREATE INDEX "EntryDraft_projectId_status_source_idx" ON "EntryDraft"("projectId", "status", "source");
CREATE INDEX "EntryDraft_projectId_updatedVersion_idx" ON "EntryDraft"("projectId", "updatedVersion");
CREATE INDEX "EntryDraft_registeredEntryId_idx" ON "EntryDraft"("registeredEntryId");

ALTER TABLE "EntryDraft" ADD CONSTRAINT "EntryDraft_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- 등록해서 만든 거래를 지우면 후보는 남고 연결만 끊는다. 후보를 함께 지우면
-- "이 알림은 이미 처리했다"는 사실이 사라져 같은 알림이 다시 후보로 살아난다.
ALTER TABLE "EntryDraft" ADD CONSTRAINT "EntryDraft_registeredEntryId_fkey"
    FOREIGN KEY ("registeredEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 변경 번호와 자리표. 다른 표와 같은 함수를 그대로 쓴다
-- (마이그레이션 20260901134114_sync_version 이 만들어 둔 것).
--
-- 걸지 않으면 후보는 언제나 updatedVersion=0 이라 기기가 영영 받지 못한다.
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "EntryDraft"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "EntryDraft"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
