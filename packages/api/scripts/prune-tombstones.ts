/**
 * 보관 기간이 지난 자리표(Tombstone)를 지운다.
 *
 *   cd packages/api && RETENTION_DAYS=90 npx ts-node --transpile-only scripts/prune-tombstones.ts
 *
 * 빌드가 먼저 있어야 한다(`dist`). 지우는 일은 서비스가 하고, 그 파일은 `@/` 별칭을
 * 쓰는데 별칭을 푸는 것은 빌드다. 배포는 언제나 빌드 뒤에 오므로 서버에서는 늘 있다.
 *
 * 서버 안의 스케줄러가 아니라 밖에서 부르는 스크립트인 이유. 인스턴스를 여럿 띄우면
 * (`API_INSTANCES`) 프로세스 안의 스케줄러는 그 수만큼 겹쳐 돈다. 겹쳐도 결과는 같지만
 * (지우는 일은 멱등이다) 같은 표를 여럿이 훑을 이유가 없고, 무엇보다 이 일은 하루 한 번
 * 이면 충분해서 서버가 늘 들고 있을 까닭이 없다. 배포한 곳의 cron 이 부른다.
 *
 * **이 값이 곧 기기가 사본을 지키며 떨어져 있을 수 있는 기간이다.** 이보다 오래 끊겼던
 * 기기는 놓친 삭제를 따라잡을 수 없어 사본을 버리고 처음부터 받는다(적어 둔 것은
 * 아웃박스에 남아 그대로 올라간다). 짧게 잡으면 표는 작아지지만 전체 재동기화가 잦아지고,
 * 길게 잡으면 그 반대다. 90일은 "한 계절을 통째로 쉬어도 델타로 따라잡는다"는 뜻이다.
 *
 * 먼저 무엇이 지워질지만 보려면 DRY_RUN=1 을 준다.
 *
 * **배포가 끝난 뒤에 돌린다.** 모든 인스턴스가 새 코드로 갈아 끼워지기 전에 지우면,
 * 아직 옛 코드인 인스턴스는 응답에 바닥(`tombstoneFloor`)을 싣지 않는다. 그 응답을 받은
 * 기기는 바닥을 0 으로 읽고 커서만 밀어 올리므로, 그 사이에 지워진 행이 그 기기에
 * 그대로 남는다 -- 커서가 바닥을 넘어선 뒤에는 다시 받을 길도 없다. 에뮬레이터에서
 * 실제로 그 자국을 만들어 보았다(옛 서버로 한 번 맞춘 뒤 유령 행이 남았다).
 */

import { PrismaClient } from '@prisma/client';

const DEFAULT_RETENTION_DAYS = 90;

async function main() {
  const retentionDays = Number(process.env.RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
  if (retentionDays < 1) {
    throw new Error(`RETENTION_DAYS 는 1 이상이어야 합니다: ${retentionDays}`);
  }

  const prisma = new PrismaClient();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  try {
    /*
     * 먼저 무엇이 지워질지 센다. 지운 뒤에는 셀 수 없고, 로그에 남는 이 숫자가
     * "바닥이 왜 그 번호로 올랐는가"를 나중에 설명해 준다.
     */
    const groups = await prisma.tombstone.groupBy({
      by: ['projectId'],
      where: { deletedAt: { lt: cutoff } },
      _max: { deletedVersion: true },
      _count: { _all: true },
    });

    if (groups.length === 0) {
      console.log(`지울 자리표가 없습니다 (기준 ${cutoff.toISOString()}, ${retentionDays}일).`);
      return;
    }

    for (const group of groups) {
      console.log(
        `프로젝트 ${group.projectId}: ${group._count._all}건, 바닥이 ${group._max.deletedVersion} 이 됩니다.`,
      );
    }

    if (process.env.DRY_RUN) {
      console.log('DRY_RUN 이라 지우지 않았습니다.');
      return;
    }

    /*
     * 실제로 지우는 일은 서비스가 한다. 지우기와 바닥 올리기가 한 트랜잭션이어야 하는데,
     * 그 규칙을 스크립트와 서비스 두 곳에 적어 두면 한쪽만 고쳐지는 날이 온다.
     *
     * 빌드 결과에서 가져오는 것은 `@/` 별칭 때문이다. 소스를 그대로 읽으면 그 별칭을
     * 풀 것이 없어(tsconfig-paths 를 쓰지 않는다) 실행할 때 모듈을 찾지 못한다.
     * 타입은 소스에서 본다 -- 그래야 서비스가 바뀌면 여기서도 걸린다.
     */
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SyncService } = require('../dist/modules/sync/sync.service') as typeof import('../src/modules/sync/sync.service');
    const service = new SyncService(prisma as never, null as never);
    const result = await service.pruneTombstones(retentionDays);

    console.log(
      `끝. 프로젝트 ${result.projects}개에서 자리표 ${result.removed}건을 지웠습니다 (${retentionDays}일 기준).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
