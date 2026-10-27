-- 고양이 엠블럼 (@money/types 의 cats). 가계부가 얻은 고양이, 사람마다 데리고 다니는 고양이, 달 단위 미션을 센 자리.
-- CreateTable
CREATE TABLE "ProjectCat" (
    "projectId" TEXT NOT NULL,
    "breedId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectCat_pkey" PRIMARY KEY ("projectId","breedId")
);
-- CreateTable
CREATE TABLE "ProjectCatParade" (
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "breedIds" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectCatParade_pkey" PRIMARY KEY ("projectId","userId")
);
-- CreateTable
CREATE TABLE "ProjectCatState" (
    "projectId" TEXT NOT NULL,
    "monthlyCheckedThrough" TEXT,
    CONSTRAINT "ProjectCatState_pkey" PRIMARY KEY ("projectId")
);
-- AddForeignKey
ALTER TABLE "ProjectCat" ADD CONSTRAINT "ProjectCat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ProjectCatParade" ADD CONSTRAINT "ProjectCatParade_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ProjectCatParade" ADD CONSTRAINT "ProjectCatParade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ProjectCatState" ADD CONSTRAINT "ProjectCatState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
