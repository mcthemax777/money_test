# 로그인 플로우 및 프로젝트 초기 데이터 구현 가이드

## 완료된 작업

### 백엔드 ✅
1. **DTO 수정** (`packages/types/src/dtos.ts`)
   - `Auth.AuthResponse`에 `defaultProjectData` 추가
   - `ProjectInitialData` 인터페이스 추가

2. **AuthService 수정** (`packages/api/src/modules/auth/auth.service.ts`)
   - `signUp`: 회원가입 후 `defaultProjectData` 반환
   - `signIn`: 로그인 후 `defaultProjectData` 반환
   - `createDefaultProject`: 프로젝트 객체 반환

3. **UsersService 수정** (`packages/api/src/modules/users/users.service.ts`)
   - `getUserProjectInitialData`: 기본 프로젝트의 모든 초기 데이터 조회
   - `setDefaultProject`: 프로젝트 변경 + `defaultProjectData` 반환

4. **AuthModule** (`packages/api/src/modules/auth/auth.module.ts`)
   - `UsersModule` import 추가

### 웹 ✅
1. **API 클라이언트** (`packages/web/src/lib/api-client.ts`)
   - `setDefaultProject(projectId)` 메서드 추가

2. **Auth 스토어** (`packages/web/src/store/auth.ts`)
   - `defaultProjectData` 상태 추가
   - `signUp`, `signIn`, `setDefaultProject` 메서드 수정
   - 토큰 저장 + `defaultProjectData` 저장

---

## 응답 구조

### 로그인/가입 응답

```typescript
POST /auth/signin
또는
POST /auth/signup

응답:
{
  accessToken: "eyJhbGciOiJIUzI1NiIs...",
  refreshToken: "eyJhbGciOiJIUzI1NiIs...",
  user: {
    id: "user_123",
    email: "user@example.com",
    name: "사용자명",
    avatar: null,
    defaultProjectId: "proj_123"
  },
  defaultProjectData: {
    project: {
      id: "proj_123",
      name: "나의 프로젝트",
      description: "첫 번째 프로젝트"
    },
    cards: [...],           // Card 배열
    accounts: [...],        // Account 배열 (owner 정보 포함)
    categories: [...],      // Category 배열 (대분류, children 포함)
    people: [...],          // Person 배열
    recentTransactions: [...], // 최근 30개 Transaction
    budgets: [...]          // Budget 배열
  }
}
```

---

## 화면 구현 가이드

### 로그인 화면 후 처리

```typescript
// pages/login.tsx 또는 컴포넌트

import { useAuth } from '@/store/auth';
import { useRouter } from 'next/router';

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();

  const handleLogin = async (email: string, password: string) => {
    try {
      await signIn(email, password);
      // signIn 완료 후 자동으로 defaultProjectData가 저장됨
      
      // 대시보드로 이동
      router.push('/dashboard');
    } catch (error) {
      // 에러 처리
    }
  };

  return (
    // 로그인 폼...
  );
}
```

### 대시보드 초기화

```typescript
// pages/dashboard.tsx 또는 홈 화면

import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';

export default function Dashboard() {
  const { defaultProjectData, user } = useAuth();
  const { setSelectedProjectId } = useProject();

  useEffect(() => {
    if (defaultProjectData) {
      // 1. 기본 프로젝트 설정
      setSelectedProjectId(defaultProjectData.project.id);

      // 2. 초기 데이터 사용
      const { cards, accounts, categories, people, recentTransactions, budgets } = defaultProjectData;

      // 예: 각 스토어에 데이터 초기화
      // useCard.getState().setCards(cards);
      // useAccount.getState().setAccounts(accounts);
      // useCategory.getState().setCategories(categories);
      // usePeople.getState().setPeople(people);
      // useTransaction.getState().setTransactions(recentTransactions);
      // useBudget.getState().setBudgets(budgets);
    }
  }, [defaultProjectData]);

  if (!defaultProjectData) {
    return <div>로딩 중...</div>;
  }

  return (
    <div>
      <h1>환영합니다, {user?.name}님!</h1>
      <p>프로젝트: {defaultProjectData.project.name}</p>
      
      {/* 
        이제 모든 데이터가 준비됨
        cards, accounts, categories 등을 직접 사용 가능
      */}
    </div>
  );
}
```

### 프로젝트 변경

```typescript
// 프로젝트 선택 드롭다운 또는 프로젝트 전환 버튼

import { useAuth } from '@/store/auth';
import { useProject } from '@/store/project';

export function ProjectSwitcher() {
  const { setDefaultProject, defaultProjectData } = useAuth();
  const { setSelectedProjectId } = useProject();

  const handleProjectChange = async (projectId: string) => {
    try {
      // 프로젝트 변경 + 데이터 로드
      await setDefaultProject(projectId);
      
      // setDefaultProject 완료 후 defaultProjectData가 새로 갱신됨
      // 화면이 자동으로 리렌더링되고 새 데이터 표시
      setSelectedProjectId(projectId);
    } catch (error) {
      console.error('프로젝트 변경 실패:', error);
    }
  };

  return (
    <select onChange={(e) => handleProjectChange(e.target.value)}>
      <option value={defaultProjectData?.project.id}>
        {defaultProjectData?.project.name}
      </option>
      {/* 다른 프로젝트 옵션... */}
    </select>
  );
}
```

---

## 데이터 흐름

```
1. 로그인 화면
   ↓
2. signIn() 호출
   ↓
3. API: POST /auth/signin
   ← 응답: { accessToken, refreshToken, user, defaultProjectData }
   ↓
4. auth 스토어 업데이트
   - user 저장
   - defaultProjectData 저장
   - 토큰 쿠키 저장
   ↓
5. 대시보드로 이동
   ↓
6. defaultProjectData 사용해서 화면 렌더링
   - 프로젝트명 표시
   - 카드/계좌 목록
   - 카테고리 트리
   - 최근 거래 내역
   - 예산 정보
```

---

## 프로젝트 변경 흐름

```
1. 프로젝트 드롭다운에서 다른 프로젝트 선택
   ↓
2. setDefaultProject(projectId) 호출
   ↓
3. API: PATCH /users/me/default-project { projectId }
   ↓
4. 백엔드:
   - projectId가 사용자에게 속하는지 확인
   - User.defaultProjectId 업데이트
   - 해당 프로젝트의 모든 초기 데이터 로드
   ↓
5. 응답: { user, defaultProjectData }
   ↓
6. auth 스토어 업데이트
   - user 업데이트 (defaultProjectId 변경)
   - defaultProjectData 업데이트 (새 프로젝트 데이터)
   ↓
7. 화면 자동 갱신
   - 새 프로젝트의 데이터 표시
```

---

## 체크리스트

### 백엔드
- [x] DTO 수정 (Auth.AuthResponse)
- [x] AuthService.signUp 수정
- [x] AuthService.signIn 수정
- [x] UsersService.getUserProjectInitialData 추가
- [x] UsersService.setDefaultProject 수정
- [x] AuthModule에 UsersModule import

### 웹
- [x] API 클라이언트에 setDefaultProject 추가
- [x] Auth 스토어 수정 (signUp, signIn, setDefaultProject)
- [x] Auth 스토어에 defaultProjectData 상태 추가

### 다음 단계
- [ ] 로그인 화면 컴포넌트 업데이트 (signIn 호출)
- [ ] 대시보드 컴포넌트 업데이트 (defaultProjectData 사용)
- [ ] 프로젝트 드롭다운 컴포넌트 구현
- [ ] 각 데이터 스토어 (card, account, category 등) 초기화 로직 추가
- [ ] 마이그레이션 실행: `npx prisma migrate dev --name add_default_project_id`
- [ ] 로컬 개발 서버 재시작

---

## 주의사항

1. **마이그레이션 필수**
   ```bash
   npx prisma migrate dev --name add_default_project_id
   ```

2. **로그인 후 추가 API 호출 불필요**
   - defaultProjectData를 사용하면 됨
   - cards, accounts, categories 등을 별도로 로드할 필요 없음

3. **프로젝트 변경 시**
   - 단일 API 호출로 모든 데이터 변경 가능
   - 기존 프로젝트 데이터는 자동으로 새 데이터로 교체됨

4. **성능 최적화**
   - recentTransactions은 30개로 제한 (필요시 조정 가능)
   - 대용량 데이터는 필요시 별도 페이지에서 로드
