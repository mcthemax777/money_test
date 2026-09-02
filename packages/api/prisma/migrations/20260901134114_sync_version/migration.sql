-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "BudgetOverride" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ExchangeRate" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "syncVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Tombstone" (
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deletedVersion" INTEGER NOT NULL,

    CONSTRAINT "Tombstone_pkey" PRIMARY KEY ("entity","entityId")
);

-- CreateIndex
CREATE INDEX "Tombstone_projectId_deletedVersion_idx" ON "Tombstone"("projectId", "deletedVersion");

-- CreateIndex
CREATE INDEX "Account_projectId_updatedVersion_idx" ON "Account"("projectId", "updatedVersion");

-- CreateIndex
CREATE INDEX "Budget_projectId_updatedVersion_idx" ON "Budget"("projectId", "updatedVersion");

-- CreateIndex
CREATE INDEX "BudgetOverride_updatedVersion_idx" ON "BudgetOverride"("updatedVersion");

-- CreateIndex
CREATE INDEX "Card_projectId_updatedVersion_idx" ON "Card"("projectId", "updatedVersion");

-- CreateIndex
CREATE INDEX "Category_projectId_updatedVersion_idx" ON "Category"("projectId", "updatedVersion");

-- CreateIndex
CREATE INDEX "ExchangeRate_projectId_updatedVersion_idx" ON "ExchangeRate"("projectId", "updatedVersion");

-- CreateIndex
CREATE INDEX "JournalEntry_projectId_updatedVersion_idx" ON "JournalEntry"("projectId", "updatedVersion");

-- CreateIndex
CREATE INDEX "Person_projectId_updatedVersion_idx" ON "Person"("projectId", "updatedVersion");

-- CreateIndex
CREATE INDEX "ProjectMember_projectId_updatedVersion_idx" ON "ProjectMember"("projectId", "updatedVersion");

-- ─────────────────────────────────────────────
-- 변경 피드 (Prisma가 표현하지 못하는 부분은 여기 raw SQL로 둔다)
-- ─────────────────────────────────────────────
--
-- 왜 트리거인가. 번호를 서비스마다 손으로 찍으면 언젠가 한 곳을 빠뜨린다. 그 한 곳의
-- 변경은 어떤 기기에도 도달하지 못하고, 아무 오류도 나지 않아 알아챌 수도 없다.
-- 표에 걸어 두면 raw SQL과 손으로 고친 행까지 빠짐없이 번호를 받는다.
-- 이 저장소는 CHECK 제약과 부분 유니크 인덱스도 같은 이유로 여기 두고 있다.

-- 먼저 이미 있는 데이터를 1번으로 채운다. 트리거를 만들기 전에 해야 한다
-- (뒤에 하면 백필 한 줄마다 번호가 오른다). 모든 행이 1이면 since=0 으로 처음
-- 동기화하는 기기가 전부를 한 번에 받는다.
UPDATE "Project" SET "syncVersion" = 1, "updatedVersion" = 1;
UPDATE "ProjectMember" SET "updatedVersion" = 1;
UPDATE "Person" SET "updatedVersion" = 1;
UPDATE "Account" SET "updatedVersion" = 1;
UPDATE "Category" SET "updatedVersion" = 1;
UPDATE "Card" SET "updatedVersion" = 1;
UPDATE "JournalEntry" SET "updatedVersion" = 1;
UPDATE "Budget" SET "updatedVersion" = 1;
UPDATE "BudgetOverride" SET "updatedVersion" = 1;
UPDATE "ExchangeRate" SET "updatedVersion" = 1;

-- 번호 발급. UPDATE가 프로젝트 행 잠금을 잡으므로 그 프로젝트의 쓰기가 직렬화되고,
-- 번호 순서와 커밋 순서가 같아진다. 프로젝트가 없으면 NULL을 돌려준다.
CREATE OR REPLACE FUNCTION sync_next_version(pid TEXT) RETURNS INTEGER AS $$
DECLARE v INTEGER;
BEGIN
  UPDATE "Project" SET "syncVersion" = "syncVersion" + 1
   WHERE id = pid
   RETURNING "syncVersion" INTO v;
  RETURN v;
END;
$$ LANGUAGE plpgsql;

-- projectId 컬럼을 가진 표의 도장.
--
-- to_jsonb 로 컬럼을 읽는 것은 표마다 함수를 만들지 않기 위해서다.
-- projectId 가 NULL 인 행(기본 제공 금융기관)은 프로젝트에 속하지 않으므로 지나간다.
CREATE OR REPLACE FUNCTION sync_stamp() RETURNS TRIGGER AS $$
DECLARE pid TEXT; v INTEGER;
BEGIN
  pid := to_jsonb(NEW) ->> 'projectId';
  IF pid IS NULL THEN RETURN NEW; END IF;

  v := sync_next_version(pid);
  IF v IS NULL THEN RETURN NEW; END IF;
  NEW."updatedVersion" := v;

  -- 지웠던 id 로 행이 다시 생기면(기기가 만든 id 를 재생하는 경우) 옛 자리표를
  -- 걷어낸다. 남겨 두면 그 자리표를 받은 기기가 방금 살아난 행을 지운다.
  IF TG_OP = 'INSERT' THEN
    DELETE FROM "Tombstone" WHERE entity = TG_TABLE_NAME AND "entityId" = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BudgetOverride 는 projectId 가 없다. 부모(Budget)를 거쳐 찾는다.
CREATE OR REPLACE FUNCTION sync_stamp_via_budget() RETURNS TRIGGER AS $$
DECLARE pid TEXT; v INTEGER;
BEGIN
  SELECT b."projectId" INTO pid FROM "Budget" b WHERE b.id = NEW."budgetId";
  IF pid IS NULL THEN RETURN NEW; END IF;

  v := sync_next_version(pid);
  IF v IS NULL THEN RETURN NEW; END IF;
  NEW."updatedVersion" := v;

  IF TG_OP = 'INSERT' THEN
    DELETE FROM "Tombstone" WHERE entity = TG_TABLE_NAME AND "entityId" = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Project 자신의 도장.
--
-- 다른 표의 트리거가 부른 UPDATE(깊이 2 이상)라면 번호는 그 문장이 이미 올렸다.
-- 여기서 또 올리면 한 번의 쓰기에 번호가 두 번 오르고, 프로젝트 행이 바뀌지도
-- 않았는데 바뀐 것처럼 피드에 실린다.
CREATE OR REPLACE FUNCTION sync_stamp_project() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."syncVersion" := GREATEST(NEW."syncVersion", 1);
    NEW."updatedVersion" := NEW."syncVersion";
    RETURN NEW;
  END IF;

  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;

  NEW."syncVersion" := OLD."syncVersion" + 1;
  NEW."updatedVersion" := NEW."syncVersion";
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 지워진 행의 자리표.
--
-- 프로젝트 자체가 지워지는 중이면 남기지 않는다. 그 프로젝트를 볼 기기가 없고,
-- Tombstone 에는 FK가 없어 남으면 찌꺼기가 된다.
CREATE OR REPLACE FUNCTION sync_tombstone() RETURNS TRIGGER AS $$
DECLARE pid TEXT; v INTEGER;
BEGIN
  pid := to_jsonb(OLD) ->> 'projectId';
  IF pid IS NULL THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Project" WHERE id = pid) THEN RETURN NULL; END IF;

  v := sync_next_version(pid);
  IF v IS NULL THEN RETURN NULL; END IF;

  INSERT INTO "Tombstone" ("entity", "entityId", "projectId", "deletedVersion")
  VALUES (TG_TABLE_NAME, OLD.id, pid, v)
  ON CONFLICT ("entity", "entityId")
  DO UPDATE SET "deletedVersion" = EXCLUDED."deletedVersion";

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 월 조정의 자리표. 부모가 cascade 로 함께 지워지는 중이면 남기지 않는다
-- (부모를 읽을 수 없고, 부모의 자리표를 받은 기기가 자기 쪽에서 함께 지운다).
CREATE OR REPLACE FUNCTION sync_tombstone_via_budget() RETURNS TRIGGER AS $$
DECLARE pid TEXT; v INTEGER;
BEGIN
  SELECT b."projectId" INTO pid FROM "Budget" b WHERE b.id = OLD."budgetId";
  IF pid IS NULL THEN RETURN NULL; END IF;

  v := sync_next_version(pid);
  IF v IS NULL THEN RETURN NULL; END IF;

  INSERT INTO "Tombstone" ("entity", "entityId", "projectId", "deletedVersion")
  VALUES (TG_TABLE_NAME, OLD.id, pid, v)
  ON CONFLICT ("entity", "entityId")
  DO UPDATE SET "deletedVersion" = EXCLUDED."deletedVersion";

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 도장 트리거
CREATE TRIGGER sync_stamp_project BEFORE INSERT OR UPDATE ON "Project"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp_project();

CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "ProjectMember"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "Person"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "Account"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "Category"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "Card"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "Budget"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "ExchangeRate"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "BudgetOverride"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp_via_budget();

-- 자리표 트리거.
-- 사람·계좌·카드·카테고리는 화면에서 소프트 삭제(isActive=false)를 쓰지만, 정리
-- 스크립트나 손으로 지우는 경로가 있으므로 함께 걸어 둔다. 비용은 없고, 빠뜨리면
-- 기기에 유령 행이 남는다.
CREATE TRIGGER sync_tombstone AFTER DELETE ON "ProjectMember"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "Person"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "Account"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "Category"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "Card"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "Budget"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "ExchangeRate"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "BudgetOverride"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone_via_budget();
