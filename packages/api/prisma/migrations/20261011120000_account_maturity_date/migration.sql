-- 정기예금·적금의 만기일. 자산 탭이 남은 날을 D-day 로 보여 준다.
--
-- 시각이 아니라 달력의 날("YYYY-MM-DD")이다. DATE 나 TIMESTAMP 로 담으면 직렬화가
-- 자정 UTC 의 시각이 되어, 기기 사본(문자열)과 모양이 갈리고 타임존에 따라 하루가 밀린다.
-- 공휴일(PublicHoliday.date)과 같은 방식이다.
ALTER TABLE "Account" ADD COLUMN "maturityDate" TEXT;
