/**
 * 실제 사용 중에 드러난 경계 조건들.
 *
 * 전부 "조용히 잘못된 값이 나오던" 종류다. 오류가 나지 않아 스모크가 통과하는데도
 * 화면 숫자가 어긋나거나 응답이 수만 행이 되던 것들이라, 회귀하면 다시 눈에
 * 띄지 않는다. 서버가 :3999에 떠 있어야 한다.
 */

import { JwtService } from '@nestjs/jwt';
import { runSmoke } from './smoke-harness';

const BASE = 'http://localhost:3999';

runSmoke('edge-cases', async (ctx) => {
  const project = await ctx.createProject();
  const user = await ctx.createUser();
  await ctx.prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, role: 'owner' },
  });
  const token = new JwtService({ secret: process.env.JWT_SECRET })
    .sign({ sub: user.id, type: 'access' }, { expiresIn: '1h' });

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  const q = `?projectId=${project.id}`;

  const person = await call('POST', `/people${q}`, { name: '김철수' });
  const account = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, type: 'deposit', name: '통장', openingBalance: '1000000',
  });
  const dining = await call('POST', `/categories${q}`, { name: '외식', type: 'expense' });

  // ── 예산 목록 (예전에는 없는 userId 컬럼 때문에 항상 500) ──
  const budgetList = await call('GET', `/budgets${q}`);
  ctx.check('예산 목록 조회', budgetList.status, 200);

  // ── 대분류 이름: 유형이 다르면 허용, 같으면 거부 ──
  const sameName = await call('POST', `/categories${q}`, { name: '외식', type: 'expense' });
  ctx.check('같은 유형의 대분류 중복 거부', sameName.status, 400);

  const incomeSameName = await call('POST', `/categories${q}`, { name: '외식', type: 'income' });
  ctx.check('유형이 다르면 같은 이름 허용', incomeSameName.status, 201);

  const rename = await call('PATCH', `/categories/${incomeSameName.body.id}`, { name: '급여' });
  ctx.check('이름 변경', rename.status, 200);
  const other = await call('POST', `/categories${q}`, { name: '교통', type: 'income' });
  const renameClash = await call('PATCH', `/categories/${other.body.id}`, { name: '급여' });
  ctx.check('중복 이름으로 변경 거부', renameClash.status, 400);

  // 소분류는 부모가 다르면 같은 이름을 쓸 수 있어야 한다
  const parentA = await call('POST', `/categories${q}`, { name: '식비', type: 'expense' });
  const parentB = await call('POST', `/categories${q}`, { name: '여가', type: 'expense' });
  const subA = await call('POST', `/categories${q}`, { name: '커피', type: 'expense', parentId: parentA.body.id });
  const subB = await call('POST', `/categories${q}`, { name: '커피', type: 'expense', parentId: parentB.body.id });
  ctx.check('다른 대분류 아래 같은 이름 소분류 허용', `${subA.status},${subB.status}`, '201,201');
  const subDup = await call('POST', `/categories${q}`, { name: '커피', type: 'expense', parentId: parentA.body.id });
  ctx.check('같은 대분류 아래 중복 소분류 거부', subDup.status, 400);

  // ── 거래 날짜 상한 ──
  const entryAt = (date: string) => ({
    kind: 'expense', personId: person.body.id, date,
    description: '점심', amount: '5000',
    categoryId: dining.body.id, accountId: account.body.id,
  });
  const nextYear = new Date().getUTCFullYear() + 1;
  ctx.check('내년 거래는 허용', (await call('POST', `/entries${q}`, entryAt(`${nextYear}-03-01T00:00:00.000Z`))).status, 201);
  ctx.check('2926년 거래 거부', (await call('POST', `/entries${q}`, entryAt('2926-08-20T00:00:00.000Z'))).status, 400);
  ctx.check('9999년 거래 거부', (await call('POST', `/entries${q}`, entryAt('9999-12-31T00:00:00.000Z'))).status, 400);

  // ── 카드 청구 주기가 폭발하지 않는다 ──
  const issuer = await call('GET', `/institutions${q}&type=card_issuer`);
  const card = await call('POST', `/cards${q}`, {
    paymentAccountId: account.body.id, name: '신한카드', cardType: 'credit',
    issuerId: issuer.body[0].id, statementClosingDay: 15, paymentDueDay: 25,
  });
  const usage = await call('GET', `/cards/${card.body.id}/usage`);
  ctx.check('기본 주기 수', usage.body?.periods?.length, 6);

  // 상한을 넘는 데이터가 이미 DB에 있어도 응답이 커지면 안 된다.
  // API로는 막히므로 원장에 직접 넣어 옛 데이터를 흉내 낸다.
  const liability = await ctx.prisma.card.findUniqueOrThrow({
    where: { id: card.body.id }, select: { liabilityAccountId: true },
  });
  await ctx.prisma.journalEntry.create({
    data: {
      projectId: project.id, personId: person.body.id,
      date: new Date('2926-08-20T00:00:00.000Z'), description: '옛 오타 데이터',
      postings: {
        create: [
          { accountId: liability.liabilityAccountId!, amount: '-10000', baseAmount: '-10000', cardId: card.body.id },
          { categoryId: dining.body.id, amount: '10000', baseAmount: '10000' },
        ],
      },
    },
  });
  const usageAfter = await call('GET', `/cards/${card.body.id}/usage`);
  const periodCount = usageAfter.body?.periods?.length ?? 0;
  ctx.check('먼 미래 데이터가 있어도 주기 수가 제한된다', periodCount <= 70, true);

  // ── 잘못된 연·월 ──
  ctx.check('99월 예산 조회 거부', (await call('GET', `/budgets/2026/99?projectId=${project.id}`)).status, 400);
  ctx.check('0월 예산 조회 거부', (await call('GET', `/budgets/2026/0?projectId=${project.id}`)).status, 400);
  ctx.check('잘못된 yearMonth 요약 거부', (await call('GET', `/reports/summary${q}&yearMonth=2026-99`)).status, 400);
  ctx.check('정상 yearMonth 요약', (await call('GET', `/reports/summary${q}&yearMonth=2026-08`)).status, 200);

  // ── 예산 기간 분할: 보고 있는 달의 규칙만 바뀐다 ──
  const budget = await call('POST', `/budgets${q}`, {
    categoryId: dining.body.id, monthlyAmount: '100000', yearMonth: '2026-08',
  });
  await call('PATCH', `/budgets/${budget.body.id}`, {
    monthlyAmount: '200000', applyMode: 'from', applyFromMonth: '2026-09',
  });
  await call('POST', `/budgets${q}`, {
    categoryId: dining.body.id, monthlyAmount: '333333', yearMonth: '2026-08',
  });
  const rules = await ctx.prisma.budget.findMany({
    where: { projectId: project.id, categoryId: dining.body.id },
    orderBy: { createdAt: 'asc' },
    select: { monthlyAmount: true, effectiveFrom: true },
  });
  ctx.check(
    '8월 금액만 바뀌고 9월 규칙은 그대로',
    rules.map((r) => `${r.effectiveFrom ?? '-'}:${r.monthlyAmount}`).join(' | '),
    '-:333333 | 2026-09:200000',
  );

  // ── 숨기기: 기록이 있어도 되고, 되돌릴 수 있다 ──
  const spender = await call('POST', `/people${q}`, { name: '숨길사람' });
  await call('POST', `/entries${q}`, {
    kind: 'expense', personId: spender.body.id, date: new Date().toISOString(),
    description: '거래', amount: '1000',
    categoryId: dining.body.id, accountId: account.body.id,
  });
  ctx.check('거래 기록이 있어도 구성원을 숨길 수 있다', (await call('DELETE', `/people/${spender.body.id}`)).status, 204);
  ctx.check(
    '숨긴 구성원은 기본 목록에서 빠진다',
    (await call('GET', `/people${q}`)).body.some((p: any) => p.id === spender.body.id),
    false,
  );
  ctx.check(
    'includeInactive면 함께 온다',
    (await call('GET', `/people${q}&includeInactive=true`)).body.some((p: any) => p.id === spender.body.id),
    true,
  );
  await call('PATCH', `/people/${spender.body.id}`, { isActive: true });
  ctx.check(
    '다시 표시하면 기본 목록에 돌아온다',
    (await call('GET', `/people${q}`)).body.some((p: any) => p.id === spender.body.id),
    true,
  );

  // 잔액이 남은 통장은 여전히 막는다 (순자산이 조용히 줄기 때문)
  ctx.check('잔액이 남은 통장은 숨길 수 없다', (await call('DELETE', `/accounts/${account.body.id}`)).status, 400);

  // ── 200건 넘는 달도 커서로 전부 받을 수 있다 ──
  const bulkDate = '2026-05-10T03:00:00.000Z';
  await ctx.prisma.journalEntry.createMany({
    data: Array.from({ length: 210 }, () => ({
      projectId: project.id, personId: person.body.id,
      date: new Date(bulkDate), description: '대량',
    })),
  });
  const bulkEntries = await ctx.prisma.journalEntry.findMany({
    where: { projectId: project.id, description: '대량' }, select: { id: true },
  });
  await ctx.prisma.posting.createMany({
    data: bulkEntries.flatMap((entry) => [
      { entryId: entry.id, accountId: account.body.id, amount: '-100', baseAmount: '-100' },
      { entryId: entry.id, categoryId: dining.body.id, amount: '100', baseAmount: '100' },
    ]),
  });

  const range = '&startDate=2026-05-01T00:00:00.000Z&endDate=2026-05-31T23:59:59.999Z';
  const firstPage = await call('GET', `/entries${q}${range}&limit=200`);
  ctx.check('첫 페이지는 200건', firstPage.body.data.length, 200);
  ctx.check('다음 커서가 있다', Boolean(firstPage.body.nextCursor), true);

  let total = firstPage.body.data.length;
  let cursor = firstPage.body.nextCursor;
  const seen = new Set<string>(firstPage.body.data.map((e: any) => e.id));
  while (cursor) {
    const page = await call('GET', `/entries${q}${range}&limit=200&cursor=${encodeURIComponent(cursor)}`);
    for (const entry of page.body.data) seen.add(entry.id);
    total += page.body.data.length;
    cursor = page.body.nextCursor;
  }
  ctx.check('커서를 따라가면 210건 전부', total, 210);
  ctx.check('중복 없이 받는다', seen.size, 210);
});
