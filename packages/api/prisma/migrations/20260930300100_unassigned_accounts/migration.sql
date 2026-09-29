-- 프로젝트마다 미지정 계정 하나.
--
-- 지출·수입에서 결제수단을 비워 두면 조립(@money/types 의 entry-build)이 이 계정에 붙인다.
-- 기기도 오프라인에서 같은 전표를 만들어야 하므로 미리 만들어 동기화로 내려보낸다.
-- 새 프로젝트는 ProjectsService.createProject 가 함께 만든다.
--
-- 통화는 저장 통화다. 사용자가 고른 수단이 없으니 청구 통화도 장부 통화로 본다.
INSERT INTO "Account" ("id", "projectId", "ownerId", "type", "name", "currency", "updatedAt")
SELECT gen_random_uuid()::text, p."id", NULL, 'unassigned', '미지정', p."ledgerCurrency", NOW()
  FROM "Project" p
 WHERE NOT EXISTS (
   SELECT 1 FROM "Account" a WHERE a."projectId" = p."id" AND a."type" = 'unassigned'
 );

-- 하나뿐이어야 한다. 둘이면 검색·수단별이 유형으로 찾는 자리에서 어느 쪽인지 갈리지 않는다.
CREATE UNIQUE INDEX "Account_unassigned_per_project"
  ON "Account" ("projectId") WHERE "type" = 'unassigned';
