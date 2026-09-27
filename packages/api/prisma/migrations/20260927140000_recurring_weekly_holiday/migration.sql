-- 반복 등록: 주별(요일들)과 휴일 처리.
--
-- weekdays 는 주별이 고른 요일(0 일요일 ~ 6 토요일), holidayRule 은 휴일에 걸린 회차를
-- 그대로 둘지(none)·건너뛸지(skip)·앞/뒤 평일로 옮길지(before/after)다. 기존 규칙은
-- 지금처럼 그날 그대로 만든다.
ALTER TABLE "RecurringRule" ADD COLUMN "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "RecurringRule" ADD COLUMN "holidayRule" TEXT NOT NULL DEFAULT 'none';
