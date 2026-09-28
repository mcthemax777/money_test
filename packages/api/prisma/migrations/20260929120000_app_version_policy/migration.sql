-- 앱·웹의 버전 정책. 강제 업데이트(minVersion)와 권유(latestVersion).
--
-- 줄이 없으면 둘 다 없는 것이라, 이 마이그레이션만으로는 아무도 막히지 않는다.
CREATE TABLE "AppVersionPolicy" (
    "platform" TEXT NOT NULL,
    "minVersion" TEXT,
    "latestVersion" TEXT,
    "storeUrl" TEXT,
    "message" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppVersionPolicy_pkey" PRIMARY KEY ("platform")
);
