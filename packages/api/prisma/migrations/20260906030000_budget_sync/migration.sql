-- 예산도 오프라인에서 고칠 수 있게 한다 (3단계).
--
-- 예산 행은 필드별로, 월 조정은 (년, 월) 키별로 늦은 값이 이긴다 (설계 문서의 D5).
-- 다른 달을 고친 두 편집은 애초에 충돌이 아니다 -- 각자 자기 행을 갖기 때문이다.
ALTER TABLE "Budget" ADD COLUMN "fieldHlc" JSONB;
ALTER TABLE "BudgetOverride" ADD COLUMN "fieldHlc" JSONB;
