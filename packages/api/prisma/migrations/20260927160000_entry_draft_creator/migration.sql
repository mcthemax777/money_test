-- 보관함 후보를 누가, 어느 기기에서 담았는가.
--
-- createdByName 은 담은 사용자가 이 가계부에서 "나"로 고른 구성원의 이름을 담을 때 적어
-- 둔 것이고, deviceName 은 알림을 잡은 기기의 이름이다. 옛 후보는 비어 있다.
ALTER TABLE "EntryDraft" ADD COLUMN "createdByName" TEXT;
ALTER TABLE "EntryDraft" ADD COLUMN "deviceName" TEXT;
