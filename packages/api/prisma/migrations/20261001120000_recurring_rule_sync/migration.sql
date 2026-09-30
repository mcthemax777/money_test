-- 반복 등록을 기기 사본으로 보낸다 (오프라인에서 목록을 보고 만들고 고치고 지우기 위해).
--
-- 다른 표와 같은 변경 번호와 자리표를 건다 (마이그레이션 20260901134114_sync_version 이
-- 만들어 둔 함수). 걸지 않으면 규칙은 언제나 updatedVersion=0 이라 기기가 영영 받지 못한다.
--
-- 태그 연결(RecurringRuleTag)은 따로 번호를 두지 않는다. 규칙을 고치면서 태그를 바꾸면
-- 규칙 줄이 함께 고쳐져(updatedAt) 번호가 오르고, 동기화가 그 규칙의 태그를 같이 싣는다.

ALTER TABLE "RecurringRule" ADD COLUMN "updatedVersion" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "RecurringRule_projectId_updatedVersion_idx" ON "RecurringRule"("projectId", "updatedVersion");

CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "RecurringRule"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "RecurringRule"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();

-- 이미 있는 규칙에 번호를 매긴다. 트리거가 이 UPDATE 에서 프로젝트 번호를 올려 찍는다.
UPDATE "RecurringRule" SET "updatedAt" = "updatedAt";
