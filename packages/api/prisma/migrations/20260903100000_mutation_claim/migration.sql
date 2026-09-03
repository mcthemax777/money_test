-- 명령 로그를 "먼저 잡고 재생하는" 표로 바꾼다.
--
-- 전에는 조회한 뒤에 재생하고 마지막에 기록했다(check-then-act). 한 프로세스 안에서는
-- 겹칠 일이 드물었지만, 인스턴스를 여럿 두면 기기가 다시 보낸 같은 명령이 서로 다른
-- 인스턴스에 동시에 닿는다. 그때 둘 다 "본 적 없다"로 읽고 둘 다 재생했다.
-- 전표 만들기는 기본 키가 막아 주지만, 막힌 쪽이 rejected 로 기록되어 실제로는 적용된
-- 거래가 기기에서 거절로 보였다.
--
-- 이제는 행을 먼저 INSERT 해서 잡는다(status='running'). 잡지 못한 요청은 재생하지 않는다.
ALTER TABLE "MutationLog" ADD COLUMN "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 이미 있는 기록은 잡은 시각을 만든 시각으로 본다. 전부 판정이 끝난 행이라
-- 넘겨받기 대상이 되지 않는다.
UPDATE "MutationLog" SET "claimedAt" = "createdAt";

-- 넘겨받을 행을 고르는 질의가 쓴다 (status='running' 이고 오래된 것).
CREATE INDEX "MutationLog_status_claimedAt_idx" ON "MutationLog"("status", "claimedAt");
