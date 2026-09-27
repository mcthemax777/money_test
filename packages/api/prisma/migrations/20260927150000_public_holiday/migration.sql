-- 공휴일. 관리 도구에서 갱신한다. 서버가 처음 뜰 때 비어 있으면 스스로 한 번 채운다.
CREATE TABLE "PublicHoliday" (
    "country" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicHoliday_pkey" PRIMARY KEY ("country","date")
);
