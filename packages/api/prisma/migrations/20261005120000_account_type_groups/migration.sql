-- 자산 탭을 넷으로 묶기 위한 계좌 유형 (바로 쓸 돈 · 모으는 돈 · 투자 · 대출).
-- deposit 은 이제 입출금 통장만 뜻한다. 정기예금은 time_deposit 으로 따로 둔다.
-- 이미 있는 deposit 계좌는 옮기지 않는다 -- 어느 쪽인지 알 수 없어 사람이 고친다.
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'time_deposit';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'cma';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'point_pay';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'pension';
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'crypto';
