# bboyong - 가계부 애플리케이션

TypeScript 모노레포 기반의 풀스택 가계부 애플리케이션입니다.

## 📦 프로젝트 구조

```
money/
├── packages/
│   ├── types/          # 공유 타입 정의
│   ├── api/            # Node.js + NestJS 백엔드
│   ├── web/            # Next.js 웹 프론트엔드 (예정)
│   └── mobile/         # Expo React Native 모바일 (예정)
├── docker-compose.yml  # 로컬 개발 환경
└── turbo.json         # 빌드 오케스트레이션
```

## 🚀 시작하기

### 필수 요구사항

- Node.js >= 18.0.0
- pnpm >= 8.0.0
- Docker & Docker Compose (선택사항)

### 1. 설치

```bash
pnpm install
```

### 2. 로컬 개발 환경 시작 (Docker)

```bash
docker-compose up -d
```

### 3. 데이터베이스 마이그레이션

```bash
cd packages/api
pnpm prisma migrate dev --name init
```

### 4. API 서버 실행

```bash
pnpm api:dev
```

서버는 `http://localhost:3001`에서 실행됩니다.

**API 문서:** `http://localhost:3001/api/docs`

## 📊 기술 스택

### 공유 (Shared)
- **TypeScript 5.3** - 타입 안전성
- **pnpm workspace** - 모노레포 패키지 관리
- **Turbo** - 빌드 오케스트레이션

### 백엔드 (API)
- **NestJS 10** - 프레임워크
- **Prisma 5** - ORM + 마이그레이션
- **PostgreSQL 16** - 데이터베이스
- **Redis 7** - 캐싱 및 세션
- **JWT** - 인증
- **Swagger** - API 문서화

### 프론트엔드 (예정)
- **Next.js 14** - 웹 프레임워크
- **React 18** - UI 라이브러리
- **Expo 50** - 모바일 앱
- **React Native** - 모바일 UI

## 🏗️ 아키텍처

### 대규모 서비스 지원 설계

1. **모듈화된 구조**
   - Auth, Users, Accounts, Categories, Transactions, Budgets 모듈
   - 각 모듈은 독립적으로 확장 가능

2. **데이터베이스 최적화**
   - 인덱싱: userId, accountId, categoryId 등
   - 쿼리 최적화를 위한 관계 설정
   - Prisma를 통한 타입 안전한 쿼리

3. **캐싱 전략**
   - Redis 통합
   - 사용자 데이터, 카테고리 등 자주 사용되는 데이터 캐싱

4. **보안**
   - JWT 기반 인증
   - 비밀번호 암호화 (bcrypt)
   - CORS 설정
   - 입력 검증

5. **로깅 및 모니터링**
   - 구조화된 로깅
   - 요청/응답 로깅 인터셉터
   - 전역 예외 처리

6. **확장성**
   - 마이크로서비스 전환 가능한 구조
   - Bull 큐를 통한 비동기 작업
   - 레이트 리미팅 (준비됨)

## 📝 API 엔드포인트

### Health Check
```
GET /health
```

### 인증 (예정)
```
POST /auth/signup
POST /auth/signin
POST /auth/refresh
POST /auth/logout
```

### 사용자 (예정)
```
GET /users/me
PATCH /users/me
```

### 계좌 (예정)
```
GET /accounts
POST /accounts
GET /accounts/:id
PATCH /accounts/:id
DELETE /accounts/:id
```

### 거래 (예정)
```
GET /transactions
POST /transactions
GET /transactions/:id
PATCH /transactions/:id
DELETE /transactions/:id
```

### 카테고리 (예정)
```
GET /categories
POST /categories
GET /categories/:id
PATCH /categories/:id
DELETE /categories/:id
```

### 예산 (예정)
```
GET /budgets
POST /budgets
GET /budgets/:id
PATCH /budgets/:id
DELETE /budgets/:id
```

## 🔧 개발 명령어

```bash
# 전체 빌드
pnpm build

# 개발 서버 실행
pnpm dev

# 테스트
pnpm test

# 린트
pnpm lint

# 타입 체크
pnpm type-check

# API 서버만 빌드
pnpm api:build

# API 서버 개발 모드
pnpm api:dev

# Prisma 마이그레이션
cd packages/api
pnpm prisma migrate dev
pnpm prisma generate
```

## 🗄️ 데이터베이스

### 마이그레이션 생성

```bash
cd packages/api
pnpm prisma migrate dev --name <migration_name>
```

### 마이그레이션 상태 확인

```bash
cd packages/api
pnpm prisma migrate status
```

### 프로덕션 마이그레이션

```bash
cd packages/api
pnpm prisma migrate deploy
```

## 🧪 테스트

```bash
# 단위 테스트
pnpm test

# 커버리지
pnpm test:cov

# Watch 모드
pnpm test:watch
```

## 📦 배포

### EC2 배포 (PM2)

```bash
cd /opt/money_test
./scripts/deploy.sh            # 일반 배포. 데이터는 유지된다
./scripts/deploy.sh --reset    # DB를 비우고 새로 세팅. 되돌릴 수 없다
```

직접 실행할 때는 순서를 지켜야 한다.

```bash
git pull origin main
pm2 stop ecosystem.config.js

cd packages/api
npx prisma migrate deploy      # --reset 대신 데이터를 지키는 쪽
npx prisma generate            # 스키마에서 만들어지는 타입. 건너뛰면 빌드 실패

cd ..                          # 반드시 루트에서 빌드한다
npx turbo run build --concurrency=1

pm2 start ecosystem.config.js && pm2 save
```

**루트에서 빌드해야 하는 이유**: `packages/types/dist`는 저장소에 없다(gitignore).
`packages/api`를 먼저 빌드하면 옛 `dist`를 읽어
`Property 'issuerId' does not exist` 같은 오류가 난다.
turbo가 `dependsOn`으로 types → api/web 순서를 잡아 준다.
`--concurrency=1`은 메모리 부족으로 빌드가 죽는 것을 막는다.

PM2 프로세스 이름은 `money-api`, `money-web`이다 (`ecosystem.config.js`).

### Docker로 배포

```bash
docker-compose -f docker-compose.yml up -d
```

### 환경 변수 설정

`.env.production.local` 파일을 생성하고 다음 값들을 설정합니다:

```env
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=<32자 이상. openssl rand -base64 48 로 생성>
CORS_ORIGIN=<your-domain>
```

## 📖 다음 단계

1. [ ] Auth 모듈 구현
2. [ ] Users 모듈 구현
3. [ ] Accounts 모듈 구현
4. [ ] Categories 모듈 구현
5. [ ] Transactions 모듈 구현
6. [ ] Budgets 모듈 구현
7. [ ] Next.js 웹 프론트엔드 구축
8. [ ] Expo 모바일 앱 구축
9. [ ] 통합 테스트
10. [ ] 프로덕션 배포

## 📄 라이선스

MIT
