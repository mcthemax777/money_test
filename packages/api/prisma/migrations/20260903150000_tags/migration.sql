-- 거래에 자유롭게 붙이는 이름표.
--
-- 카테고리와 나란히 서지만 계층이 없고, 전표 하나에 여럿 붙는다. 카테고리는 "이 돈이
-- 무엇에 쓰였나"를 한 갈래로 정하는 것이고 태그는 그와 직교하는 이름표다.
--
-- 수입/지출 구분을 두지 않는다. 같은 여행에 항공권 지출과 환불 수입이 함께 들므로,
-- 유형으로 갈라 두면 한 여행을 두 태그로 적게 된다.
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- 전표에 붙은 태그.
--
-- 번호(updatedVersion)를 붙이지 않는다. 전표가 다리와 함께 한 단위로 움직이는 것과
-- 같은 이유다 -- 전표가 바뀌면 그 전표의 태그 연결을 통째로 갈아 끼우고, 변경 피드도
-- 전표에 실어 함께 보낸다.
CREATE TABLE "EntryTag" (
    "entryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "EntryTag_pkey" PRIMARY KEY ("entryId","tagId")
);

-- 이름은 프로젝트 안에서 유일하다. 카테고리와 달리 유형도 부모도 없어 조건이 하나다.
CREATE UNIQUE INDEX "Tag_projectId_name_key" ON "Tag"("projectId", "name");
CREATE INDEX "Tag_projectId_isActive_idx" ON "Tag"("projectId", "isActive");
CREATE INDEX "Tag_projectId_updatedVersion_idx" ON "Tag"("projectId", "updatedVersion");
CREATE INDEX "EntryTag_tagId_idx" ON "EntryTag"("tagId");

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntryTag" ADD CONSTRAINT "EntryTag_entryId_fkey"
    FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntryTag" ADD CONSTRAINT "EntryTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 변경 번호와 자리표. 다른 표와 같은 함수를 그대로 쓴다
-- (마이그레이션 20260901134114_sync_version 이 만들어 둔 것).
--
-- 걸지 않으면 태그는 언제나 updatedVersion=0 이라 기기가 영영 받지 못한다.
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "Tag"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "Tag"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();

-- EntryTag 에는 걸지 않는다.
--
-- 이 표는 번호를 갖지 않고 전표에 실려 움직인다. 연결이 바뀌는 자리는 전표를 만들거나
-- 갈아 끼우는 트랜잭션 안뿐이고, 그때 JournalEntry 의 도장이 이미 찍힌다.
--
-- 다만 태그를 **하드 삭제**하면 연결만 cascade 로 사라지고 전표의 번호는 그대로다.
-- 화면은 소프트 삭제(isActive=false)만 하므로 그 길로 들어올 일이 없고, 손으로 지우는
-- 경우에는 그 태그가 붙은 전표를 함께 건드려야 한다.
