-- 다른 금융 앱이 보낸 알림의 원문(표본)과 그것으로 배운 앱별 문구 규칙.
--
-- 표본은 기기가 알림을 모을 때 돈 표기가 있는 것을 올린다(후보가 되지 못한 것도).
-- 관리 도구에서만 읽고, 지우는 기한이 없다. 계정을 지우면 함께 지운다.
CREATE TABLE "NotificationSample" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "packageName" TEXT NOT NULL,
    "title" TEXT,
    "text" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "sampleKey" TEXT NOT NULL,
    "parsed" JSONB,
    "deviceName" TEXT,
    "appVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSample_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationSample_userId_sampleKey_key" ON "NotificationSample"("userId", "sampleKey");
CREATE INDEX "NotificationSample_packageName_postedAt_idx" ON "NotificationSample"("packageName", "postedAt");
CREATE INDEX "NotificationSample_postedAt_idx" ON "NotificationSample"("postedAt");

ALTER TABLE "NotificationSample" ADD CONSTRAINT "NotificationSample_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 기기가 내려받아 기존 규칙보다 먼저 대 보는 앱별 규칙. 관리 도구에서 만든다.
CREATE TABLE "NotificationRule" (
    "id" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "segments" JSONB NOT NULL,
    "kind" TEXT,
    "currency" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "learnedFrom" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NotificationRule_packageName_idx" ON "NotificationRule"("packageName");
