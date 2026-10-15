-- 동기화가 가계부별로 고르는 표의 (부모 열쇠, 번호) 색인. 번호만의 색인은 모든 가계부의 행을 훑는다.
CREATE INDEX "AssetValuation_accountId_updatedVersion_idx" ON "AssetValuation"("accountId", "updatedVersion");
CREATE INDEX "BudgetOverride_budgetId_updatedVersion_idx" ON "BudgetOverride"("budgetId", "updatedVersion");

-- 알림 표본의 하루 한도(사람별 최근 24시간)와 90일 정리.
CREATE INDEX "NotificationSample_userId_createdAt_idx" ON "NotificationSample"("userId", "createdAt");
CREATE INDEX "NotificationSample_createdAt_idx" ON "NotificationSample"("createdAt");
