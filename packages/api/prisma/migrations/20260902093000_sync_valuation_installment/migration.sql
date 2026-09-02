-- AlterTable
ALTER TABLE "AssetValuation" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "InstallmentPlan" ADD COLUMN     "updatedVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "AssetValuation_updatedVersion_idx" ON "AssetValuation"("updatedVersion");

-- CreateIndex
CREATE INDEX "InstallmentPlan_updatedVersion_idx" ON "InstallmentPlan"("updatedVersion");

-- ─────────────────────────────────────────────
-- 변경 피드에 두 표를 더한다
-- ─────────────────────────────────────────────
--
-- 왜 이 둘인가. 기기가 사본만으로 그리지 못하던 자리가 여기서 비롯됐다.
--
--   - AssetValuation 이 없으면 투자 계좌를 장부 잔액으로 세게 되어 총자산이 틀리고
--     미실현손익이 0으로 나온다.
--   - InstallmentPlan 이 없으면 목록에서 "3개월 할부"가 사라지고, 신용카드의 주기별
--     사용액이 구매한 달에 전액 몰린다.
--
-- 회차(InstallmentCharge)와 청구서(CardStatement)는 더하지 않는다. 총액과 개월수에서
-- 다시 계산되는 파생값이고, 청구 주기는 마감일 설정으로 그때그때 계산한다 (설계 문서 D7).
--
-- 두 표 모두 projectId 컬럼이 없어 부모를 거쳐 찾는다. BudgetOverride 가 Budget 을
-- 거치는 것과 같은 방식이고, 함수를 표마다 따로 두는 이유도 같다 (부모가 다르다).

-- 이미 있는 데이터를 1번으로 채운다. 트리거를 만들기 전에 해야 한다.
--
-- 앞 마이그레이션이 나머지 표를 1로 채웠으므로 여기서도 1을 쓴다. 그래야 since=0 으로
-- 처음 동기화하는 기기가 모든 표를 한 번에 받는다. 이미 쓰고 있는 기기는 커서가 1 이상
-- 이라 이 행들을 받지 못하는데, 스키마 번호가 올라 사본을 처음부터 다시 받는다
-- (packages/core/src/data/schema.ts 의 SCHEMA_VERSION).
UPDATE "AssetValuation" SET "updatedVersion" = 1;
UPDATE "InstallmentPlan" SET "updatedVersion" = 1;

-- 계좌를 거쳐 프로젝트를 찾는 도장.
CREATE OR REPLACE FUNCTION sync_stamp_via_account() RETURNS TRIGGER AS $$
DECLARE pid TEXT; v INTEGER;
BEGIN
  SELECT a."projectId" INTO pid FROM "Account" a WHERE a.id = NEW."accountId";
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

-- 다리와 전표를 거쳐 프로젝트를 찾는 도장.
CREATE OR REPLACE FUNCTION sync_stamp_via_posting() RETURNS TRIGGER AS $$
DECLARE pid TEXT; v INTEGER;
BEGIN
  SELECT e."projectId" INTO pid
    FROM "Posting" p JOIN "JournalEntry" e ON e.id = p."entryId"
   WHERE p.id = NEW."postingId";
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

-- 지워진 평가액의 자리표.
--
-- 계좌가 cascade 로 함께 지워지는 중이면 남기지 않는다. 부모를 읽을 수 없고, 계좌의
-- 자리표를 받은 기기가 자기 쪽에서 딸린 행을 함께 지운다 (sync_tombstone_via_budget 과 같다).
CREATE OR REPLACE FUNCTION sync_tombstone_via_account() RETURNS TRIGGER AS $$
DECLARE pid TEXT; v INTEGER;
BEGIN
  SELECT a."projectId" INTO pid FROM "Account" a WHERE a.id = OLD."accountId";
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

-- 지워진 할부 계획의 자리표.
--
-- 전표 수정(replaceEntry)은 다리를 통째로 지우고 다시 만들므로 계획도 cascade 로
-- 사라진다. 그때 부모가 이미 없어 자리표가 남지 않는데, 그래도 된다. 기기는 전표를
-- 통째로 갈아 끼우면서 옛 다리에 걸린 계획을 함께 지우기 때문이다
-- (packages/core/src/data/local-store.ts 의 전표 교체).
CREATE OR REPLACE FUNCTION sync_tombstone_via_posting() RETURNS TRIGGER AS $$
DECLARE pid TEXT; v INTEGER;
BEGIN
  SELECT e."projectId" INTO pid
    FROM "Posting" p JOIN "JournalEntry" e ON e.id = p."entryId"
   WHERE p.id = OLD."postingId";
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

CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "AssetValuation"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp_via_account();
CREATE TRIGGER sync_stamp BEFORE INSERT OR UPDATE ON "InstallmentPlan"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp_via_posting();

CREATE TRIGGER sync_tombstone AFTER DELETE ON "AssetValuation"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone_via_account();
CREATE TRIGGER sync_tombstone AFTER DELETE ON "InstallmentPlan"
  FOR EACH ROW EXECUTE FUNCTION sync_tombstone_via_posting();
