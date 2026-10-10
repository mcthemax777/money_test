-- 거래한 사람을 비워 둘 수 있다 (미지정). 지금 있는 전표는 그대로 사람을 든다.
ALTER TABLE "JournalEntry" ALTER COLUMN "personId" DROP NOT NULL;
