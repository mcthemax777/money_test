-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "updatedHlc" TEXT;

-- CreateTable
CREATE TABLE "MutationLog" (
    "mutationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSeq" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resultJson" JSONB,
    "appliedVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MutationLog_pkey" PRIMARY KEY ("mutationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MutationLog_clientId_clientSeq_key" ON "MutationLog"("clientId", "clientSeq");

-- CreateIndex
CREATE INDEX "MutationLog_projectId_createdAt_idx" ON "MutationLog"("projectId", "createdAt");

-- ─────────────────────────────────────────────
-- 명령 로그와 병합 시계
-- ─────────────────────────────────────────────
--
-- MutationLog 에는 도장 트리거를 걸지 않는다. 동기화 대상이 아니기 때문이다. 기기가
-- 자기 명령의 결과를 아는 길은 push 응답이지 변경 피드가 아니다. 여기에 도장을 찍으면
-- 명령을 보낼 때마다 프로젝트 번호가 올라 다른 기기가 헛되이 pull 하게 된다.
--
-- updatedHlc 는 JournalEntry 에만 둔다. 2단계가 다루는 것이 전표 명령뿐이고, 전표는
-- 다리까지 통째로 한 단위라 필드별 병합을 쓰지 않기 때문이다 (설계 문서의 D5).
-- 설정 엔티티의 필드별 병합은 3단계에서 그 표들에 시계를 더할 때 온다.
--
-- 이미 있는 전표는 null 로 둔다. "시계가 없는 쪽이 언제나 이르다"가 비교 규칙이라
-- (types 의 compareHlc), 예전 전표는 어떤 편집에도 자리를 내준다. 그 편이 맞다 --
-- 2단계 이전에는 모든 편집이 서버를 거쳤으므로 충돌이 있을 수 없었다.
