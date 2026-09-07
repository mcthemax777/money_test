-- 순서 값은 바이트 순서로 비교한다.
--
-- `sortRank` 는 분수 색인이고, `@money/types` 의 rank 는 문자 집합 `0-9A-Za-z` 가 곧
-- 아스키 순서라는 것에 기대어 산다 -- 사전순 비교가 그대로 목록 순서라는 전제다
-- (rank.ts 의 머리 주석). 그런데 Postgres 의 `ORDER BY` 와 `MAX()` 는 컬럼의 정렬
-- 규칙을 따르고, 그 기본값은 데이터베이스의 것이다.
--
-- RDS(glibc)의 `en_US.UTF-8` 은 대소문자를 섞어 놓는다. 같은 여섯 값이 이렇게 갈렸다.
--
--   RDS            a e K O S W
--   기기 사본       K O S W a e   (SQLite 는 정렬 규칙이 없어 바이트 순서다)
--
-- 그래서 두 가지가 어긋났다.
--
--   1. **표시 순서.** 같은 값을 웹과 앱이 다른 차례로 그린다. 드래그로 고칠 수도 없다 --
--      웹의 재정렬은 받은 차례대로 `initialRanks` 를 찍는데, 그 결과를 되돌려 읽는
--      `ORDER BY` 가 다시 흩뜨려 놓는다.
--   2. **새 항목의 자리.** `rankAfter(MAX(sortRank))` 의 `MAX` 가 바이트 최대값이
--      아닌 것을 고른다. 그 뒤를 계산한 값은 목록 맨 뒤가 아니라 중간에 떨어진다.
--
-- 컬럼에 `COLLATE "C"` 를 박으면 어느 환경에서도 바이트 순서다. 로컬 도커의
-- alpine(musl)은 이름이 `en_US.utf8` 이어도 이미 그렇게 동작해, 이 차이가 로컬에서는
-- 드러나지 않았다. 환경에 기대는 자리를 없애는 것이 이 마이그레이션의 요점이다.
--
-- Prisma 는 컬럼의 정렬 규칙을 모형에 담지 않는다(`migrate diff` 가 빈 마이그레이션을
-- 낸다). 그래서 스키마 쪽에서 이 문장이 사라지거나 드리프트로 잡히는 일은 없고,
-- 대신 손으로 적어 두어야 한다.
--
-- 값 자체는 손대지 않는다. 순서 규칙이 사본과 같아지면 두 화면의 어긋남은 그대로
-- 사라진다. 잘못된 `MAX` 로 중간에 떨어진 항목의 자리만 남는데, 그것은 그 묶음을 한 번
-- 끌어 옮기면 정리된다 (웹의 드래그가 묶음 전체를 `initialRanks` 로 다시 매긴다).
--
-- 표를 다시 쓰는 문장이라 `@@index([projectId, sortRank])` 도 함께 다시 세워진다.
-- 다섯 표 전부 작아(수십에서 수백 행) 배포 중 잠기는 시간은 짧다.
ALTER TABLE "Person" ALTER COLUMN "sortRank" TYPE TEXT COLLATE "C";
ALTER TABLE "Account" ALTER COLUMN "sortRank" TYPE TEXT COLLATE "C";
ALTER TABLE "Category" ALTER COLUMN "sortRank" TYPE TEXT COLLATE "C";
ALTER TABLE "Tag" ALTER COLUMN "sortRank" TYPE TEXT COLLATE "C";
ALTER TABLE "Card" ALTER COLUMN "sortRank" TYPE TEXT COLLATE "C";
