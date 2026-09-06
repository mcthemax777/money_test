#!/usr/bin/env bash
#
# EC2 배포 스크립트.
#
#   ./scripts/deploy.sh           일반 배포. 데이터는 그대로 두고 마이그레이션만 적용한다.
#   ./scripts/deploy.sh --reset   데이터베이스를 비우고 새로 세팅한다. 되돌릴 수 없다.
#
# 순서를 지켜야 하는 이유가 넷 있다.
#
#  1. packages/types/dist 는 저장소에 없다(.gitignore). api 를 먼저 빌드하면
#     옛 dist 를 읽어서 "Property 'issuerId' does not exist" 같은 오류가 난다.
#     turbo 가 dependsOn 으로 types -> api/web 순서를 잡아 주므로 루트에서 돌린다.
#     --concurrency=1 은 메모리가 모자라 빌드가 죽는 것을 막는다.
#
#  2. prisma generate 를 건너뛰면 스키마에서 만들어지는 타입(FinancialInstitutionType 등)이
#     없어서 빌드가 실패한다. 생성물 역시 저장소에 없다.
#
#  3. **빌드가 끝난 뒤에 앱을 건드린다.** 예전에는 받자마자 pm2 stop 을 했는데, 그러면
#     빌드가 도는 몇 분 내내 서비스가 죽어 있었다. 지금은 빌드가 실패하면 돌던 앱이 그대로
#     남는다 -- 배포 실패가 장애가 되지 않는다.
#
#  4. **마이그레이션은 빌드 뒤, 재시작 앞이다.** 빌드가 깨질 코드로 스키마부터 바꾸면
#     되돌릴 것이 데이터베이스에 남는다.
#
# 재시작은 reload(하나씩 갈아 끼우기)다. 인스턴스를 여럿 두면 요청이 끊기지 않는다.
# **그 대신 잠깐 옛 코드와 새 코드가 함께 돈다.** 마이그레이션은 그 사이를 견뎌야 한다 --
# 컬럼을 더하는 것은 괜찮고, 이름을 바꾸거나 지우는 것은 두 번에 나눠야 한다
# (먼저 새 것을 더해 양쪽이 쓰게 하고, 다음 배포에서 옛 것을 지운다).

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT=$(pwd)

RESET=false
if [[ "${1:-}" == "--reset" ]]; then
  RESET=true
elif [[ -n "${1:-}" ]]; then
  echo "알 수 없는 인자: $1" >&2
  echo "사용법: $0 [--reset]" >&2
  exit 1
fi

echo "==> 최신 코드 받기"
git pull origin main

echo "==> 의존성 설치 (서버가 돌리는 것만)"
# 앱(packages/app)은 서버에서 돌지 않는다. 필터 없이 설치하면 expo·react-native 까지
# 받느라 배포가 느려지고 디스크만 먹는다. `...` 는 그 패키지가 기대는 것(types, core)까지다.
pnpm install --frozen-lockfile --filter @money/api... --filter @money/web...

cd "$ROOT/packages/api"

# 초기화는 데이터를 지우는 일이라 앱을 먼저 세운다. 돌고 있는 쓰기가 있으면
# 지우는 도중에 새 행이 들어와 마이그레이션이 어긋난다.
if [[ "$RESET" == true ]]; then
  echo
  echo "  경고: 데이터베이스의 모든 데이터를 지웁니다. 되돌릴 수 없습니다."
  read -r -p "  계속하려면 'reset' 을 입력하세요: " answer
  if [[ "$answer" != "reset" ]]; then
    echo "취소했습니다."
    exit 1
  fi
  echo "==> 앱 정지"
  pm2 stop ecosystem.config.js 2>/dev/null || true
  echo "==> 데이터베이스 초기화"
  npx prisma migrate reset --force
fi

echo "==> Prisma 클라이언트 생성"
npx prisma generate

echo "==> 빌드 (types -> api/web 순서, 한 번에 하나씩)"
# 여기까지는 돌고 있는 앱을 건드리지 않는다. 실패하면 옛 코드가 그대로 서비스한다.
cd "$ROOT"
npx turbo run build --concurrency=1

if [[ "$RESET" != true ]]; then
  echo "==> 마이그레이션 적용"
  # 아래 reload 가 옛 코드와 새 코드를 잠깐 함께 돌린다. 이 마이그레이션은 그 사이를
  # 견뎌야 한다 (파일 맨 위의 4번).
  (cd "$ROOT/packages/api" && npx prisma migrate deploy)
fi

echo "==> 앱 갈아 끼우기"
# reload 는 인스턴스를 하나씩 새 코드로 바꾼다 (cluster 모드에서 요청이 끊기지 않는다).
# 아직 등록 전이면 reload 가 실패하므로 그때는 start 로 올린다.
pm2 reload ecosystem.config.js --update-env 2>/dev/null || pm2 start ecosystem.config.js
pm2 save

echo
echo "완료. 상태 확인:"
echo "  pm2 list"
echo "  pm2 logs money-api --lines 30"
