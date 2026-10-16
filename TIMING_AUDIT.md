# 타이밍·동시성 점검 (2026-10-16)

서버(api)·공용(core)·앱(app)·웹(web) 전부를 여섯 갈래로 나눠 코드를 끝까지 읽어 찾았다.
**동시에 요청을 쏘아 재현하지는 않았다.** 각 항목의 "확인" 표시는 다음 뜻이다.

- **직접 확인**: 정리하면서 해당 줄을 다시 열어 실패 순서가 코드대로 성립함을 확인했다.
- **코드 확인**: 점검 단계에서 끝까지 따라 읽어 성립했다. 정리 단계에서 다시 열지는 않았다.
- **가능성**: 경로는 실재하나 특정 타이밍이 필요하다. 재현 스크립트로 먼저 확인할 것.

`SYNC_CONFLICT_AUDIT.md`(A~L)에서 고친 것은 다시 적지 않았다.

---

## 진행 상태 (2026-10-16, 커밋 전)

사용자 지시로 "5. 권하는 순서"대로 고쳤다. **커밋하지 않았다.** 검사는 core·web·app·api 타입 검사(스크립트 포함),
core 스모크 전부, api 스모크 전부(HTTP 포함, 3999 서버)로 했다. 웹·앱 화면을 실제로 띄워 보지는 않았다.

| 항목 | 고친 내용 | 검사 |
| --- | --- | --- |
| 1-1 viewer 강등 | push 를 viewer 로 받고 역할이 모자라면 명령마다 `rejected`(`PROJECT_ROLE_VIEWER`) | sync-push 스모크 |
| 1-2 분류 합치기 | 갈 곳 없는 줄을 잠금 아래에서 다시 세고, 목록에 없는 소분류의 거래가 있으면 거절 | entry-concurrency 10 |
| 1-3 태그·분류 바꾸기 | `changeTags`·`changeCategory` 첫 문장에 `lockLedgerWrites` | entry-concurrency 9 (재현은 못 함) |
| 1-4 웹 통장 편집 | 잔액을 바꿨을 때만 싣는다 (앱과 같다) | 타입 |
| 1-5 projectId 누락 | 분류 바로 만들기·구성원 추가·카드 만들기와 목록 다시 받기에 고른 가계부를 싣는다 | 타입 |
| 갱신 응답 유실 | 서버: 후계 토큰이 한 번도 안 쓰였으면 받아 주고 후계를 교체됨으로 적는다(탐지는 늦을 뿐 남음) | auth 스모크 |
| 5xx·429·426 로그아웃 | `isSessionEnded` -- 401 일 때만 세션을 지운다 (갱신 길·`loadUser`) | 타입 |
| 로그아웃 뒤 갱신 | `authEpoch` -- 갱신 중 세션이 바뀌면 돌아온 토큰을 버린다 | 타입 |
| 배포 중 요청 | `main.ts` 가 SIGINT·SIGTERM 에 받던 요청을 3.5초까지 마치고 나간다 | 실제 SIGINT 로 확인 |
| 예산 중복 | 유일 색인은 **쓰지 않았다**(끝난 규칙과 새 규칙이 같은 시작 달 null 을 가질 수 있음). `lockBudgetWrites` + 편집기 ref 가드 | entry-concurrency 8 (고치기 전 4건 → 1건) |
| 앱 페이백 이중 저장 | 앱 편집기 저장·지우기에 ref 가드, 페이백까지 단추를 막는다 | 타입 |
| 홈 달 | `useViewMonth` -- 이번 달을 보던 화면만 달이 넘어가면 따라간다 (앱·웹) | 타입 |
| 사본 트랜잭션 | 단독 쓰기(putDraft·forgetDraftOp·discardMutation·setMirrorFloor)를 트랜잭션 줄에, 사본 쓰기 실패 시 `withdrawMutation` | core 스모크 |
| 재생 replace 시계 | 견준 판을 `baseHlc` 로 넘겨 잠금 아래 다시 보고, 바뀌었으면 다시 견준다 | sync-push·convergence |
| 소유자 넘기기·나가기·내보내기 | `lockMembershipWrites` | ownership-transfer (재현은 못 함) |
| 결제 웹훅 순서 | 구매 전에 온 환불·되돌림·연장은 503 으로 다시 보내게 | billing-webhook |
| pull 5초 | 받기 트랜잭션 30초 | 타입 |
| 계좌 만들기 | 잔액 세우기가 실패하면 통장도 거둔다 | 타입 |
| 필드 시계 | `mergeFieldClocks` -- jsonb `||` 로 바꾼 필드만 합친다 (통장·카드·태그·구성원·분류) | entry-concurrency 11 (고치기 전 5/5 실패) |
| 보관함 처리 순서 | 밀어 올리기 **뒤**·받기 앞에 보내고, 오류가 나도 다음 처리로 간다 | core 스모크 |
| 동기화 합치기·다시 시도 | 시작 전 동기화는 합치고(`waiting`), 모든 결과를 `onSyncSettled` 로 OfflineSync 가 듣는다 | 타입 |
| 웹 다른 탭 로그아웃 | 표시 쿠키를 본 적 있는 탭이 그것을 잃으면 로그인 화면으로 | 타입 |
| 웹 거래 만들기 재시도 | 첫 시도의 id 를 성공할 때까지 쓰고, 409 면 그 거래를 지금 값으로 고친다 | 타입 |
| 웹 자산 화면 늦은 응답 | 효과 정리에서 버린다 | 타입 |
| 가계부 만들기·초대·요청 중복 | 훅에 ref 가드(`useProjectAdmin`·`useProjectMembership`·`useProjectStart`) | 타입 |
| 엑셀 가져오기 | 요청 60초, 이중 실행 가드 | 타입 |
| 선택 범위 옛 id | 묻는 사이 조건이 바뀌면 답을 버린다 | 타입 |
| 프로젝트 전환 늦은 응답 | `useLatestCall` (분류·태그·반복·보관함·월별 예산) | 타입 |
| 환율 캐시 | 모든 화면이 함께 보는 `mirrorChangeCount` 로 판을 적는다 | 타입 |
| 거래 탭 로딩 표시 | 받기는 적은 자리에서 지우고, 조건이 바뀌면 표시를 비운다 | 타입 |
| 더 보기 중복 | `pagingRef` (통장·카드 원장) | 타입 |
| 앱 기타 | 반복 규칙 저장 가드, 알림 권한 AppState 재확인, `clearOffline` 단일 실행, 시작 화면 로그아웃 가드, 알림 모으기가 기다린 뒤 가계부·세션을 다시 봄 | 타입 |

**이어서 고친 것 (같은 날 2차).**

| 항목 | 고친 내용 | 검사 |
| --- | --- | --- |
| 환율 확정 재생 시계 | `restateForeignEntry` 가 재생 시계를 잠금 아래에서 다시 견주고, 늦은 편집이 있으면 전체를 되돌려 충돌. 트랜잭션 15초 | sync-push |
| 숨긴 통장·카드 | 원장 잠금 아래 `assertTargetsActive` -- 전표가 **새로** 가리키는 숨긴 통장·카드만 거절(`ACCOUNT_INACTIVE`·`CARD_INACTIVE`, 3개 언어 문구). 이미 쓰던 거래는 고칠 수 있다 | entry-concurrency 12 (고치기 전 6건 실패) |
| 가입 승인·거절·취소 | 대기 중일 때만 잡는 조건부 쓰기 + 구성원 잠금. `ensureMyPerson` 도 구성원 잠금 | ownership-transfer (고치기 전 Prisma 오류 = 500) |
| 실시간 신호 | 프로젝트 고치기·초대 수락·승인·나가기·내보내기가 `recordProjectWrite` | 타입 |
| 할부 환불 회차 (서버만) | 원장 잠금 아래 `checkInstallmentCutUnderLock` -- 같은 트랜잭션으로 계획과 걸린 환불을 다시 읽어 음수 회차면 거절. 재생은 건너뜀 | payback (고치기 전 겹친 두 환불 모두 통과) |

**남긴 것.** 사본 읽기(`all`)가 남의 트랜잭션 안에서 반쯤 적용된 값을 읽는 것, 푸시 등록이 로그아웃과 겹치는 것,
할부 환불 검사의 기기 쪽(오프라인 두 기기가 같은 회차를 줄이면 서버가 받아 둔다 -- 의도), 그 밖의 "3. 낮음" 일부.

---

## 1. 높음 -- 먼저 고칠 것

### 1-1. viewer 로 내려간 기기는 영영 pull 하지 못한다 (직접 확인)
- 서버 `api/src/modules/sync/mutation-replay.service.ts:157` 가 push 요청 전체를 `editor` 로 검사하고,
  `common/project-access.guard.ts:56` 은 **코드 없는** `ForbiddenException` 을 던진다.
  주석("전부 거절되고 보류 칸에 남긴다")과 달리 명령 하나하나가 아니라 요청 통째로 403 이다.
- 기기 `core/src/data/sync-engine.ts:323` 은 오프라인이 아닌 오류를 그대로 던져 `syncProject` 가 pull 전에 멈춘다.
  `app/src/offline.ts:205` `isAccessLost` 는 코드 붙은 403 만 보므로 여기 걸리지 않고, `OfflineSync` 가 5~60초 간격으로 영원히 재시도한다.
- 순서: editor 일 때 오프라인으로 적음 → viewer 로 강등 → 접속. 이후 사본이 얼어붙고 화면은 멀쩡해 보인다.
- 같은 이유로 **오프라인이 아닌 지속 오류(400·413·5xx)** 가 push 에서 나면 pull 도 멈춘다.
- 방향: 권한 부족을 명령별 `rejected` 로 돌려주거나(주석의 의도), 기기가 push 실패와 상관없이 pull 은 하도록.

### 1-2. 갈 곳 없는 분류 합치기가 남의 거래 다리를 지운다 (직접 확인)
- `api/src/modules/categories/categories.service.ts:242` 가 사용 건수를 **트랜잭션 밖**(`this.prisma.posting.count`)에서 세고,
  트랜잭션 안(`:263` 이후)에서는 다시 세지 않고 `category.deleteMany` 한다. `Posting.category` 는 Cascade.
- 순서: A 가 거래 0건인 분류 X 를 "지우기만"으로 합침 → 세기 통과 → B 가 X 로 지출을 커밋 → A 트랜잭션이 X 삭제 → B 의 분류 다리만 사라짐.
  통장 잔액은 B 의 금액을 그대로 들고 있어 전표가 맞지 않는다. 오류는 없다.
- 방향: `lockLedgerWrites` 뒤에서 다시 센다.

### 1-3. `changeCategory`·`changeTags` 가 원장 잠금을 잡지 않는다 (직접 확인)
- `api/src/modules/entries/entries.service.ts:231`(changeTags), `:441`(changeCategory) 의 트랜잭션에 `lockLedgerWrites` 가 없다.
- changeTags: `replaceEntry` 가 잠금 아래 `baseHlc` 를 확인한 뒤 `saveTags`(전부 지우고 다시 넣기)하기 전에 끼어들면,
  방금 붙인 태그가 `ENTRY_MODIFIED` 없이 사라진다 -- 옛 점검 B 가 막으려던 바로 그 손실이다.
- changeCategory: 지우는 중인 분류로 다리를 옮길 수 있다. `deleteCategory` 가 잠금 아래 0건을 센 뒤 이 쪽이 커밋하면 1-2 와 같은 손실(가능성).
- 둘 다 다리·태그 행을 먼저, 프로젝트 행을 나중에 잠가 `replaceEntry` 와 순서가 엇갈린다 -- 교착으로 한쪽 500(가능성).
- 방향: 두 트랜잭션 첫 문장에 `lockLedgerWrites`.

### 1-4. 웹 통장 편집이 이름만 고쳐도 잔액을 옛 값으로 되돌린다 (직접 확인)
- `web/src/components/EditAccountModal.tsx:100` 이 언제나 `balance` 를 싣고, 서버 `accounts.service.ts:324` 가 그때마다 `setBalanceTo` 로 기초잔액을 다시 계산한다.
- 창은 `assets/page.tsx` 의 `selectedAccount` 스냅숏으로 채워지고, 실시간 신호로는 새로 고쳐지지 않는다.
- 순서: 다른 구성원이 이 통장으로 지출 → 이쪽이 편집을 열어 이름만 바꿔 저장 → 기초잔액이 고쳐져 그 지출이 잔액에서 사라진 것처럼 된다.
  미래 날짜 전표가 창을 연 사이 오늘이 되어도 같다.
- 방향: 잔액이 바뀐 때만 싣는다. 나아가 "열 때 본 잔액"을 함께 보내 서버가 어긋나면 거절.

### 1-5. 웹 일부 호출이 `projectId` 를 빼 서버 기본 가계부에 쓴다 (직접 확인)
- 쓰기: `web/src/components/EntryEditor.tsx:2044·2052`(분류 바로 만들기), `PersonModal.tsx:61`(구성원 추가).
- 읽기 후 목록 교체: `EntryEditor.tsx:2060`, `PersonModal.tsx:72`, `EditCardModal.tsx:138`.
- 서버는 `projectId` 가 없으면 `user.defaultProjectId` 를 쓴다. 초대 수락·첫 목록 고르기·다른 탭의 전환이 이 값과 화면의 가계부를 어긋나게 한다.
- 결과: 분류·사람이 다른 가계부에 만들어지고, 화면 목록이 다른 가계부의 것으로 바뀐다.

---

## 2. 중간

### 로그인·세션
- **갱신 응답을 잃으면 60초 뒤 로그인 묶음 전체가 끊긴다** (직접 확인). `api/src/modules/auth/auth.service.ts:264` 가 `rotatedAt` 을 먼저 적고 응답을 만든다.
  응답이 시간 초과(10초)·연결 끊김으로 사라지면 기기는 옛 토큰을 들고 있고, 60초(`ROTATION_GRACE_MS`) 넘어 다시 쓰면 재사용으로 보고 묶음을 끊는다. 모바일에서 흔하다.
  앱의 SecureStore 쓰기가 기다리지 않는 것(`app/src/token-storage.ts:32`)도 같은 결과를 낸다(프로세스가 그 사이 죽을 때).
- **갱신이 5xx·429·404 로 실패해도 로그아웃** (직접 확인). `core/src/lib/api-client.ts:273` 이 오프라인·426 이 아니면 `clearSession()`.
  서버 refresh 는 교체 후 `buildAuthResponse`(초기 데이터 질의 9개)를 돌므로 일시적 DB 오류가 500 이 된다. `/auth/refresh` 는 IP 당 분당 30회라 같은 공인 IP 를 쓰는 가족·통신사 NAT 에서 429 가 난다.
- **앱 시작 시 강제 업데이트(426)가 로그아웃시킨다** (직접 확인). `core/src/store/auth.ts:251` `loadUser` 는 오프라인일 때만 토큰을 남긴다. 갱신 경로(`api-client.ts:268`)는 426 을 일부러 빼 두었는데 이쪽은 빠졌다. `getProfile` 의 5xx 도 마찬가지.
- **웹 탭이 세션 종료를 모른다** (코드 확인). `api-client.ts:236` 이 `bb_session` 이 없으면 401 을 조용히 넘긴다. 다른 탭 로그아웃 뒤 이 탭은 로그인된 척 모든 호출이 실패하고, 다른 사용자로 로그인하면 옛 사용자 화면에 새 쿠키가 실린다.

### 서버
- **배포 때마다 진행 중 요청이 죽는다** (직접 확인: 훅 없음). `main.ts` 에 `enableShutdownHooks()` 도 SIGINT 처리도 없다. pm2 reload 가 SIGINT 를 보내면 Node 는 곧바로 끝난다.
  `/sync/push` 가 재생은 커밋하고 `settle` 전에 죽으면 로그 행이 "running" 으로 남아 60초 뒤 넘겨받기가 같은 명령을 다시 재생한다(`entry.replace`·`account.balance` 는 그 사이 편집을 덮을 수 있음).
  방향: `app.enableShutdownHooks()` + `server.close()` 로 받던 요청을 끝내고 나가기, pm2 `kill_timeout` 안에서.
- **재생된 `entry.replace`·`entry.restate` 의 시계 비교가 잠금 밖** (코드 확인). `mutation-replay.service.ts:560-588·757`. 두 기기의 재생이나 그 사이 온라인 편집을 늦은 쪽이 시계와 상관없이 덮고 둘 다 "applied".
- **RevenueCat 이벤트가 뒤바뀌어 오면 버린다** (코드 확인). `plans/billing-webhook.service.ts:140-178`. 환불이 구매보다 먼저 오면 "ignored" 200, 이어 온 구매가 권한을 준다 -- 환불한 사람이 계속 유료. `SUBSCRIPTION_EXTENDED` 도 같다.
- **소유자 확인이 잠금 없이** (코드 확인). `projects.service.ts:515` `leaveProject`(마지막 소유자 검사가 트랜잭션 밖), `:625` `transferOwnership`(FOR UPDATE 없음). 소유자 없는 가계부나 소유자 둘이 생길 수 있다.
- **pull 트랜잭션이 Prisma 기본 5초 제한** (가능성). `sync.service.ts:58`. 큰 첫 동기화가 매번 시간 초과로 같은 요청을 되풀이할 수 있다.
- **설치 할부 환불의 회차 잔액 확인이 잠금 밖** (코드 확인). 같은 줄에 두 환불이 동시에 오면 한 회차를 음수까지 깎는다.
- **분류·전체 예산 중복 규칙** (직접 확인). 유일 색인 `(projectId, categoryId, tagId, type, effectiveFrom)` 에서 `tagId`(분류 예산), `categoryId`·`tagId`(전체 예산)가 NULL 이라 PostgreSQL 이 서로 다르게 본다. `createBudget` 의 P2002 처리는 이 둘에 대해 죽은 코드다.
  앱 `BudgetEditModal.tsx:96`·웹 `BudgetScheduleList.tsx:118` 의 Enter 가 저장 중 검사를 건너뛰어 실제로 두 번 들어갈 수 있다. 방향: `NULLS NOT DISTINCT` 색인(PG15+) 또는 부분 색인.
- **숨기기 선행조건이 반쪽** (코드 확인). 쓰기 경로가 `isActive` 를 보지 않고 `createCard`·`createAccount` 는 잠금이 없다. 숨긴 통장·카드에 잔액이 생길 수 있다.
- **엑셀 가져오기가 재시도에 안전하지 않다** (코드 확인). 300줄을 한 요청에 순서대로, 클라이언트 id·전체 트랜잭션 없이. 시간 초과 후 다시 누르면 그 묶음이 두 번 들어간다.
- **`createAccount` 가 계좌 생성과 `setBalanceTo` 를 따로** (코드 확인). 두 번째가 실패하면 잔액 0 계좌가 남고 같은 id 재시도는 409.
- **`fieldHlc` 읽고-고쳐-쓰기가 잠금·트랜잭션 밖** (코드 확인). `updateAccount`·`updateCard`·`retireCard`·`updatePerson`·`updateTag`·`updateCategory`·예산 규칙. 다른 필드 동시 편집에서 한쪽 시계를 잃어, 나중에 더 오래된 오프라인 편집이 이긴다.

### 기기 사본(앱)
- **expo-sqlite 트랜잭션에 남의 문장이 섞인다** (코드 확인 + 라이브러리 문서). `app/src/sqlite.ts:163-171` 의 `run`·`all` 은 트랜잭션 자물쇠를 거치지 않는다.
  `withTransactionAsync` 는 배타적이지 않아, 그 사이 들어온 `putDraft`(헤드리스 알림 작업이 부름, `local-store.ts:1827`)·`discardMutation`·`forgetDraftOp`·`forgetRow` 등이 그 트랜잭션 안에서 돈다. 그 트랜잭션이 되돌려지면 성공을 돌려받은 쓰기가 함께 사라지고, 화면은 반쯤 적용된 pull 을 읽을 수 있다.
- **명령 큐 넣기와 사본 쓰기가 다른 트랜잭션** (코드 확인). `core/src/data/local-entry-writer.ts:231-248`, `local-settings-writer.ts:104-117·134-147`. 사본 쓰기가 던지거나 그 사이 앱이 죽으면 화면은 실패인데 명령은 나간다 → 다시 저장하면 거래가 둘.
- **보관함 "등록"이 거래보다 먼저 서버에 간다** (코드 확인). `sync-engine.ts:106-112` 가 후보 처리를 outbox 보다 먼저 보내 `ENTRY_NOT_FOUND`(400). 다른 구성원은 그동안 후보를 대기로 보고 또 등록할 수 있고, 거래 명령이 보류되면 그 프로젝트의 후보 처리가 전부 막힌다.
- **저장·서버 신호로 시작한 동기화는 실패해도 다시 잡지 않는다** (코드 확인). `offline.ts:112·361`. 재시도는 `OfflineSync` 의 `run` 만 건다.
- **동기화 요청을 합치지 않는다** (코드 확인). `offline.ts:295`. 앱 엑셀 가져오기 N 줄이면 전체 동기화 N 번.

### 화면
- **앱 거래 편집: 페이백 저장 중 다시 누르면 페이백이 둘** (직접 확인). `app/src/components/EntryEditor.tsx:360` -- `form.save()` 가 `isSubmitting` 을 풀고 나서 `paybackDrafts.saveFor` 를 부른다. 웹은 전체를 감싸 안전.
- **앱 홈의 달이 달이 바뀌어도 그대로** (직접 확인). `app/src/screens/HomeScreen.tsx:59` `useState` 첫 값. 탭 화면이 살아 있어(keep-alive) 다시 마운트되지 않는다. 웹 `home/page.tsx:63` 도 비슷.
- **거래 탭 선택 범위에 옛 검색 결과의 id 가 섞임** (가능성). `core/src/hooks/useTransactions.ts:1895-1951·2106-2129` 가 `scopeKeyRef` 를 보지 않는다. 고른 것과 보이는 것이 달라 `deleteSelected` 가 안 보이는 거래를 지울 수 있다.
- **웹 자산 화면이 가계부 전환 뒤 옛 가계부 자료를 보일 수 있다** (코드 확인). `assets/page.tsx:506-539` `loadData` 에 늦은 응답 가드 없음.
- **웹 가계부 설정 버튼 중복 클릭** (코드 확인). `settings/projects/page.tsx:334`(가계부 만들기 → 둘), `:641`(초대 링크 둘), `:424`(참여 요청).

---

## 3. 낮음 (묶음)

- **서버**: 가입·승인 때 같은 "나" 구성원을 두 번 잡음(`projects.service.ts:198`), `approveJoinRequest` 트랜잭션 없음(이중 승인 500),
  `createProject` 네 번 따로 씀, 계정 삭제 검사가 잠금 없이, 로그아웃 순간 갱신이 새 토큰을 찍음, 오래된 잡기 넘겨받기와 원래 요청의 P2002 경합,
  push 폴러와 대량 후보 쓰기의 잠금 순서(교착 500), 일부 쓰기(프로젝트 이름·시간대, 초대 수락·승인·내보내기·나가기)가 실시간 신호를 안 냄,
  문의 `getMine` 이 읽은 뒤 들어온 답을 읽음 처리, 인스턴스별 캐시(앱 버전 30초·공휴일 5분), 알림 원문 일일 상한 count-then-insert,
  `withBalancesAsOf` 두 문장 읽기, `adminGrant` 가 트랜잭션 안에서 RevenueCat 호출, `paybackLink` 체인 재검사 없음, `settleRates` 기본 5초 제한, 태그 합치기 중 붙은 태그.
- **공용 훅**: 프로젝트 전환 후 늦은 응답 가드 없음(`useCategoryManager`·`useTagManager`·`useRecurringRules`·`useEntryDrafts`(배지까지)·`useBudgetSchedule`·`useProjectMembership`),
  `usePersonFilterSync` 가 옛 가계부 사람 id 를 새 가계부에 저장, "더 보기" 같은 쪽 두 번(`useAccountLedger`·`useCardEntries`·`useCardPeriodLedger`),
  환율 캐시가 화면마다 0부터 세는 버전으로 맞춤(`useExchangeRates.ts:20`), 옛 범위 로더의 `finally` 가 새 범위의 로딩 표시를 지움(`useTransactions.ts:1172`),
  가계부 만든 직후 늦은 목록이 선택을 되돌림(`useProjectBootstrap.ts:50`), 로그아웃 뒤 끝난 갱신이 토큰을 되살림(`api-client.ts:335`), 이름 오프라인 반영이 새 이름을 덮음.
- **앱**: 시작 화면 로그아웃 두 번 누르면 사본 지우기 경합, 저장 버튼들이 ref 가드 없이 state 만 봄(반복 규칙은 확인 창 둘), 드래그 정렬이 옛 목록 기준,
  알림 권한 재확인이 1.5초 고정 타이머, 결제 창 닫은 뒤 폴링 계속, 문의 배지 순서 없음·로그아웃 뒤 되살아남,
  `collectNotificationsSoon` 이 첫 프로젝트를 고정, 1분 넘어 다시 뜬 같은 알림이 새 후보, 로그아웃 중 푸시 토큰 등록이 끝나 서버에 남음.
- **기기 사본**: 후보 처리를 큐 밖에서 보내 새 처리가 지워짐(`forgetDraftOp` 가 id 로만), 같은 묶음 지체 없이 최대 12번 재전송, 중간 실패 시 화면 알림 없음,
  긴 첫 pull 중 로컬 편집이 잠깐 되돌아감, 접근 끊김 정리가 큐 밖, 스키마 재구성 사이 "no such table", SSE close 대기 누수.
- **웹**: 카드 실적·대기 환율 패널이 카드별 가드 없음, 문의 폴링이 방금 보낸 답을 숨김, 관리자 화면(문의·공휴일·이용권·알림 규칙)의 늦은 응답·마지막 쓰기 승리,
  강제 업데이트 화면이 잠깐 사라짐, 탭끼리 고른 가계부 덮어쓰기, 재접속·탭 복귀마다 전체 재조회, 배포 후 청크 로드 실패 새로고침이 실제로 도는지 미확인.

---

## 4. 제대로 되어 있는 것 (건드리다 깨뜨리지 말 것)

- 서버: `replaceEntry`·`deleteEntry`·`restateForeignEntry`·`setBalanceTo` 의 잠금과 잠금 뒤 `baseHlc` 비교, 원자적 증감, 숨기기·삭제 경로의 잠금 아래 검사,
  후보·반복 생성의 `dedupeKey` 유일, pull 상한·커서, MutationLog 잡기, 이용권 `grant` 멱등, 푸시 후보 잡기, 레디스 요청 상한 Lua, SSE 신호는 커밋 뒤, 초대 수락 1회, 첫 구글 로그인 P2002 처리.
- 기기: `tx-lock` FIFO, 동기화 단일 큐, 명령의 mutationId·clientSeq 멱등과 순서, 커서와 행을 같은 트랜잭션에, 닫기 가드, 신호는 커밋 뒤.
- 클라이언트: 갱신 단일 비행, 서버 60초 유예로 탭 둘 동시 갱신, 고정 머리글 CSRF, LiveSync 연결 하나·백오프·재접속 따라잡기, 웹 거래 편집 Enter 포함 잠금,
  대부분 공용 훅의 늦은 응답 가드, "오늘"은 렌더·로드마다 계산, 헤드리스 작업과 UI 가 같은 JS 런타임(토큰·DB·클라이언트 하나).

---

## 5. 권하는 순서

1. 1-1(viewer 강등 시 동기화 정지), 1-4(통장 편집 잔액 덮기) -- 실제 사용 중 조용히 틀어진다.
2. 1-2·1-3(분류 합치기 재검사, changeCategory·changeTags 잠금) -- 각 한두 줄.
3. 세션 셋(갱신 응답 유실, 5xx·429 로그아웃, 시작 시 426 로그아웃) -- 사용자가 자주 겪을 수 있다.
4. 1-5(projectId 누락), 종료 훅, 예산 유일 색인, 앱 페이백 이중 저장, 앱 홈 달.
5. 기기 사본의 트랜잭션 경계(sqlite run/all 자물쇠, 큐+사본 한 트랜잭션).
