-- 반복 등록. 정해 둔 날마다 보관함에 후보가 만들어지는 규칙.
--
-- 거래를 만들지 않는다. 만드는 것은 후보(EntryDraft)이고, 사용자가 보관함에서 눌러야
-- 전표가 된다.
--
-- 이 표는 규칙만 담는다. 회차를 만드는 일은 기기가 하고(알림·캡처 후보와 같은 길),
-- 서버는 (프로젝트, dedupeKey) 유일 제약으로 겹침만 막는다. 그래서 "어디까지
-- 만들었는가"를 적는 칸이 없다 -- 그 답은 후보 자신(`r:<규칙>:<날짜>`)에 있다.
--
-- 날짜를 TEXT 로 담는다("YYYY-MM-DD"). 이 값들은 인스턴트가 아니라 프로젝트 타임존의
-- 달력 날짜다. timestamp 로 두면 UTC 로 저장되며 시간대에 따라 하루씩 밀려서,
-- "매월 25일"이 24일이나 26일이 되는 자리가 생긴다.
CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    -- daily | monthly | yearly
    "frequency" TEXT NOT NULL,
    "everyDays" INTEGER,
    "dayOfMonth" INTEGER,
    "month" INTEGER,

    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "timeOfDay" TEXT,

    "kind" TEXT NOT NULL,
    "amount" DECIMAL(18,4),
    "currency" TEXT,
    "description" TEXT NOT NULL,
    "merchant" TEXT,
    "personId" TEXT,
    "categoryId" TEXT,
    "accountId" TEXT,
    "cardId" TEXT,
    "installmentMonths" INTEGER,

    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

-- 켜져 있는 반복을 찾는 길. 보관함을 열 때 기기가 이 목록을 읽는다.
CREATE INDEX "RecurringRule_projectId_isActive_idx" ON "RecurringRule"("projectId", "isActive");

ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 후보가 어느 반복에서 왔는지.
--
-- 반복을 지워도 이미 만들어진 후보는 남긴다(SetNull). 사용자가 아직 처리하지 않았을 수
-- 있고, 그것까지 사라지면 "어제 만들어진 것이 왜 없지"가 된다.
ALTER TABLE "EntryDraft" ADD COLUMN "recurringRuleId" TEXT;
CREATE INDEX "EntryDraft_recurringRuleId_idx" ON "EntryDraft"("recurringRuleId");
ALTER TABLE "EntryDraft" ADD CONSTRAINT "EntryDraft_recurringRuleId_fkey"
    FOREIGN KEY ("recurringRuleId") REFERENCES "RecurringRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 후보를 반복별로 찾는 길. 서버가 "이 반복이 어디까지 만들었는가"를 셀 때 쓴다.
--
-- RecurringRule 에는 동기화 트리거를 걸지 않는다. 반복은 드물게 손대는 설정이라
-- 서버에서 곧바로 읽고 쓴다(REST). 기기 사본에 두지 않으므로 변경 번호도 자리표도
-- 필요 없다. 만들어진 후보는 EntryDraft 라서 그쪽 트리거를 그대로 탄다.
