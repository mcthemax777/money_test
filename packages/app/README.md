# @money/app

안드로이드·iOS 앱 (Expo, React Native). 화면만 여기 있고 그 아래는 전부 `@money/core`
를 그대로 쓴다 (API 클라이언트, 계산, 서식, 사전, 스토어, 그리고 화면 로직 훅).

배치는 웹과 같다. 좁으면 위쪽 막대와 아래쪽 탭, 넓으면(md 이상) 왼쪽 사이드바다.
분류 화면은 lg 이상에서 지출·수입을 두 단으로 나란히 놓는다. 브레이크포인트 값도
웹의 tailwind 와 같은 값을 쓴다.

지금 있는 화면: 로그인, 홈, 가계, 자산, 카테고리, 설정, 내 정보, 프로젝트 관리.
아직 웹에만 있는 것은 그래프, 거래 추가·수정 폼, 기간 보기, 계좌·카드 추가와 수정,
멤버·초대·가입 요청, 예산 편집이다. 앱의 해당 자리에는 그 사실을 적어 두었다.

화면 로직은 core 의 훅에 있다 (`useHomeData`, `useLedgerData`, `useAssetsData`,
`useCategoryManager`, `useEntryFeed`, `useExchangeRates`, `useProjectAdmin`,
`useProjectBootstrap`). 웹의 같은 화면도 그 훅을 쓴다. 조회·계산·저장 규칙이 갈라지지
않게 하는 유일한 방법이다.

## 서버 주소

`src/api.ts` 의 `API_URL` 하나가 정한다. 지금은 배포 서버 `https://bboyong.online/api`
를 본다. 그 호스트는 앞단이 `/api` 로 오는 것만 API 로 넘기므로 `/api` 까지가 주소다.

이 맥의 서버(`http://172.30.1.5:3001`)를 보게 바꿀 때는 **같은 파일의
`GOOGLE_WEB_CLIENT_ID` 도 함께 바꿔야 한다.** 두 서버가 같은 구글 프로젝트의 서로
다른 웹 클라이언트를 쓰기 때문에, 짝이 어긋나면 구글은 토큰을 주는데 서버가 401 로
거절한다.

- 배포: `183293757909-5km72508a6ttn2bgk5il5p7neinejjv3...`
- 이 맥: `packages/api/.env` 의 `GOOGLE_CLIENT_IDS` 값

릴리스 빌드는 평문(http)을 쓰지 못한다. 출시본이라 막아 두었다. 로컬 서버를 볼 때는
디버그 빌드로 띄운다 (`pnpm --filter @money/app android`). 디버그 변형의 매니페스트는
템플릿이 평문을 열어 둔다.

## 로그인

평소에는 구글 로그인이다. 기기 계정으로 받은 ID 토큰을 서버(`POST /auth/google`)에
넘기면 앱의 토큰 한 쌍을 돌려준다. 웹과 같은 경로이고 서버는 고칠 것이 없다.

`webClientId` 로 넘기는 값(`src/api.ts` 의 `GOOGLE_WEB_CLIENT_ID`)이 서버의
`GOOGLE_CLIENT_IDS` 와 같아야 한다. 그래야 토큰의 aud 가 맞는다.

### 구글 콘솔에 한 번 해 둘 일

안드로이드 OAuth 클라이언트가 없으면 계정을 고른 뒤 DEVELOPER_ERROR(코드 10)로
끝난다. 콘솔에서 안드로이드 유형 클라이언트를 만들고 아래 둘을 넣는다.

- 패키지 이름: `online.bboyong.app`
- 서명 SHA-1: `E7:3E:6D:33:17:CE:76:A2:20:10:98:53:E7:5D:0C:75:E4:F0:39:07`
  (아래 "서명"의 우리 키. `apksigner verify --print-certs <apk>` 로 언제든 확인한다.)

템플릿의 디버그 키로는 등록할 수 없다. "Android 패키지 이름과 디지털 지문이 이미
사용 중"이라고 거절당한다. 그 키는 2014년에 만들어져 템플릿에 그대로 실려 있어
이 템플릿으로 만든 세상 모든 앱이 같은 지문을 쓰고, 누군가 같은 패키지 이름으로
이미 등록해 두었기 때문이다.

클라이언트 ID 자체는 코드에 적지 않는다. 구글이 패키지 이름과 지문으로 고른다.

### 개발용 토큰 (구글 로그인이 막혔을 때)

로그인 화면 아래 "개발용 토큰으로 들어가기" 를 펼치고 직접 서명한 액세스 토큰을
붙여 넣는다. 디버그 빌드에만 있다 (`__DEV__`). 출시본에는 그 자리가 없다.

### 출시할 때 (플레이 스토어)

플레이 앱 서명을 쓰면 구글이 우리 업로드 키 대신 **앱 서명 키**로 다시 서명한다.
그러면 지금 등록한 SHA-1 로는 로그인이 되지 않는다. 플레이 콘솔의 앱 서명 키 SHA-1
을 안드로이드 클라이언트에 함께 등록해야 한다. 개발용과 운영용 OAuth 클라이언트는
나눠 두고, 운영 클라이언트에는 localhost 원본을 넣지 않는다.

```bash
# 1) 서버와 DB
docker compose up -d
cd packages/api && node dist/main.js     # nest build 를 먼저

# 2) 토큰 (payload 는 { sub: User.id, type: 'access' }, 시크릿은 packages/api/.env 의 JWT_SECRET)
USER_ID=$(docker exec money_postgres psql -U postgres -d money_db -t -A -c 'select id from "User" limit 1')
JWT_DIR=$(find node_modules/.pnpm -maxdepth 1 -name "jsonwebtoken@*" | head -1)
SECRET=$(grep -m1 JWT_SECRET packages/api/.env | cut -d= -f2-)
node -e "console.log(require('$PWD/$JWT_DIR/node_modules/jsonwebtoken').sign({sub:'$USER_ID',type:'access'},'$SECRET',{expiresIn:'12h'}))"
```

## 실행

로컬 서버(http)를 보려면 디버그 빌드로 띄운다. 릴리스 빌드는 평문을 쓰지 못한다.
디버그도 아래 "서명"의 우리 키로 서명하므로 구글 로그인이 그대로 된다.

```bash
# 디버그 (Metro 가 함께 뜬다)
pnpm --filter @money/app start          # 다른 창에서 Metro
cd packages/app/android && ./gradlew assembleDebug
adb install app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:8081 tcp:8081           # 기기가 Metro 를 보게 한다

# 또는 한 번에
pnpm --filter @money/app android

# 네이티브 프로젝트 만들기 (android/ 는 저장소에 없다. 설정을 고치면 다시 만든다)
# 이름이 prebuild 가 아닌 것은, npm 이 build 앞에 prebuild 를 자동으로 끼워 넣기 때문이다
pnpm --filter @money/app native:android

# APK (credentials/ 가 있어야 우리 키로 서명된다. 아래 "서명" 참고)
export ANDROID_HOME=$HOME/Library/Android/sdk
export JAVA_HOME=$(/usr/libexec/java_home -v 17)
pnpm --filter @money/app apk
# 결과: packages/app/android/app/build/outputs/apk/release/app-release.apk

$ANDROID_HOME/platform-tools/adb install -r <위 경로>
```

## 서명

릴리스와 디버그 모두 `credentials/release.keystore` 로 서명한다. 디버그를 템플릿
키로 두면 그 지문은 콘솔에 등록할 수 없어(모든 Expo 앱이 공유한다) 개발 중에 구글
로그인이 막힌다. 키와 비밀번호
(`credentials/keystore.json`)는 저장소에 넣지 않는다. `android/` 는 prebuild 가 다시
만드는 자리라 그 안에 두면 사라지므로, `plugins/with-release-signing.js` 가 prebuild
때마다 키를 넣고 `build.gradle` 의 릴리스 서명 설정을 바꾼다. `credentials/` 가 없으면
템플릿의 디버그 키로 빌드되며, 그 APK 로는 구글 로그인이 되지 않는다.

**이 키를 잃어버리면 안 된다.** 새 키로 서명하면 지문이 달라져 구글 콘솔에 다시
등록해야 하고, 기기에 깔린 앱은 덮어 설치되지 않아 지웠다 깔아야 한다.

키를 새로 만들려면:

```bash
keytool -genkeypair -v -keystore credentials/release.keystore -alias money \
  -keyalg RSA -keysize 2048 -validity 10000
# 그리고 credentials/keystore.json 에 storePassword/keyAlias/keyPassword 를 적는다
```

## 이 저장소에서만 필요한 설정

- 루트 `.npmrc` 의 `public-hoist-pattern`: gradle 이 부르는 babel 이 프리셋을 이름으로
  찾는다. pnpm 기본 배치에서는 못 찾아 릴리스 번들링이 깨진다.
- `metro.config.js`: 워크스페이스 전체를 지켜보고, `react` 와 `react-native` 은 앱의 것
  하나만 쓰게 한다 (core 나 zustand 가 각자의 react 를 끌어오면 훅이 깨진다).
