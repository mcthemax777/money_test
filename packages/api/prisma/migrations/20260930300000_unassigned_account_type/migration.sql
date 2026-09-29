-- 결제수단을 고르지 않은 지출·수입의 상대편 계정 유형.
--
-- 새 enum 값은 그 값을 넣는 문장과 한 트랜잭션에 둘 수 없어(커밋 전에는 쓸 수 없다)
-- 채우는 일은 다음 마이그레이션(20260930300100_unassigned_accounts)이 한다.
ALTER TYPE "AccountType" ADD VALUE IF NOT EXISTS 'unassigned';
