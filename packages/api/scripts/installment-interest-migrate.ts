/**
 * 할부 이자를 전표 안으로 옮긴다. **마이그레이션을 적용하기 전에 돌린다.**
 *
 * 실행:
 *   cd packages/api
 *   npx tsx scripts/installment-interest-migrate.ts          # 무엇을 할지 보기만 한다
 *   npx tsx scripts/installment-interest-migrate.ts --apply  # 실제로 고친다
 *
 * 무엇을 하는가. 두 가지다.
 *
 *   1. **옛 수수료 전표를 지운다.** 지금까지 유이자 할부의 이자는 회차가 마감될 때마다
 *      사람이 명세서를 보고 적어 별도의 전표로 남았다(`installmentPlanId` 가 가리킨다).
 *      이제 이자가 원 거래에 들어가므로, 그 전표를 그대로 두면 같은 이자가 두 번 센다.
 *      지운 만큼 계좌 잔액도 되돌린다 -- 잔액은 다리 합계의 캐시다.
 *
 *   2. **적어 둔 회차 이자를 원 거래에 얹는다.** 카드 다리는 그만큼 더 빚지고, 분류
 *      다리는 그만큼 더 지출한다. 나누는 규칙은 조립(`buildExpense`)과 같다 -- 줄 금액의
 *      비율로 나누고 끝수는 첫 줄에 붙인다.
 *
 * 이미 옮겨진 거래는 건드리지 않는다(카드 다리가 이미 원금 + 이자다). 판단할 수 없는
 * 거래는 건너뛰고 까닭을 적는다 -- 조용히 고치면 어느 것이 손대어졌는지 알 수 없다.
 */
import { splitInstallment } from '@money/types';
import { PrismaClient, Prisma } from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

type PlanRow = {
  planId: string;
  entryId: string;
  postingId: string;
  accountId: string | null;
  totalMonths: number;
  amount: Prisma.Decimal;
  baseAmount: Prisma.Decimal;
  principalShares: Prisma.JsonValue;
  interestShares: Prisma.JsonValue;
  description: string;
};

type LegRow = { id: string; amount: Prisma.Decimal; baseAmount: Prisma.Decimal };

function sumShares(value: Prisma.JsonValue, months: number): Prisma.Decimal | null {
  if (!Array.isArray(value) || value.length !== months) return null;
  try {
    return value.reduce<Prisma.Decimal>(
      (acc, share) => acc.add(new Prisma.Decimal(String(share))),
      ZERO,
    );
  } catch {
    return null;
  }
}

/** 총액을 가중치대로 나눈다. 끝수는 첫 줄에 붙인다 (조립의 `allocate` 와 같다). */
function allocate(total: Prisma.Decimal, weights: Prisma.Decimal[]): Prisma.Decimal[] {
  if (weights.length === 0) return [];
  if (weights.length === 1) return [total];

  const weightSum = weights.reduce((acc, weight) => acc.add(weight), ZERO);
  if (weightSum.isZero()) return weights.map(() => ZERO);

  const shares = weights.map((weight) =>
    total.mul(weight).div(weightSum).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN),
  );
  const paid = shares.reduce((acc, share) => acc.add(share), ZERO);
  shares[0] = shares[0].add(total.sub(paid));
  return shares;
}

async function main() {
  const prisma = new PrismaClient();
  const apply = process.argv.includes('--apply');

  try {
    const [column] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
        FROM information_schema.columns
       WHERE table_name = 'JournalEntry' AND column_name = 'installmentPlanId'`;
    const hasFeeColumn = column.count > 0;

    // ── 1. 옛 수수료 전표 ──
    if (!hasFeeColumn) {
      console.log('수수료 전표 칸이 이미 없습니다. 지울 것이 없거나 이미 정리되었습니다.\n');
    } else {
      const fees = await prisma.$queryRaw<Array<{ id: string; description: string; date: Date }>>`
        SELECT id, description, date FROM "JournalEntry"
         WHERE "installmentPlanId" IS NOT NULL
         ORDER BY date`;

      console.log(`옛 수수료 전표 ${fees.length}건`);
      for (const fee of fees) {
        console.log(`  ${fee.date.toISOString().slice(0, 10)}  ${fee.description}`);
      }

      if (apply && fees.length > 0) {
        await prisma.$transaction([
          // 지우기 전에 잔액을 되돌린다. 다리 합계와 어긋나면 이후 모든 쓰기가 틀린 값 위에 얹힌다.
          prisma.$executeRaw`
            UPDATE "Account" a
               SET balance = a.balance - x.delta
              FROM (SELECT p."accountId" AS id, SUM(p.amount) AS delta
                      FROM "Posting" p
                      JOIN "JournalEntry" e ON e.id = p."entryId"
                     WHERE e."installmentPlanId" IS NOT NULL AND p."accountId" IS NOT NULL
                     GROUP BY p."accountId") x
             WHERE a.id = x.id`,
          prisma.$executeRaw`DELETE FROM "JournalEntry" WHERE "installmentPlanId" IS NOT NULL`,
        ]);
        console.log(`  -> ${fees.length}건을 지우고 잔액을 되돌렸습니다.`);
      }
      console.log('');
    }

    // ── 2. 회차 이자를 원 거래로 ──
    const plans = await prisma.$queryRaw<PlanRow[]>`
      SELECT ip.id AS "planId", p."entryId", p.id AS "postingId", p."accountId",
             ip."totalMonths", p.amount, p."baseAmount",
             ip."principalShares", ip."interestShares", e.description
        FROM "InstallmentPlan" ip
        JOIN "Posting" p ON p.id = ip."postingId"
        JOIN "JournalEntry" e ON e.id = p."entryId"
       WHERE ip."interestBearing" = true AND ip."interestShares" IS NOT NULL
       ORDER BY e.date`;

    console.log(`유이자 할부 ${plans.length}건`);
    let moved = 0;

    for (const plan of plans) {
      const label = `  ${plan.description} (${plan.totalMonths}개월)`;
      const interest = sumShares(plan.interestShares, plan.totalMonths);
      const principal = sumShares(plan.principalShares, plan.totalMonths);

      if (!interest || interest.isZero()) {
        console.log(`${label}: 적어 둔 이자가 없습니다. 건너뜁니다.`);
        continue;
      }
      if (!plan.amount.equals(plan.baseAmount)) {
        console.log(`${label}: 외화로 청구되는 카드입니다. 손대지 않습니다.`);
        continue;
      }

      const charged = plan.amount.neg();
      if (principal && charged.equals(principal.add(interest))) {
        console.log(`${label}: 이미 이자가 들어 있습니다.`);
        continue;
      }
      if (principal && !charged.equals(principal)) {
        console.log(
          `${label}: 카드 다리(${charged})가 회차 원금 합(${principal})과 달라 건너뜁니다.`,
        );
        continue;
      }

      /*
       * 회차 원금을 적어 둔 적이 없으면 지금 적어 둔다.
       *
       * 이 값이 있어야 두 번 돌려도 안전하다 -- 다리에 이자가 들어간 뒤에는 무엇이
       * 구매가였는지 다리만 보아서는 알 수 없다. 나누는 규칙은 화면의 기본값과 같다.
       */
      const principals = principal
        ? null
        : splitInstallment(charged.toString(), plan.totalMonths).map((share) => share.toString());

      const legs = await prisma.$queryRaw<LegRow[]>`
        SELECT id, amount, "baseAmount" FROM "Posting"
         WHERE "entryId" = ${plan.entryId} AND "categoryId" IS NOT NULL
         ORDER BY id`;
      if (legs.length === 0) {
        console.log(`${label}: 분류 다리가 없습니다. 건너뜁니다.`);
        continue;
      }

      const shares = allocate(interest, legs.map((leg) => leg.baseAmount));
      console.log(`${label}: 이자 ${interest} 를 얹습니다.`);
      moved += 1;
      if (!apply) continue;

      await prisma.$transaction([
        ...legs.map((leg, index) =>
          prisma.posting.update({
            where: { id: leg.id },
            data: {
              amount: leg.amount.add(shares[index]),
              baseAmount: leg.baseAmount.add(shares[index]),
            },
          }),
        ),
        prisma.posting.update({
          where: { id: plan.postingId },
          data: {
            amount: plan.amount.sub(interest),
            baseAmount: plan.baseAmount.sub(interest),
          },
        }),
        ...(principals
          ? [
              prisma.installmentPlan.update({
                where: { id: plan.planId },
                data: { principalShares: principals },
              }),
            ]
          : []),
        ...(plan.accountId
          ? [
              prisma.account.update({
                where: { id: plan.accountId },
                data: { balance: { decrement: interest } },
              }),
            ]
          : []),
      ]);
    }

    console.log('');
    console.log(
      apply
        ? `끝났습니다. ${moved}건에 이자를 얹었습니다.`
        : `보기만 했습니다. ${moved}건이 바뀝니다. 실제로 고치려면 --apply 를 붙이세요.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
