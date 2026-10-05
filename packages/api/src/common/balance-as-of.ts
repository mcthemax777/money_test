import { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * 화면에 내보내는 잔액은 **지금까지의** 잔액이다.
 *
 * `Account.balance` 칸은 그 계좌의 다리 전부를 더한 캐시라 미리 적어 둔 미래 날짜의 거래
 * (다음 주 월급, 이달 말 자동이체)까지 들어 있다. 그대로 보이면 아직 없는 돈이 통장에
 * 있는 것처럼 읽힌다. 그래서 내보낼 때 날짜가 `asOf` 뒤인 다리의 합을 뺀다.
 *
 * 칸 자체는 고치지 않는다. 캐시의 정의("다리 전부의 합", check-balances 가 지킨다)를 두고,
 * 시간이 지나 미래가 과거가 되어도 다시 쓸 일이 없게 하려는 것이다. 지울 수 있는지 보는
 * 검사처럼 미래의 거래도 잔액으로 쳐야 하는 곳은 이 함수를 거치지 않고 칸을 읽는다.
 *
 * 기기 사본도 같은 규칙이다 (`@money/core` local-store 의 `accountBalances`).
 */
export async function futureSums(
  db: Db,
  accountIds: string[],
  asOf: Date = new Date(),
): Promise<Map<string, Prisma.Decimal>> {
  if (accountIds.length === 0) return new Map();

  const rows = await db.posting.groupBy({
    by: ['accountId'],
    _sum: { amount: true },
    where: { accountId: { in: accountIds }, entry: { date: { gt: asOf } } },
  });
  return new Map(
    rows.map((row) => [row.accountId!, row._sum.amount ?? new Prisma.Decimal(0)] as const),
  );
}

/** 계좌 행들의 `balance` 를 지금 잔액으로 바꿔 돌려준다. 나머지 칸은 그대로다. */
export async function withBalancesAsOf<T extends { id: string; balance: Prisma.Decimal }>(
  db: Db,
  accounts: T[],
  asOf: Date = new Date(),
): Promise<T[]> {
  const future = await futureSums(
    db,
    accounts.map((account) => account.id),
    asOf,
  );
  return accounts.map((account) => {
    const ahead = future.get(account.id);
    return ahead ? { ...account, balance: account.balance.sub(ahead) } : account;
  });
}

/**
 * 카드 행의 부채 계정 잔액을 지금 잔액으로 바꾼다. `toCardResponse` 가 이 잔액으로
 * 남은 대금(`currentUsage`)을 내므로, 카드를 내보내는 길은 그 앞에서 이것을 거친다.
 */
export async function withCardBalancesAsOf<
  T extends { liabilityAccount?: { id: string; balance: Prisma.Decimal } | null },
>(db: Db, cards: T[], asOf: Date = new Date()): Promise<T[]> {
  const liabilities = cards.flatMap((card) => (card.liabilityAccount ? [card.liabilityAccount] : []));
  const adjusted = new Map(
    (await withBalancesAsOf(db, liabilities, asOf)).map((account) => [account.id, account]),
  );
  return cards.map((card) =>
    card.liabilityAccount
      ? { ...card, liabilityAccount: adjusted.get(card.liabilityAccount.id) ?? card.liabilityAccount }
      : card,
  );
}
