/**
 * 다중 통화.
 *
 * 원장은 두 층으로 통화를 다룬다. posting의 `amount`는 그 다리가 가리키는
 * 대상의 통화이고, `baseAmount`는 프로젝트 기준통화 환산액이다. 균형(합계 0)은
 * 환산액으로 판정하고, 리포트·예산의 모든 합계도 환산액으로 더한다.
 * 반대로 계좌 잔액은 그 계좌의 통화 그대로 남는다.
 *
 * 서버가 :3999에 떠 있어야 한다.
 */

import { JwtService } from '@nestjs/jwt';
import { runSmoke } from './smoke-harness';

const BASE = 'http://localhost:3999';

/** 고정 환율 (ExchangeRatesService의 FALLBACK_RATES 와 같은 값) */
const USD_KRW = 1380;

runSmoke('currency', async (ctx) => {
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

  const person = await call('POST', `/people${q}`, { name: '김철수' });
  const dining = await call('POST', `/categories${q}`, { name: '외식', type: 'expense' });
  const salary = await call('POST', `/categories${q}`, { name: '급여', type: 'income' });
  const today = new Date().toISOString();

  // ── 환율 조회 ──────────────────────────────────────────────
  const rates = await call('GET', `/exchange-rates${q}`);
  ctx.check('저장 통화', rates.body?.ledgerCurrency, 'KRW');
  ctx.check('표시 통화', rates.body?.displayCurrency, 'KRW');
  ctx.check(
    'USD 환율을 준다',
    rates.body?.rates?.find((r: any) => r.from === 'USD')?.rate,
    String(USD_KRW),
  );
  ctx.check(
    'JPY도 함께 온다',
    Boolean(rates.body?.rates?.find((r: any) => r.from === 'JPY')),
    true,
  );

  // ── 계좌 ───────────────────────────────────────────────────
  const krwBank = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, type: 'deposit', name: '원화통장', openingBalance: '1000000',
  });
  ctx.check('통화를 생략하면 기준통화', krwBank.body.currency, 'KRW');

  const usdBank = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, type: 'deposit', name: '달러통장',
    currency: 'USD', openingBalance: '1000',
  });
  ctx.check('달러 통장 생성', usdBank.body.currency, 'USD');
  // 잔액은 그 계좌의 통화 그대로다. 1000이지 138만이 아니다.
  ctx.check('달러 통장 잔액은 달러', usdBank.body.balance, '1000');

  ctx.check(
    '지원하지 않는 통화는 거부',
    (await call('POST', `/accounts${q}`, {
      ownerId: person.body.id, type: 'deposit', name: 'x', currency: 'EUR',
    })).status,
    400,
  );

  // 기초잔액 전표의 환산액이 맞는지 (1000 * 1380)
  const openingBase = await ctx.prisma.posting.findFirstOrThrow({
    where: { accountId: usdBank.body.id },
  });
  ctx.check('기초잔액 환산액', openingBase.baseAmount.toString(), String(1000 * USD_KRW));
  ctx.check('기초잔액 통화', openingBase.currency, 'USD');

  // ── 달러 통장에서 달러로 지출 ───────────────────────────────
  const usdExpense = await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '현지 식당', amount: '50',
    categoryId: dining.body.id, accountId: usdBank.body.id,
  });
  ctx.check('달러 지출 생성', usdExpense.status, 201);
  // 목록 금액은 언제나 기준통화다. 원 통화는 따로 실린다.
  ctx.check('표시 금액은 환산액', usdExpense.body.amount, String(50 * USD_KRW));
  ctx.check('원 통화', usdExpense.body.originalCurrency, 'USD');
  ctx.check('원 통화 금액', usdExpense.body.originalAmount, '50');

  const usdAfter = await call('GET', `/accounts/${usdBank.body.id}`);
  ctx.check('달러 통장 잔액은 달러로 줄어든다', usdAfter.body.balance, '950');

  // ── 원화 카드로 달러 결제 ──────────────────────────────────
  // 청구되는 돈은 원화다. 원장은 전부 원화로 남고 $50는 표시용으로 붙는다.
  const issuer = await call('GET', `/institutions${q}&type=card_issuer`);
  const card = await call('POST', `/cards${q}`, {
    paymentAccountId: krwBank.body.id, name: '신한카드', cardType: 'credit',
    issuerId: issuer.body[0].id, statementClosingDay: 15, paymentDueDay: 25,
  });
  const foreignOnKrwCard = await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '해외 결제', amount: '50', currency: 'USD',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('원화 카드 외화 결제', foreignOnKrwCard.status, 201);
  ctx.check('청구액은 원화', foreignOnKrwCard.body.amount, String(50 * USD_KRW));
  ctx.check('원 통화가 남는다', foreignOnKrwCard.body.originalCurrency, 'USD');
  ctx.check('원 통화 금액', foreignOnKrwCard.body.originalAmount, '50');

  // 카드 부채 계정은 원화이므로 원화로 쌓인다
  const liability = await ctx.prisma.card.findUniqueOrThrow({
    where: { id: card.body.id }, select: { liabilityAccount: true },
  });
  ctx.check('카드 부채는 원화', liability.liabilityAccount?.currency, 'KRW');
  ctx.check(
    '카드 부채 금액',
    liability.liabilityAccount?.balance.toString(),
    String(-50 * USD_KRW),
  );

  // ── 사용자가 환율을 직접 고칠 수 있다 ──────────────────────
  const customRate = await call('POST', `/entries${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '명세서 환율 적용', amount: '100', currency: 'USD', exchangeRate: '1400',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('직접 넣은 환율이 적용된다', customRate.body.amount, '140000');

  // ── 달러 수입 ──────────────────────────────────────────────
  const usdIncome = await call('POST', `/entries${q}`, {
    kind: 'income', personId: person.body.id, date: today,
    description: '해외 급여', amount: '200',
    categoryId: salary.body.id, accountId: usdBank.body.id,
  });
  ctx.check('달러 수입 생성', usdIncome.status, 201);
  ctx.check('수입 표시 금액은 환산액', usdIncome.body.amount, String(200 * USD_KRW));
  ctx.check(
    '달러 통장 잔액',
    (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance,
    '1150',
  );

  // ── 환전 (달러 -> 원화) ────────────────────────────────────
  // 보낸 $100과 받은 ₩135,000을 그대로 적는다. 실효 환율 1350이 기록된다.
  const exchange = await call('POST', `/entries${q}`, {
    kind: 'transfer', personId: person.body.id, date: today,
    description: '환전', accountId: usdBank.body.id, toAccountId: krwBank.body.id,
    amount: '100', toAmount: '135000',
  });
  ctx.check('환전 생성', exchange.status, 201);
  ctx.check(
    '달러 통장에서 100 빠진다',
    (await call('GET', `/accounts/${usdBank.body.id}`)).body.balance,
    '1050',
  );
  ctx.check(
    '원화 통장에 135000 들어온다',
    (await call('GET', `/accounts/${krwBank.body.id}`)).body.balance,
    '1135000',
  );

  const exchangePostings = await ctx.prisma.posting.findMany({
    where: { entry: { description: '환전' } },
  });
  const exchangeBase = exchangePostings.reduce(
    (acc, p) => acc.add(p.baseAmount),
    exchangePostings[0].baseAmount.mul(0),
  );
  ctx.check('환전 전표도 환산액 합계가 0', exchangeBase.toString(), '0');

  // ── 전표 균형 (전체) ───────────────────────────────────────
  const unbalanced = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT e.id FROM "JournalEntry" e JOIN "Posting" p ON p."entryId" = e.id
    WHERE e."projectId" = ${project.id}
    GROUP BY e.id HAVING SUM(p."baseAmount") <> 0`;
  ctx.check('환산액이 맞지 않는 전표', unbalanced.length, 0);

  // 잔액 = posting 합계 (각 계좌의 통화 기준)
  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${project.id}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트', drift.length, 0);

  // ── 리포트가 통화를 섞지 않는다 ────────────────────────────
  const yearMonth = new Date().toISOString().slice(0, 7);
  const summary = await call('GET', `/reports/summary${q}&yearMonth=${yearMonth}`);
  // 지출: 달러 $50(69,000) + 해외결제 $50(69,000) + 환율지정 $100(140,000)
  ctx.check('월 지출 합계 (환산액)', summary.body.expense, String(69000 + 69000 + 140000));
  ctx.check('월 수입 합계 (환산액)', summary.body.income, String(200 * USD_KRW));

  // ── 순자산: 외화는 최신 환율로 재평가 ──────────────────────
  const netWorth = await call('GET', `/reports/net-worth${q}`);
  // 현금 = 원화 1,135,000 + 달러 1,050 * 1380
  ctx.check('순자산 현금', netWorth.body.cash, String(1135000 + 1050 * USD_KRW));
  // 장부가와 재평가액이 같은 환율이므로 미실현 손익은 환전분만 남는다
  ctx.check('미실현 손익이 숫자로 온다', Number.isFinite(Number(netWorth.body.unrealizedGain)), true);
});
