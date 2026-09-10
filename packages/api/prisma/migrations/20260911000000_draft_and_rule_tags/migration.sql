-- 후보와 반복 등록에 태그를 붙인다.
--
-- 다리 표로 둔다(전표의 EntryTag 와 같은 짜임). id 배열로 들고 있으면 지운 태그의
-- id 가 남고, 그 후보를 거래로 적을 때 서버가 TAG_NOT_IN_PROJECT 로 거절한다 --
-- 사람은 폼에서 그 태그를 볼 수 없어 무엇을 빼야 할지 알 수 없다. 다리 표에
-- Cascade 를 걸어 두면 태그를 지우는 순간 그 연결이 함께 사라진다.
--
-- 반복 -> 후보 -> 전표 로 이어진다. 반복에 붙여 둔 태그를 그 반복이 만드는 후보가
-- 그대로 받고, 후보를 거래로 적을 때 폼의 태그 칸이 그것으로 채워진다.

CREATE TABLE "EntryDraftTag" (
    "draftId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "EntryDraftTag_pkey" PRIMARY KEY ("draftId","tagId")
);

CREATE INDEX "EntryDraftTag_tagId_idx" ON "EntryDraftTag"("tagId");

ALTER TABLE "EntryDraftTag" ADD CONSTRAINT "EntryDraftTag_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "EntryDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EntryDraftTag" ADD CONSTRAINT "EntryDraftTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "RecurringRuleTag" (
    "ruleId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "RecurringRuleTag_pkey" PRIMARY KEY ("ruleId","tagId")
);

CREATE INDEX "RecurringRuleTag_tagId_idx" ON "RecurringRuleTag"("tagId");

ALTER TABLE "RecurringRuleTag" ADD CONSTRAINT "RecurringRuleTag_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "RecurringRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecurringRuleTag" ADD CONSTRAINT "RecurringRuleTag_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
