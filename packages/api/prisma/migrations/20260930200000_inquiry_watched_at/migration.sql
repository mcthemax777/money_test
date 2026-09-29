-- 사용자가 문의 목록이나 대화를 화면에 띄워 두고 마지막으로 물은 시각.
-- 막 당겨졌으면 관리자의 답을 푸시하지 않는다(화면에 곧바로 선다).
ALTER TABLE "Inquiry" ADD COLUMN "userWatchedAt" TIMESTAMP(3);
