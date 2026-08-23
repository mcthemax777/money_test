#!/usr/bin/env bash
#
# 로컬 데이터베이스를 개발 서버로 통째로 옮긴다.
#
#   ./scripts/sync-db.sh <ssh-대상> [원격-앱-경로]
#   ./scripts/sync-db.sh ubuntu@1.2.3.4
#   ./scripts/sync-db.sh money-dev ~/money
#
# 엑셀 내보내기로는 이 일을 할 수 없다. 그 파일에는 id도, 분할·할부·예산·기초잔액·
# 환율 설정도 들어 있지 않다. 환경을 그대로 옮기려면 데이터베이스를 옮겨야 한다.
#
# 덤프에는 _prisma_migrations 까지 들어간다. 그래서 옮긴 뒤에도 마이그레이션 이력이
# 로컬과 같아지고, 다음 배포의 `prisma migrate deploy` 가 어긋나지 않는다.
#
# 원격 데이터베이스에 붙는 방법이 환경마다 다르다. 기본값은 서버에 psql 이 깔려 있고
# packages/api/.env 의 DATABASE_URL 로 붙는 경우다. 도커로 띄웠으면 이렇게 부른다.
#
#   REMOTE_PSQL='docker exec -i money_postgres psql -U postgres -d money_db' \
#     ./scripts/sync-db.sh ubuntu@1.2.3.4

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="${1:-}"
REMOTE_DIR="${2:-~/money}"

if [[ -z "$TARGET" ]]; then
  echo "사용법: $0 <ssh-대상> [원격-앱-경로]" >&2
  exit 1
fi

# 로컬 덤프 명령. 도커 컴포즈의 컨테이너 이름이 기본값이다.
LOCAL_PGDUMP="${LOCAL_PGDUMP:-docker exec -e PGPASSWORD=postgres money_postgres pg_dump -U postgres -d money_db}"
# 원격 복원 명령. 서버에서 실행되므로 그쪽 셸이 해석한다.
REMOTE_PSQL="${REMOTE_PSQL:-psql \"\$DATABASE_URL\"}"

DUMP_FILE="money_db_$(date +%Y%m%d_%H%M%S).sql"
LOCAL_DUMP="backups/$DUMP_FILE"
mkdir -p backups

echo
echo "  경고: $TARGET 의 데이터베이스를 통째로 덮어씁니다. 되돌릴 수 없습니다."
echo "        그쪽에만 있던 데이터(가입한 구성원, 입력한 거래)는 전부 사라집니다."
read -r -p "  계속하려면 'sync' 를 입력하세요: " answer
if [[ "$answer" != "sync" ]]; then
  echo "취소했습니다."
  exit 1
fi

# --clean --if-exists: 복원할 때 기존 테이블을 지우고 새로 만든다. 데이터만 넣으면
# 외래키 순서 때문에 실패하거나, 남아 있던 옛 행과 섞인다.
echo "==> 로컬 덤프 ($LOCAL_DUMP)"
$LOCAL_PGDUMP --clean --if-exists > "$LOCAL_DUMP"
echo "    $(wc -c < "$LOCAL_DUMP" | tr -d ' ') bytes"

echo "==> 서버로 복사"
scp "$LOCAL_DUMP" "$TARGET:/tmp/$DUMP_FILE"

# 복원 중에 서버가 살아 있으면 반쯤 지워진 테이블을 읽는다. 멈추고 넣고 다시 띄운다.
echo "==> 서버에서 복원"
ssh "$TARGET" bash -s <<EOF
set -euo pipefail
cd "$REMOTE_DIR"

# DATABASE_URL 은 앱과 같은 값을 쓴다. 따로 적으면 두 곳이 어긋난다.
set -a
. packages/api/.env
set +a

pm2 stop ecosystem.config.js 2>/dev/null || true
$REMOTE_PSQL < "/tmp/$DUMP_FILE"
pm2 start ecosystem.config.js
rm -f "/tmp/$DUMP_FILE"
EOF

echo
echo "완료. 로컬 덤프는 $LOCAL_DUMP 에 남겨 두었습니다."
echo "상태 확인:"
echo "  ssh $TARGET 'pm2 logs money-api --lines 30'"
