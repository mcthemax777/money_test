/**
 * 원장 검증이 공용 규칙으로 옮겨간 뒤에도 그대로인지 본다.
 *
 * 실행하려면 경로 별칭 '@/' 를 풀어 줄 것이 필요하다. 저장소에 tsconfig-paths 가
 * 없어서 다른 스모크도 사정이 같다. 별칭을 src 로 잇는 -r 훅을 하나 두고
 * `node -r <훅> -r ts-node/register/transpile-only scripts/ledger-rules-smoke.ts`
 * 로 돌린다. 데이터베이스 없이 규칙만 볼 때는 `decimal-smoke` 가 별칭을 쓰지 않아
 * `npx ts-node scripts/decimal-smoke.ts` 로 그냥 돈다.
 *
 * `decimal-smoke` 는 규칙 자체를 데이터베이스 없이 본다. 여기서 보는 것은 그
 * 규칙이 서버에 붙은 자리다. 특히 Prisma.Decimal 값이 문자열을 거쳐 공용 규칙에
 * 들어가도 값이 상하지 않는지가 핵심이다. decimal.js 는 자릿수가 크면 지수 표기로
 * 문자열을 만들기 때문에, 그 표기까지 읽을 수 있어야 한다.
 */
import { Prisma } from '@prisma/client';
import { Dec } from '@money/types';
import type { PostingInput } from '@/modules/ledger/ledger.service';
import { makeLedger, projectAccessStub, runSmoke } from './smoke-harness';

const D = (n: string | number) => new Prisma.Decimal(n);

runSmoke('ledger-rules', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const pid = project.id;
  const ledger = makeLedger(ctx.prisma, projectAccessStub(ctx.prisma, pid));

  const person = await ctx.prisma.person.create({ data: { projectId: pid, name: '김철수' } });
  const bank = await ctx.prisma.account.create({
    data: { projectId: pid, ownerId: person.id, type: 'deposit', name: '보통예금' },
  });
  const food = await ctx.prisma.category.create({
    data: { projectId: pid, name: '식비', type: 'expense' },
  });

  const leg = (amount: string): PostingInput[] => [
    {
      categoryId: food.id,
      amount: D(amount),
      currency: 'KRW',
      exchangeRate: D(1),
      baseAmount: D(amount),
    },
    {
      accountId: bank.id,
      amount: D(`-${amount}`),
      currency: 'KRW',
      exchangeRate: D(1),
      baseAmount: D(`-${amount}`),
    },
  ];

  const entryOf = (postings: PostingInput[], date = new Date()) => ({
    projectId: pid,
    personId: person.id,
    date,
    description: '점심',
    postings,
  });

  // ── 통과해야 하는 것 ──
  await ledger.createEntry(entryOf(leg('50000')));
  const afterOne = await ctx.prisma.account.findUnique({ where: { id: bank.id } });
  ctx.check('균형 전표가 통과하고 잔액이 따라온다', afterOne?.balance.toString(), '-50000');

  // Prisma.Decimal 이 지수 표기로 문자열을 만드는 자릿수. 규칙이 그것을 읽어야 한다.
  const huge = '10000000000000000000000';
  ctx.check('decimal.js 가 지수 표기를 쓰는 값', D(huge).toString().includes('e'), true);
  ctx.check('공용 규칙이 그 표기를 읽는다', Dec.of(D(huge)).toString(), huge);

  // ── 거부해야 하는 것 ──
  await ctx.expectReject('다리가 하나면 거부', () =>
    ledger.createEntry(entryOf([leg('1000')[0]])),
  );

  await ctx.expectReject('합계가 0이 아니면 거부', () =>
    ledger.createEntry(
      entryOf([
        leg('30000')[0],
        {
          accountId: bank.id,
          amount: D('-20000'),
          currency: 'KRW',
          exchangeRate: D(1),
          baseAmount: D('-20000'),
        },
      ]),
    ),
  );

  await ctx.expectReject('금액이 0이면 거부', () => ledger.createEntry(entryOf(leg('0'))));

  await ctx.expectReject('환율이 0이면 거부', () =>
    ledger.createEntry(
      entryOf([
        { ...leg('1000')[0], exchangeRate: D(0) },
        leg('1000')[1],
      ]),
    ),
  );

  await ctx.expectReject('금액과 환산액의 부호가 다르면 거부', () =>
    ledger.createEntry(
      entryOf([
        { ...leg('1000')[0], baseAmount: D('-1000') },
        { ...leg('1000')[1], baseAmount: D('1000') },
      ]),
    ),
  );

  await ctx.expectReject('계좌와 카테고리를 함께 가리키면 거부', () =>
    ledger.createEntry(
      entryOf([
        { ...leg('1000')[0], accountId: bank.id },
        leg('1000')[1],
      ]),
    ),
  );

  await ctx.expectReject('카테고리 다리에 수량을 넣으면 거부', () =>
    ledger.createEntry(
      entryOf([{ ...leg('1000')[0], quantity: D(1) }, leg('1000')[1]]),
    ),
  );

  await ctx.expectReject('원장 하한보다 앞선 날짜는 거부', () =>
    ledger.createEntry(entryOf(leg('1000'), new Date('1898-01-01T00:00:00Z'))),
  );

  await ctx.expectReject('5년 뒤보다 나중 날짜는 거부', () =>
    ledger.createEntry(entryOf(leg('1000'), new Date('2926-01-01T00:00:00Z'))),
  );

  await ctx.expectReject('날짜가 잘못되면 거부', () =>
    ledger.createEntry(entryOf(leg('1000'), new Date('아무거나'))),
  );

  // 거부된 전표들이 잔액을 건드리지 않았어야 한다.
  const afterRejects = await ctx.prisma.account.findUnique({ where: { id: bank.id } });
  ctx.check('거부된 전표는 잔액을 남기지 않는다', afterRejects?.balance.toString(), '-50000');

  const entryCount = await ctx.prisma.journalEntry.count({ where: { projectId: pid } });
  ctx.check('통과한 전표만 남았다', entryCount, 1);
});
