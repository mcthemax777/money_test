#!/usr/bin/env bash
#
# EC2 배포 스크립트.
#
#   ./scripts/deploy.sh           일반 배포. 데이터는 그대로 두고 마이그레이션만 적용한다.
#   ./scripts/deploy.sh --reset   데이터베이스를 비우고 새로 세팅한다. 되돌릴 수 없다.
#
# 순서를 지켜야 하는 이유가 두 가지 있다.
#
#  1. packages/types/dist 는 저장소에 없다(.gitignore). api 를 먼저 빌드하면
#     옛 dist 를 읽어서 "Property 'issuerId' does not exist" 같은 오류가 난다.
#     turbo 가 dependsOn 으로 types -> api/web 순서를 잡아 주므로 루트에서 돌린다.
#     --concurrency=1 은 메모리가 모자라 빌드가 죽는 것을 막는다.
#
#  2. prisma generate 를 건너뛰면 스키마에서 만들어지는 타입(FinancialInstitutionType 등)이
#     없어서 빌드가 실패한다. 생성물 역시 저장소에 없다.

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

echo "==> 앱 정지"
# 아직 등록 전이면 실패해도 계속 진행한다.
pm2 stop ecosystem.config.js 2>/dev/null || true

cd "$ROOT/packages/api"

if [[ "$RESET" == true ]]; then
  echo
  echo "  경고: 데이터베이스의 모든 데이터를 지웁니다. 되돌릴 수 없습니다."
  read -r -p "  계속하려면 'reset' 을 입력하세요: " answer
  if [[ "$answer" != "reset" ]]; then
    echo "취소했습니다."
    exit 1
  fi
  echo "==> 데이터베이스 초기화"
  npx prisma migrate reset --force
else
  echo "==> 마이그레이션 적용"
  npx prisma migrate deploy
fi

echo "==> Prisma 클라이언트 생성"
npx prisma generate

echo "==> 빌드 (types -> api/web 순서, 한 번에 하나씩)"
cd "$ROOT"
npx turbo run build --concurrency=1

echo "==> 앱 시작"
pm2 start ecosystem.config.js
pm2 save

echo
echo "완료. 상태 확인:"
echo "  pm2 list"
echo "  pm2 logs money-api --lines 30"
