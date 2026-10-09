-- 프로젝트 이용권 권한. 결제(또는 관리자 지급) 한 건이 한 줄이다.
-- 지금 상태는 줄들에서 계산한다. 프로젝트·사용자를 지워도 결제 기록은 남긴다(SET NULL).
CREATE TYPE "PlanId" AS ENUM ('lifetime', 'month1', 'month3', 'month6', 'month12');
CREATE TYPE "PlanGrantSource" AS ENUM ('admin', 'google_play', 'web');

CREATE TABLE "ProjectPlanGrant" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "userId" TEXT,
    "plan" "PlanId" NOT NULL,
    "source" "PlanGrantSource" NOT NULL,
    "externalId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KRW',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPlanGrant_pkey" PRIMARY KEY ("id")
);

-- externalId 가 null 인 줄(관리자 지급)은 서로 겹쳐도 된다. PostgreSQL 의 UNIQUE 는 null 을 서로 다르게 본다.
CREATE UNIQUE INDEX "ProjectPlanGrant_source_externalId_key" ON "ProjectPlanGrant"("source", "externalId");
CREATE INDEX "ProjectPlanGrant_projectId_startsAt_idx" ON "ProjectPlanGrant"("projectId", "startsAt");

ALTER TABLE "ProjectPlanGrant" ADD CONSTRAINT "ProjectPlanGrant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectPlanGrant" ADD CONSTRAINT "ProjectPlanGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
