-- 돌아온 돈의 종류 (PAYBACK_DESIGN.md 7-3). 'payback' | 'refund'.
--
-- 환불과 캐시백은 장부에서 같은 모양(지출 분류 -, 들어온 곳 +, 원거래 링크)이라 갈래를 나누지
-- 않고 이 칸으로 가른다. 카드 실적의 기본값과 화면의 이름만 이 값을 본다.
-- 이미 있는 페이백 행은 비워 둔다 -- 읽는 쪽이 페이백으로 본다.
ALTER TABLE "JournalEntry" ADD COLUMN "paybackType" TEXT;
