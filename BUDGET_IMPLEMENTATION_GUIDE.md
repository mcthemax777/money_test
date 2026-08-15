# 예산 기능 및 권한 확인 구현 가이드

## 완료된 작업

### 1. Schema 수정
- `User` 모델에 `defaultProjectId` 추가
- 마이그레이션 필요: `npx prisma migrate dev --name add_default_project_id`

### 2. 권한 확인 유틸리티
**파일**: `src/common/project-access.guard.ts`

제공하는 메서드:
- `verifyUserHasAccessToProject(userId, projectId)` - 접근 권한 확인
- `verifyUserRole(userId, projectId, requiredRole)` - 역할별 권한 확인
- `getDefaultProjectId(userId)` - 기본 프로젝트 조회 (defaultProjectId → owner 프로젝트)
- `resolveAndVerifyProjectId(userId, projectId)` - projectId 해석 + 권한 확인

### 3. 기본 프로젝트 변경 API
**엔드포인트**: `PATCH /users/me/default-project`

```bash
curl -X PATCH http://localhost:3000/users/me/default-project \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "proj_123" }'

응답:
{
  "id": "user_123",
  "email": "user@example.com",
  "name": "사용자명",
  "defaultProjectId": "proj_123",
  "defaultProject": {
    "id": "proj_123",
    "name": "프로젝트명"
  }
}
```

---

## 모든 v2 모듈에 권한 확인 적용하기

### 패턴

**1단계: Module에 ProjectAccessService 주입**
```typescript
// transactions.module.ts
import { Module } from '@nestjs/common';
import { ProjectAccessService } from '@/common/project-access.guard';

@Module({
  imports: [DatabaseModule, AccountsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, ProjectAccessService],
  exports: [TransactionsService, ProjectAccessService],
})
export class TransactionsModule {}
```

**2단계: Service에서 ProjectAccessService 사용**
```typescript
// transactions.service.ts
import { ProjectAccessService } from '@/common/project-access.guard';

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createTransaction(
    userId: string,
    dto: TransactionDto.CreateRequest,
    projectIdParam?: string,
  ): Promise<any> {
    // 기본 프로젝트 해석 + 권한 확인 (한 줄로)
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || (dto as any).projectId,
    );

    // 나머지 로직...
    const account = await this.prisma.account.findUnique({
      where: { id: dto.accountId },
    });

    if (!account || account.userId !== userId) {
      throw new NotFoundException('유효한 통장이 아닙니다.');
    }

    // 거래 생성...
  }
}
```

---

## 적용해야 할 모듈 목록

다음 모듈들에 `ProjectAccessService` 주입 필요:

1. **TransactionsModule** (`v2/transactions`)
   - `createTransaction` ✅
   - `getTransactions` ✅
   - `getTransactionById` ✅
   - `updateTransaction` ✅
   - `deleteTransaction` ✅
   - `getStatistics` ✅

2. **CardsModule** (`v2/cards`)
   - `createCard` ✅
   - `getCards` ✅
   - `getCardById` ✅
   - `updateCard` ✅
   - `deleteCard` ✅
   - `useCard` ✅
   - `payCard` ✅

3. **AccountsModule** (`v2/accounts`)
   - `createAccount` ✅
   - `getAccounts` ✅
   - `getAccountById` ✅
   - `updateAccount` ✅
   - `deleteAccount` ✅

4. **CategoriesModule** (`v2/categories`)
   - `createCategory` ✅
   - `getCategories` ✅
   - `getCategoryById` ✅
   - `updateCategory` ✅
   - `deleteCategory` ✅
   - `getCategoryTree` ✅

5. **PeopleModule** (`v2/people`)
   - `createPerson` ✅
   - `getPeople` ✅
   - `getPersonById` ✅
   - `updatePerson` ✅
   - `deletePerson` ✅

6. **BudgetsModule** (새로 생성)
   - 모든 Budget API에 권한 확인 적용

---

## 예산 API 구현 (다음 단계)

### 테이블 구조

```prisma
model Budget {
  id            String    @id @default(cuid())
  projectId     String
  userId        String
  categoryId    String?
  monthlyAmount Float
  effectiveFrom String?   // "YYYY-MM"
  effectiveTo   String?
  
  project       Project   @relation(...)
  user          User      @relation(...)
  category      Category? @relation(...)
  overrides     BudgetOverride[]
  
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  
  @@index([projectId, userId])
  @@unique([projectId, userId, categoryId, effectiveFrom])
}

model BudgetOverride {
  id        String    @id @default(cuid())
  budgetId  String
  year      Int
  month     Int
  amount    Float
  
  budget    Budget    @relation(...)
  
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  
  @@unique([budgetId, year, month])
}
```

### API 엔드포인트

```
POST   /v2/budgets                          - 예산 규칙 생성
GET    /v2/budgets?projectId=xxx           - 예산 규칙 목록
PATCH  /v2/budgets/:budgetId               - 예산 규칙 수정
DELETE /v2/budgets/:budgetId               - 예산 규칙 삭제

GET    /v2/budgets/:year/:month            - 특정 월 예산 (오버라이드 포함)

POST   /v2/budgets/override                - 월별 오버라이드 생성
PATCH  /v2/budgets/override/:overrideId    - 월별 오버라이드 수정
DELETE /v2/budgets/override/:overrideId    - 월별 오버라이드 삭제
```

---

## 권한 확인 적용 체크리스트

### TransactionsModule
- [ ] TransactionsModule에 ProjectAccessService 추가
- [ ] TransactionsService에서 `resolveAndVerifyProjectId` 사용
- [ ] 모든 메서드에 권한 확인 적용

### CardsModule
- [ ] CardsModule에 ProjectAccessService 추가
- [ ] CardsService에서 `resolveAndVerifyProjectId` 사용

### AccountsModule
- [ ] AccountsModule에 ProjectAccessService 추가
- [ ] AccountsService에서 `resolveAndVerifyProjectId` 사용

### CategoriesModule
- [ ] CategoriesModule에 ProjectAccessService 추가
- [ ] CategoriesService에서 `resolveAndVerifyProjectId` 사용

### PeopleModule
- [ ] PeopleModule에 ProjectAccessService 추가
- [ ] PeopleService에서 `resolveAndVerifyProjectId` 사용

### BudgetModule (새로 생성)
- [ ] Schema 작성 (Budget, BudgetOverride)
- [ ] BudgetModule 생성
- [ ] BudgetService 작성 (ProjectAccessService 포함)
- [ ] BudgetController 작성
- [ ] DTO 작성 (BudgetDto)

---

## 마이그레이션 명령어

```bash
# User 스키마 업데이트 마이그레이션
npx prisma migrate dev --name add_default_project_id

# Budget 테이블 추가 마이그레이션 (나중에)
npx prisma migrate dev --name add_budget_tables

# 데이터베이스 상태 확인
npx prisma studio
```
