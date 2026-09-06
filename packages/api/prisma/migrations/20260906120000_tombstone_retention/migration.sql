-- 자리표(Tombstone)의 보관 기간과, 어디까지 지웠는지의 바닥.
--
-- 지금까지 자리표는 영구 보관이었다. 그래서 아무리 오래된 커서를 든 기기도 놓친
-- 삭제를 따라잡을 수 있었지만, 표가 무한히 자란다. 보관 기간을 두는 순간
-- "따라잡을 수 없는 커서"가 생기므로, 그 기기가 사본을 버리고 처음부터 받는 길이
-- 함께 있어야 한다. 이 마이그레이션은 그 판단에 필요한 두 값을 만든다.

-- 1) 언제 지워졌는가.
--
-- 번호(deletedVersion)로는 보관 기간을 잴 수 없다. 번호는 프로젝트마다 다른 속도로
-- 오르므로 "90일"을 번호로 옮길 방법이 없다.
ALTER TABLE "Tombstone" ADD COLUMN "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Tombstone_deletedAt_idx" ON "Tombstone"("deletedAt");

-- 시각은 트리거가 찍는다.
--
-- 자리표를 넣는 자리는 넷이다(sync_tombstone, ..._via_budget, ..._via_account,
-- ..._via_posting). 그 넷의 ON CONFLICT 절을 각각 고치는 대신 표에 한 번 걸어 둔다.
-- **다시 지워진 행의 시각이 새로 들어야 한다** -- 옛 시각이 남으면 방금 지운 것이
-- 보관 기간이 지난 것으로 보여, 아직 그 삭제를 받지 못한 기기가 유령 행을 안는다.
CREATE OR REPLACE FUNCTION sync_tombstone_touch() RETURNS TRIGGER AS $$
BEGIN
  NEW."deletedAt" := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_touch BEFORE INSERT OR UPDATE ON "Tombstone"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone_touch();

-- 2) 어디까지 지웠는가.
--
-- Project 에 컬럼을 더하지 않은 이유는 그 표에 걸린 도장 트리거다. UPDATE 마다
-- syncVersion 이 올라, 정리 작업이 돌 때마다 모든 기기가 "프로젝트가 바뀌었다"는
-- 변경을 받는다. 정리는 기기가 볼 일이 아니다.
CREATE TABLE "TombstoneFloor" (
  "projectId" TEXT NOT NULL,
  "version"   INTEGER NOT NULL DEFAULT 0,
  "prunedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TombstoneFloor_pkey" PRIMARY KEY ("projectId")
);

ALTER TABLE "TombstoneFloor" ADD CONSTRAINT "TombstoneFloor_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
