-- 자산 엔티티의 필드별 병합 시계.
--
-- 필드 이름 -> HLC 지도를 행에 함께 둔다. 행 하나에 시계 하나만 두면, 나중에 도착한
-- 편집이 자기가 건드리지도 않은 필드까지 이기거나 자기 필드마저 지는 일이 생긴다
-- (설계 문서의 D5, @money/types 의 field-merge).
--
-- 기존 행은 null 로 둔다. 시계가 없는 필드는 어떤 명령이든 이기므로, 3단계 이전에
-- 만들어진 값이 오프라인 편집을 막는 일은 없다.
ALTER TABLE "Person" ADD COLUMN "fieldHlc" JSONB;
ALTER TABLE "Account" ADD COLUMN "fieldHlc" JSONB;
ALTER TABLE "Card" ADD COLUMN "fieldHlc" JSONB;
