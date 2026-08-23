/**
 * 환율 경계 조건.
 *
 * `currency-smoke.ts`가 정상 경로를 본다면 여기는 어긋나기 쉬운 자리를 본다.
 * 반올림, 잘못된 환율, 수정/삭제 왕복, 기준통화 변경, 저장된 환율의 우선순위 같은
 * 것들이다. 전부 "오류 없이 조용히 틀린 숫자가 나오는" 종류라 눈으로는 안 잡힌다.
 *
 * 서버가 :3999에 떠 있어야 한다.
 */

import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { runSmoke } from './smoke-harness';

const BASE = 'http://localhost:3999';
const D = (n: string | number) => new Prisma.Decimal(n);

runSmoke('currency-edge', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
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
  const today = new Date().toISOString();

  /** 이 프로젝트의 모든 전표가 환산액 합계 0인지 */
  const unbalancedCount = async () => {
    const rows = await ctx.prisma.$queryRaw<{ id: string }[]>`
      SELECT e.id FROM "JournalEntry" e JOIN "Posting" p ON p."entryId" = e.id
      WHERE e."projectId" = ${project.id}
      GROUP BY e.id HAVING SUM(p."baseAmount") <> 0`;
    return rows.length;
  };
  /** 잔액 = 그 계좌 통화 posting 합계 */
  const driftCount = async () => {
    const rows = await ctx.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
      WHERE a."projectId" = ${project.id}
      GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
    return rows.length;
  };

  const person = await call('POST', `/people${q}`, { name: '김철수' });
  const dining = await call('POST', `/categories${q}`, { name: '외식', type: 'expense' });
  const cafe = await call('POST', `/categories${q}`, {
    name: '카페', type: 'expense', parentId: dining.body.id,
  });
  const krwBank = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, type: 'deposit', name: '원화통장', openingBalance: '5000000',
  });
  const usdBank = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, type: 'deposit', name: '달러통장', currency: 'USD',
    openingBalance: '1000',
  });
  const jpyBank = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, type: 'deposit', name: '엔화통장', currency: 'JPY',
    openingBalance: '100000',
  });

  // ── 1. 잘못된 환율은 거부한다 ──────────────────────────────
  const badRate = (rate: string) =>
    call('POST', `/entries${q}`, {
      kind: 'expense', personId: person.body.id, date: today,
      description: 'x', amount: '10', currency: 'USD', exchangeRate: rate,
      categoryId: dining.body.id, accountId: usdBank.body.id,
    });
  ctx.check('환율 0 거부', (await badRate('0')).status, 400);
  ctx.check('음수 환율 거부', (await badRate('-1380')).status, 400);
  ctx.check('숫자가 아닌 환율 거부', (await badRate('아무거나')).status, 400);

  // ── 2. 다룰 수 없는 통화 조합은 조용히 넘기지 않는다 ────────
  // 달러 통장에 엔화로 결제. 계좌 통화도 기준통화도 아니라 환산 기준이 없다.
  const jpyOnUsd = await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: 'x', amount: '1000', currency: 'JPY',
    categoryId: dining.body.id, accountId: usdBank.body.id,
  });
  ctx.check('USD 계좌에 JPY 결제는 거부', jpyOnUsd.status, 400);

  // ── 3. 엔화 반올림 (JPY는 소수를 쓰지 않는다) ───────────────
  // ¥3 * 9.2 = ₩27.6 -> 28. 원 단위로 떨어져야 한다.
  const jpySmall = await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '자판기', amount: '3',
    categoryId: dining.body.id, accountId: jpyBank.body.id,
  });
  ctx.check('엔화 소액 지출', jpySmall.status, 201);
  ctx.check('원 단위로 반올림', jpySmall.body.amount, '28');
  const jpyLegs = await ctx.prisma.posting.findMany({
    where: { entry: { description: '자판기' } },
    select: { amount: true, currency: true, baseAmount: true },
  });
  ctx.check(
    '엔화 다리는 엔화로 남는다',
    jpyLegs.find((l) => l.currency === 'JPY')?.amount.toString(),
    '-3',
  );
  ctx.check('전표 균형', await unbalancedCount(), 0);

  // ── 4. 분할 지출의 반올림 (줄마다 반올림해도 합계가 맞아야) ──
  // $33.33 + $33.33 + $33.34 를 1380으로. 줄마다 반올림한 합계와 계좌 다리가 같아야 한다.
  const split = await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '분할', amount: '100',
    splits: [
      { categoryId: dining.body.id, amount: '33.33' },
      { categoryId: cafe.body.id, amount: '33.33' },
      { categoryId: dining.body.id, amount: '33.34' },
    ],
    accountId: usdBank.body.id,
  });
  ctx.check('분할 외화 지출', split.status, 201);
  const splitLegs = await ctx.prisma.posting.findMany({
    where: { entry: { description: '분할' } },
    select: { amount: true, baseAmount: true, categoryId: true },
  });
  const splitBaseSum = splitLegs.reduce((acc, l) => acc.add(l.baseAmount), D(0));
  ctx.check('분할 전표 환산액 합계 0', splitBaseSum.toString(), '0');
  ctx.check(
    '계좌 다리는 입력한 달러 그대로',
    splitLegs.find((l) => !l.categoryId)?.amount.toString(),
    '-100',
  );
  ctx.check('전표 균형', await unbalancedCount(), 0);

  // ── 5. 저장된 환율이 고정값보다 우선한다 ───────────────────
  await ctx.prisma.exchangeRate.create({
    data: {
      projectId: project.id,
      baseCurrency: 'USD', quoteCurrency: 'KRW', rate: D('1500'),
      date: new Date('2026-08-23'), source: 'test',
    },
  });
  const ratesAfter = await call('GET', `/exchange-rates${q}`);
  ctx.check(
    'DB 환율이 우선',
    ratesAfter.body.rates.find((r: any) => r.from === 'USD')?.rate,
    '1500',
  );
  ctx.check(
    '출처도 함께 온다',
    ratesAfter.body.rates.find((r: any) => r.from === 'USD')?.source,
    'test',
  );

  const atNewRate = await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '새 환율', amount: '10',
    categoryId: dining.body.id, accountId: usdBank.body.id,
  });
  ctx.check('새 환율이 적용된다', atNewRate.body.amount, '15000');

  // 역수 조회: KRW -> USD 방향은 저장돼 있지 않으므로 뒤집어 쓴다.
  // 기준통화를 USD로 바꿀 때 이 경로를 탄다.
  await ctx.prisma.exchangeRate.deleteMany({ where: { source: 'test' } });
  await ctx.prisma.exchangeRate.create({
    data: {
      projectId: project.id,
      baseCurrency: 'USD', quoteCurrency: 'KRW', rate: D('1400'),
      date: new Date('2026-08-23'), source: 'inverse-test',
    },
  });
  const inverse = await call('GET', `/exchange-rates${q}`);
  ctx.check(
    '저장된 USD->KRW 가 쓰인다',
    inverse.body.rates.find((r: any) => r.from === 'USD')?.rate,
    '1400',
  );
  await ctx.prisma.exchangeRate.deleteMany({ where: { source: 'inverse-test' } });

  // ── 5-1. 설정 화면에서 환율을 직접 정한다 ──────────────────
  //
  // 거래 입력에서는 환율을 받지 않으므로, 기본값을 고치는 자리는 여기 하나뿐이다.
  const set = await call('PUT', `/exchange-rates${q}`, { from: 'USD', to: 'KRW', rate: '1450' });
  ctx.check('환율 설정', set.status, 200);
  ctx.check('설정한 값이 온다', set.body.rate, '1450');
  ctx.check('출처는 manual', set.body.source, 'manual');

  const afterSet = await call('GET', `/exchange-rates${q}`);
  ctx.check(
    '조회에도 반영된다',
    afterSet.body.rates.find((r: any) => r.from === 'USD')?.rate,
    '1450',
  );

  // 같은 통화쌍을 다시 넣으면 덮어쓴다. 하루에 두 줄이 남으면 어느 것이 쓰이는지 모른다.
  await call('PUT', `/exchange-rates${q}`, { from: 'USD', to: 'KRW', rate: '1460' });
  ctx.check(
    '다시 넣으면 덮어쓴다',
    await ctx.prisma.exchangeRate.count({ where: { projectId: project.id, source: 'manual' } }),
    1,
  );

  // 설정한 환율이 추정에 쓰인다 (신용카드 결제).
  const krwCard = await call('POST', `/cards${q}`, {
    paymentAccountId: krwBank.body.id, name: '원화카드', cardType: 'credit',
    issuerId: (await call('GET', `/institutions${q}&type=card_issuer`)).body[0].id,
    statementClosingDay: 15, paymentDueDay: 25,
  });
  const estimated = await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '설정 환율로 추정', amount: '10', currency: 'USD',
    categoryId: dining.body.id, cardId: krwCard.body.id,
  });
  ctx.check('설정한 환율로 추정된다', estimated.body.amount, '14600');
  ctx.check('추정이므로 잠정', estimated.body.rateProvisional, true);

  ctx.check(
    '잘못된 환율은 거부',
    (await call('PUT', `/exchange-rates${q}`, { from: 'USD', to: 'KRW', rate: '0' })).status,
    400,
  );
  ctx.check(
    '같은 통화끼리는 거부',
    (await call('PUT', `/exchange-rates${q}`, { from: 'KRW', to: 'KRW', rate: '1' })).status,
    400,
  );

  const cleared = await call('DELETE', `/exchange-rates${q}&from=USD&to=KRW`);
  ctx.check('설정 삭제', cleared.status, 204);
  const afterClear = await call('GET', `/exchange-rates${q}`);
  ctx.check(
    '기본값으로 되돌아간다',
    afterClear.body.rates.find((r: any) => r.from === 'USD')?.source,
    'fallback',
  );

  // ── 6. 외화 거래 수정 왕복 (금액이 흔들리지 않아야) ─────────
  const before = await call('GET', `/accounts/${usdBank.body.id}`);
  const edited = await call('PATCH', `/entries/${atNewRate.body.id}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '새 환율 (수정)',
    // 화면이 되돌려 보내는 값 그대로: 원 통화 금액 + 그때 적용된 환율
    amount: atNewRate.body.originalAmount,
    currency: atNewRate.body.originalCurrency,
    exchangeRate: atNewRate.body.exchangeRate,
    categoryId: dining.body.id, accountId: usdBank.body.id,
  });
  ctx.check('수정 성공', edited.status, 200);
  ctx.check('수정해도 환산액이 그대로', edited.body.amount, atNewRate.body.amount);
  ctx.check(
    '수정해도 계좌 잔액이 그대로',
    (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance,
    before.body.balance,
  );
  ctx.check('전표 균형', await unbalancedCount(), 0);
  ctx.check('잔액 드리프트', await driftCount(), 0);

  // ── 7. 외화 거래 삭제 (잔액이 그 통화로 되돌아가야) ─────────
  const beforeDelete = (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance;
  await call('DELETE', `/entries/${edited.body.id}`);
  ctx.check(
    '삭제하면 달러가 되돌아온다',
    (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance,
    D(beforeDelete).add(10).toString(),
  );
  ctx.check('잔액 드리프트', await driftCount(), 0);

  // ── 8. 수수료가 붙은 환전 ──────────────────────────────────
  const feeCategory = await call('POST', `/categories${q}`, { name: '수수료', type: 'expense' });
  const exchange = await call('POST', `/entries${q}`, {
    kind: 'transfer', personId: person.body.id, date: today,
    description: '수수료 환전', accountId: usdBank.body.id, toAccountId: krwBank.body.id,
    amount: '100', toAmount: '135000',
    transferFee: '2', transferFeeCategoryId: feeCategory.body.id,
  });
  ctx.check('수수료 환전 생성', exchange.status, 201);
  const exchangeLegs = await ctx.prisma.posting.findMany({
    where: { entry: { description: '수수료 환전' } },
    select: { amount: true, currency: true, baseAmount: true, accountId: true },
  });
  ctx.check(
    '보내는 계좌에서 금액 + 수수료가 빠진다',
    exchangeLegs.find((l) => l.accountId === usdBank.body.id)?.amount.toString(),
    '-102',
  );
  ctx.check(
    '받는 계좌에는 입력한 원화가 들어온다',
    exchangeLegs.find((l) => l.accountId === krwBank.body.id)?.amount.toString(),
    '135000',
  );
  ctx.check(
    '환전 전표 환산액 합계 0',
    exchangeLegs.reduce((acc, l) => acc.add(l.baseAmount), D(0)).toString(),
    '0',
  );

  // ── 9. 외화 계좌의 잔액 직접 수정 ──────────────────────────
  // 거래가 이미 있는 달러 통장의 잔액을 목표값으로 맞춘다.
  await call('PATCH', `/accounts/${usdBank.body.id}`, { balance: '2000' });
  ctx.check(
    '외화 잔액이 목표값이 된다',
    (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance,
    '2000',
  );
  ctx.check('전표 균형', await unbalancedCount(), 0);
  ctx.check('잔액 드리프트', await driftCount(), 0);

  // ── 10. 외화 카드 ──────────────────────────────────────────
  const issuer = await call('GET', `/institutions${q}&type=card_issuer`);
  const usdCard = await call('POST', `/cards${q}`, {
    paymentAccountId: usdBank.body.id, name: '해외카드', cardType: 'credit',
    issuerId: issuer.body[0].id, statementClosingDay: 15, paymentDueDay: 25,
  });
  ctx.check('달러 카드 생성', usdCard.status, 201);
  await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '카드 결제', amount: '40',
    categoryId: dining.body.id, cardId: usdCard.body.id,
  });
  const usdUsage = await call('GET', `/cards/${usdCard.body.id}/usage`);
  ctx.check('카드 사용현황에 통화가 온다', usdUsage.body.currency, 'USD');
  // 남은 대금은 그 카드의 통화다. 환산액이 아니다.
  ctx.check('남은 대금은 달러', usdUsage.body.outstanding, '40');

  // ── 11. 예산은 기준통화, 사용액도 환산액 ───────────────────
  const yearMonth = new Date().toISOString().slice(0, 7);
  await call('POST', `/budgets${q}`, {
    categoryId: dining.body.id, monthlyAmount: '1000000', yearMonth,
  });
  const monthly = await call(
    'GET',
    `/budgets/${yearMonth.slice(0, 4)}/${Number(yearMonth.slice(5))}?projectId=${project.id}`,
  );
  const diningRow = monthly.body.find((r: any) => r.categoryId === dining.body.id);
  ctx.check('예산 사용액이 숫자로 온다', Number.isFinite(Number(diningRow?.usedAmount)), true);
  ctx.check('사용액이 0보다 크다 (외화 지출이 환산돼 들어감)', Number(diningRow.usedAmount) > 0, true);

  // ── 12. 순자산: 외화 계좌가 환산돼 들어간다 ────────────────
  const netWorth = await call('GET', `/reports/net-worth${q}`);
  const usdBalance = Number((await call('GET', `/accounts/${usdBank.body.id}`)).body.balance);
  const jpyBalance = Number((await call('GET', `/accounts/${jpyBank.body.id}`)).body.balance);
  const krwBalance = Number((await call('GET', `/accounts/${krwBank.body.id}`)).body.balance);
  const expectedCash = krwBalance + Math.round(usdBalance * 1380) + Math.round(jpyBalance * 9.2);
  ctx.check('순자산 현금이 환산 합계와 맞는다', netWorth.body.cash, String(expectedCash));

  // 왕복 오차를 실제로 재려면 딱 떨어지지 않는 금액이 있어야 한다.
  // 1380으로 나누어떨어지지 않는 원화 금액을 몇 건 넣는다.
  for (const amount of ['13333', '77777', '1', '999999']) {
    await call('POST', `/entries${q}`, {
      kind: 'expense', personId: person.body.id, date: today,
      description: `우수리 ${amount}`, amount,
      categoryId: dining.body.id, accountId: krwBank.body.id,
    });
  }

  // ── 13. 표시 통화 변경 (저장값은 손대지 않는다) ────────────
  //
  // 표시 통화는 읽을 때만 적용된다. 저장된 baseAmount 는 그대로이므로
  // 몇 번을 오가든 원본이 정확히 되돌아와야 한다.
  const before13 = await call('GET', `/reports/summary${q}&yearMonth=${yearMonth}`);
  const usdBefore = (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance;
  const krwBefore = (await call('GET', `/accounts/${krwBank.body.id}`)).body.balance;

  // 저장값 스냅샷. 표시 통화를 바꿔도 한 행도 달라지면 안 된다.
  const snapshot = async () => {
    const rows = await ctx.prisma.posting.findMany({
      where: { entry: { projectId: project.id } },
      orderBy: { id: 'asc' },
      select: { id: true, amount: true, baseAmount: true, exchangeRate: true },
    });
    // 그대로 비교하면 로그가 수천 자가 된다. 해시로 줄인다.
    const text = rows
      .map((r) => `${r.id}:${r.amount}:${r.baseAmount}:${r.exchangeRate}`)
      .join('|');
    return `${rows.length}행 ${createHash('sha1').update(text).digest('hex').slice(0, 12)}`;
  };
  const storedBefore = await snapshot();

  const switched = await call('PATCH', `/projects/${project.id}`, { displayCurrency: 'USD' });
  ctx.check('표시 통화 변경', switched.status, 200);
  ctx.check('프로젝트 표시 통화', switched.body.displayCurrency, 'USD');
  ctx.check('저장 통화는 그대로', switched.body.ledgerCurrency, 'KRW');
  ctx.check('전표 균형', await unbalancedCount(), 0);
  ctx.check('잔액 드리프트 없음', await driftCount(), 0);
  ctx.check('저장값이 한 행도 바뀌지 않았다', await snapshot(), storedBefore);

  // 계좌 잔액은 그 계좌의 통화라 표시 통화와 무관하다.
  ctx.check(
    '달러 통장 잔액은 그대로',
    (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance,
    usdBefore,
  );
  ctx.check(
    '원화 통장 잔액도 그대로',
    (await call('GET', `/accounts/${krwBank.body.id}`)).body.balance,
    krwBefore,
  );

  // 합계는 표시 통화로 환산돼 나온다 (1380분의 1 부근)
  const after13 = await call('GET', `/reports/summary${q}&yearMonth=${yearMonth}`);
  const ratio = Number(before13.body.expense) / Number(after13.body.expense);
  ctx.check('지출 합계가 환율 배만큼 줄어 보인다', Math.abs(ratio - 1380) < 20, true);

  // 예산도 표시 통화로 보인다
  const monthlyAfter = await call(
    'GET',
    `/budgets/${yearMonth.slice(0, 4)}/${Number(yearMonth.slice(5))}?projectId=${project.id}`,
  );
  const diningAfter = monthlyAfter.body.find((r: any) => r.categoryId === dining.body.id);
  const budgetError = Math.abs(Number(diningAfter.monthlyAmount) - 1000000 / 1380);
  console.log(`  예산 표시: ${diningAfter.monthlyAmount} (이론값 ${(1000000 / 1380).toFixed(4)})`);
  ctx.check('예산액도 표시 통화로 보인다', budgetError < 0.01, true);

  // ── 14. 되돌리기: 완전히 같아야 한다 ───────────────────────
  const back = await call('PATCH', `/projects/${project.id}`, { displayCurrency: 'KRW' });
  ctx.check('되돌리기', back.body.displayCurrency, 'KRW');
  ctx.check('되돌린 뒤에도 저장값이 그대로', await snapshot(), storedBefore);

  const restored = await call('GET', `/reports/summary${q}&yearMonth=${yearMonth}`);
  console.log(`  왕복: ${before13.body.expense} -> ${restored.body.expense}`);
  // 저장값을 건드리지 않으므로 근사가 아니라 완전히 같아야 한다.
  ctx.check('왕복 후 지출 합계가 완전히 동일', restored.body.expense, before13.body.expense);
  ctx.check('왕복 후 수입 합계도 동일', restored.body.income, before13.body.income);

  // 여러 번 오가도 마찬가지다.
  for (const currency of ['USD', 'JPY', 'KRW', 'USD', 'KRW']) {
    await call('PATCH', `/projects/${project.id}`, { displayCurrency: currency });
  }
  ctx.check('다섯 번 오간 뒤에도 저장값 그대로', await snapshot(), storedBefore);
  ctx.check(
    '다섯 번 오간 뒤에도 합계 동일',
    (await call('GET', `/reports/summary${q}&yearMonth=${yearMonth}`)).body.expense,
    before13.body.expense,
  );

  // 저장 통화는 API로 바꿀 수 없다.
  ctx.check(
    '저장 통화 변경 시도는 통하지 않는다',
    (await call('PATCH', `/projects/${project.id}`, { ledgerCurrency: 'USD' })).status,
    400,
  );

  // ── 15. 이체 수정: 받은 금액의 단위가 뒤바뀌면 안 된다 ─────
  //
  // 목록의 amount는 기준통화 환산액이다. 통화가 다른 환전을 수정할 때 그 값을
  // "받은 금액" 칸에 되돌려 넣으면 원화 금액이 달러로 저장된다.
  const krwToUsd = await call('POST', `/entries${q}`, {
    kind: 'transfer', personId: person.body.id, date: today,
    description: '원화에서 달러로', accountId: krwBank.body.id, toAccountId: usdBank.body.id,
    amount: '138000', toAmount: '100',
  });
  ctx.check('원화 -> 달러 환전', krwToUsd.status, 201);
  ctx.check('표시 금액은 기준통화 환산액', krwToUsd.body.amount, '138000');
  ctx.check('받은 금액은 받는 계좌 통화', krwToUsd.body.toAmount, '100');
  ctx.check('받은 금액의 통화', krwToUsd.body.toCurrency, 'USD');

  const usdBeforeEdit = (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance;
  const reEdited = await call('PATCH', `/entries/${krwToUsd.body.id}`, {
    kind: 'transfer', personId: person.body.id, date: today,
    description: '원화에서 달러로 (수정)',
    accountId: krwBank.body.id, toAccountId: usdBank.body.id,
    // 화면이 되돌려 보내는 값 그대로
    amount: '138000',
    toAmount: krwToUsd.body.toAmount,
  });
  ctx.check('환전 수정 성공', reEdited.status, 200);
  ctx.check(
    '수정해도 달러 잔액이 그대로',
    (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance,
    usdBeforeEdit,
  );
  ctx.check('전표 균형', await unbalancedCount(), 0);
  ctx.check('잔액 드리프트', await driftCount(), 0);

  // ── 16. 잘못된 통화 ────────────────────────────────────────
  const noop = await call('PATCH', `/projects/${project.id}`, { displayCurrency: 'KRW' });
  ctx.check('같은 통화로 바꿔도 오류가 아니다', noop.status, 200);
  ctx.check(
    '지원하지 않는 통화 거부',
    (await call('PATCH', `/projects/${project.id}`, { displayCurrency: 'EUR' })).status,
    400,
  );
});
