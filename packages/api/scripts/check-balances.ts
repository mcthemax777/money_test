/**
 * 통장 잔액이 다리 합계와 맞는지 본다. **읽기만 한다.**
 *
 * 실행:
 *   cd packages/api
 *   node -r ts-node/register -r <alias> scripts/check-balances.ts            # 전체
 *   node -r ts-node/register -r <alias> scripts/check-balances.ts <프로젝트id>  # 하나만
 *
 * 왜 필요한가. `Account.balance` 는 그 계좌에 걸린 `Posting.amount` 의 합이고, 원장은
 * 전표를 쓸 때마다 그 값을 증분으로 움직인다. 즉 잔액은 **캐시**다. 캐시가 한 번
 * 어긋나면 스스로 맞지 않는다 -- 이후의 모든 쓰기가 틀린 값 위에 얹힌다.
 *
 * 2026-09-07 이전에는 같은 거래를 두 사람이 동시에 저장하면 이 값이 어긋났다. 옛 다리를
 * 잠그지 않고 읽어 같은 금액을 두 번 되돌렸기 때문이다(`SYNC_CONFLICT_AUDIT.md` 의 A).
 * 지금은 막았지만 **그전에 어긋난 값은 그대로 남아 있다.** 이 스크립트는 그것을 찾는다.
 *
 * 고치지는 않는다. 어긋난 곳이 나오면 그 계좌에서 무슨 일이 있었는지 먼저 보아야 한다 --
 * 원인을 모르는 채 덮어쓰면 진짜 사고를 지우는 셈이 될 수 있다. 마지막에 고칠 SQL 을
 * 적어 주므로, 확인한 뒤 손으로 돌리면 된다.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

async function main() {
  const prisma = new PrismaClient();
  const only = process.argv[2];

  try {
    const projects = await prisma.project.findMany({
      where: only ? { id: only } : {},
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    if (projects.length === 0) {
      console.log(only ? `프로젝트를 찾지 못했습니다: ${only}` : '프로젝트가 없습니다.');
      return;
    }

    let checked = 0;
    const drifted: Array<{
      project: string;
      account: string;
      name: string;
      stored: Prisma.Decimal;
      actual: Prisma.Decimal;
    }> = [];

    for (const project of projects) {
      const accounts = await prisma.account.findMany({
        where: { projectId: project.id },
        select: { id: true, name: true, balance: true, currency: true, isActive: true },
        orderBy: { name: 'asc' },
      });
      if (accounts.length === 0) continue;

      /*
       * 다리 합계를 계좌별로 한 번에 센다.
       *
       * 계좌마다 따로 세면 왕복이 계좌 수만큼 늘고, 그 사이에 들어온 쓰기 때문에
       * 계좌마다 다른 시점을 보게 된다. 어긋남을 찾는 일에서 그것은 거짓 양성이 된다.
       */
      const sums = await prisma.posting.groupBy({
        by: ['accountId'],
        where: { accountId: { in: accounts.map((account) => account.id) } },
        _sum: { amount: true },
      });
      const actualOf = new Map(
        sums.map((row) => [row.accountId as string, row._sum.amount ?? ZERO]),
      );

      for (const account of accounts) {
        checked += 1;
        const actual = actualOf.get(account.id) ?? ZERO;
        if (account.balance.equals(actual)) continue;

        drifted.push({
          project: project.name,
          account: account.id,
          name: `${account.name}${account.isActive ? '' : ' (숨김)'} ${account.currency}`,
          stored: account.balance,
          actual,
        });
      }
    }

    console.log(`계좌 ${checked}개를 봤습니다 (프로젝트 ${projects.length}개).\n`);

    if (drifted.length === 0) {
      console.log('어긋난 계좌가 없습니다. 잔액이 모두 다리 합계와 같습니다.');
      return;
    }

    console.log(`어긋난 계좌 ${drifted.length}개:\n`);
    for (const row of drifted) {
      const diff = row.actual.sub(row.stored);
      console.log(`  [${row.project}] ${row.name}`);
      console.log(`    적혀 있는 잔액 ${row.stored.toString()}`);
      console.log(`    다리 합계     ${row.actual.toString()}`);
      console.log(`    차이          ${diff.isPositive() ? '+' : ''}${diff.toString()}`);
      console.log(`    id            ${row.account}`);
      console.log('');
    }

    console.log('---');
    console.log('무엇을 볼 것인가. 차이가 어느 거래 한 건의 금액과 같다면 동시 저장으로');
    console.log('어긋난 것일 가능성이 높습니다. 그 계좌의 거래를 한 번 훑어보세요.');
    console.log('');
    console.log('맞다고 판단했으면 아래를 돌려 다리 합계로 되맞춥니다 (한 계좌씩):');
    console.log('');
    for (const row of drifted) {
      console.log(
        `  UPDATE "Account" SET "balance" = ${row.actual.toString()} WHERE id = '${row.account}';`,
      );
    }
    console.log('');
    console.log('※ 이 UPDATE 는 도장 트리거를 깨워 변경 번호를 올립니다. 기기들이 다음');
    console.log('   동기화에서 고쳐진 잔액을 받아 갑니다.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
