/**
 * 청구액 확정 (원화 카드의 외화 결제).
 *
 * 원화 카드로 달러를 쓰면 실제 청구액은 결제일에야 정해진다. 그때까지 원장에는
 * 서버 추정 환율로 만든 환산액이 들어 있고(rateProvisional), 명세서가 나오면
 * 카드 화면에서 한 번에 확정한다.
 *
 * 여기서 보는 것은 "확정이 조용히 틀리지 않는가"다. 분할 거래의 줄 합계,
 * 할부 일정 보존, 남의 카드 거래 차단, 잔액 드리프트가 전부 그 종류다.
 *
 * 서버가 :3999에 떠 있어야 한다.
 */

import { JwtService } from '@nestjs/jwt';
import { runSmoke } from './smoke-harness';

const BASE = 'http://localhost:3999';

runSmoke('pending-rate', async (ctx) => {
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
  const shopping = await call('POST', `/categories${q}`, { name: '쇼핑', type: 'expense' });
  const salary = await call('POST', `/categories${q}`, { name: '급여', type: 'income' });
  const bank = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, type: 'deposit', name: '원화통장', openingBalance: '5000000',
  });
  const issuers = await call('GET', `/institutions${q}&type=card_issuer`);
  const card = await call('POST', `/cards${q}`, {
    paymentAccountId: bank.body.id, name: '국민카드', cardType: 'credit',
    issuerId: issuers.body[0].id, statementClosingDay: 15, paymentDueDay: 25,
  });
  const otherCard = await call('POST', `/cards${q}`, {
    paymentAccountId: bank.body.id, name: '다른카드', cardType: 'credit',
    issuerId: issuers.body[0].id, statementClosingDay: 15, paymentDueDay: 25,
  });

  const expense = (body: Record<string, unknown>) =>
    call('POST', `/entries${q}`, {
      kind: 'expense', personId: person.body.id, date: today, ...body,
    });
  const pending = () => call('GET', `/cards/${card.body.id}/pending-rates`);
  const settle = (body: unknown) => call('PATCH', `/cards/${card.body.id}/pending-rates`, body);
  const entryOf = (id: string) => call('GET', `/entries/${id}`);

  // ── 1. 무엇이 목록에 오르는가 ──────────────────────────────
  //
  // 환율을 서버가 채운 외화 결제만 오른다. 원화 거래는 청구액이 이미 정확하고,
  // 사용자가 환율을 직접 넣은 거래는 확정할 것이 없다.
  const usd = await expense({
    description: '해외 식당', amount: '50', currency: 'USD',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('외화 결제 생성', usd.status, 201);
  ctx.check('잠정 표시', usd.body.rateProvisional, true);
  ctx.check('추정 청구액 (1380)', usd.body.amount, '69000');

  const krw = await expense({
    description: '국내 식당', amount: '30000',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('원화 거래는 잠정이 아니다', krw.body.rateProvisional, false);

  const fixedRate = await expense({
    description: '환율 직접 입력', amount: '10', currency: 'USD', exchangeRate: '1400',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('환율을 직접 넣으면 잠정이 아니다', fixedRate.body.rateProvisional, false);

  const otherCardUsd = await expense({
    description: '다른 카드 해외 결제', amount: '20', currency: 'USD',
    categoryId: dining.body.id, cardId: otherCard.body.id,
  });

  const list = await pending();
  ctx.check('목록 응답', list.status, 200);
  ctx.check('이 카드의 미확정 1건만', list.body.items.length, 1);
  ctx.check('목록 통화', list.body.currency, 'KRW');
  ctx.check('원 통화 금액', list.body.items[0].originalAmount, '50');
  ctx.check('원 통화', list.body.items[0].originalCurrency, 'USD');
  ctx.check('추정 청구액', list.body.items[0].estimatedAmount, '69000');
  ctx.check('청구 주기가 온다', /^\d{4}-\d{2}$/.test(list.body.items[0].closingMonth), true);

  // ── 2. 청구액으로 확정 ─────────────────────────────────────
  //
  // 카드사는 자기 환율에 수수료를 얹으므로 추정과 다르다. 명세서 금액이 사실이다.
  const settled = await settle({ items: [{ entryId: usd.body.id, billedAmount: '71230' }] });
  ctx.check('확정 성공', settled.status, 200);
  ctx.check('확정 건수', settled.body.settled, 1);

  const afterSettle = await entryOf(usd.body.id);
  ctx.check('청구액이 반영된다', afterSettle.body.amount, '71230');
  ctx.check('잠정 표시가 풀린다', afterSettle.body.rateProvisional, false);
  ctx.check('원 통화 금액은 그대로', afterSettle.body.originalAmount, '50');
  ctx.check('환율은 둘의 비로 유도된다', afterSettle.body.exchangeRate, '1424.6');
  ctx.check('목록에서 빠진다', (await pending()).body.items.length, 0);
  ctx.check('전표 균형', await unbalancedCount(), 0);
  ctx.check('잔액 드리프트', await driftCount(), 0);

  const usageAfter = await call('GET', `/cards/${card.body.id}/usage`);
  ctx.check(
    '남은 대금에 확정액이 들어간다',
    usageAfter.body.outstanding,
    String(71230 + 30000 + 14000),
  );

  // ── 3. 환율 하나로 일괄 확정 ───────────────────────────────
  //
  // 명세서에 적용환율만 한 줄로 적혀 있는 경우다. 건마다 금액을 옮겨 적지 않는다.
  const batch = [
    await expense({
      description: '해외 A', amount: '10', currency: 'USD',
      categoryId: dining.body.id, cardId: card.body.id,
    }),
    await expense({
      description: '해외 B', amount: '3.33', currency: 'USD',
      categoryId: shopping.body.id, cardId: card.body.id,
    }),
  ];
  ctx.check('일괄 대상 2건', (await pending()).body.items.length, 2);

  const batchResult = await settle({
    rate: '1412.5',
    items: batch.map((e) => ({ entryId: e.body.id })),
  });
  ctx.check('일괄 확정 건수', batchResult.body.settled, 2);
  ctx.check('환율 × 금액', (await entryOf(batch[0].body.id)).body.amount, '14125');
  // 3.33 × 1412.5 = 4703.625 → 원 단위 반올림
  ctx.check('원 단위 반올림', (await entryOf(batch[1].body.id)).body.amount, '4704');
  ctx.check('일괄 확정 뒤 목록이 빈다', (await pending()).body.items.length, 0);
  ctx.check('전표 균형', await unbalancedCount(), 0);

  // ── 4. 분할 거래 ───────────────────────────────────────────
  //
  // 줄마다 반올림하면 합계가 청구액에서 벗어난다. 끝수는 한 줄에 몰아준다.
  const split = await expense({
    description: '해외 분할', currency: 'USD', amount: '100',
    cardId: card.body.id,
    splits: [
      { categoryId: dining.body.id, amount: '33.33' },
      { categoryId: shopping.body.id, amount: '66.67' },
    ],
  });
  ctx.check('분할 거래 생성', split.status, 201);
  await settle({ items: [{ entryId: split.body.id, billedAmount: '141111' }] });

  const splitLines = await ctx.prisma.posting.findMany({
    where: { entryId: split.body.id, categoryId: { not: null } },
    select: { amount: true },
  });
  const lineSum = splitLines.reduce((acc, p) => acc.add(p.amount), splitLines[0].amount.mul(0));
  ctx.check('줄 합계 = 청구액', lineSum.toString(), '141111');
  ctx.check('분할도 전표 균형', await unbalancedCount(), 0);
  ctx.check('잔액 드리프트', await driftCount(), 0);

  // ── 5. 할부는 확정 뒤에도 일정이 남는다 ────────────────────
  //
  // posting을 지우고 다시 만들면 할부 일정이 cascade로 사라진다. 금액만 고치는
  // 이유가 이것이다.
  const installment = await expense({
    description: '해외 할부', amount: '30', currency: 'USD',
    categoryId: shopping.body.id, cardId: card.body.id, installmentMonths: 3,
  });
  ctx.check('할부 거래 생성', installment.status, 201);
  await settle({ items: [{ entryId: installment.body.id, billedAmount: '42000' }] });

  const afterInstallment = await entryOf(installment.body.id);
  ctx.check('할부 개월수가 남는다', afterInstallment.body.installmentMonths, 3);
  const plans = await ctx.prisma.installmentPlan.count({
    where: { posting: { entryId: installment.body.id } },
  });
  ctx.check('할부 일정 행이 남는다', plans, 1);

  // ── 6. 거절해야 하는 요청 ──────────────────────────────────
  const done = batch[0].body.id;
  ctx.check(
    '이미 확정된 거래는 거부',
    (await settle({ items: [{ entryId: done, billedAmount: '1000' }] })).status,
    400,
  );
  ctx.check(
    '다른 카드의 거래는 거부',
    (await settle({ items: [{ entryId: otherCardUsd.body.id, billedAmount: '1000' }] })).status,
    404,
  );
  ctx.check(
    '환율과 청구액을 함께 주면 거부',
    (await settle({ rate: '1400', items: [{ entryId: done, billedAmount: '1000' }] })).status,
    400,
  );
  ctx.check('빈 목록은 거부', (await settle({ items: [] })).status, 400);

  const zeroTarget = await expense({
    description: '0원 확정 시도', amount: '5', currency: 'USD',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check(
    '0 이하 청구액은 거부',
    (await settle({ items: [{ entryId: zeroTarget.body.id, billedAmount: '0' }] })).status,
    400,
  );
  ctx.check('거부된 거래는 잠정으로 남는다', (await pending()).body.items.length, 1);
  ctx.check(
    '거부된 거래 금액은 그대로',
    (await entryOf(zeroTarget.body.id)).body.amount,
    '6900',
  );

  // 다른 카드 쪽은 하나도 건드리지 않았어야 한다.
  const otherPending = await call('GET', `/cards/${otherCard.body.id}/pending-rates`);
  ctx.check('다른 카드의 미확정은 그대로', otherPending.body.items.length, 1);
  ctx.check('다른 카드 거래 금액이 그대로', (await entryOf(otherCardUsd.body.id)).body.amount, '27600');

  // ── 7. 입력할 때부터 청구액을 아는 경우 ───────────────────
  //
  // 환율은 카드사가 정하는 값이라 사용자가 모른다. 반대로 "통장에서 얼마가
  // 빠졌는가"는 안다. 그래서 환율 대신 청구액으로도 입력할 수 있어야 한다.
  const withBilled = await expense({
    description: '청구액으로 입력', amount: '50', currency: 'USD', billedAmount: '71230',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('청구액으로 생성', withBilled.status, 201);
  ctx.check('그 금액 그대로 기록', withBilled.body.amount, '71230');
  ctx.check('잠정이 아니다', withBilled.body.rateProvisional, false);
  ctx.check('원 통화 금액은 남는다', withBilled.body.originalAmount, '50');
  ctx.check('환율은 역산된다', withBilled.body.exchangeRate, '1424.6');

  // 분할도 줄 비율대로 나뉘어 합계가 정확히 맞아야 한다.
  const splitBilled = await expense({
    description: '청구액 분할', currency: 'USD', amount: '100', billedAmount: '141111',
    cardId: card.body.id,
    splits: [
      { categoryId: dining.body.id, amount: '33.33' },
      { categoryId: shopping.body.id, amount: '66.67' },
    ],
  });
  const splitBilledLines = await ctx.prisma.posting.findMany({
    where: { entryId: splitBilled.body.id, categoryId: { not: null } },
    select: { amount: true },
  });
  ctx.check(
    '분할 줄 합계 = 청구액',
    splitBilledLines
      .reduce((acc, p) => acc.add(p.amount), splitBilledLines[0].amount.mul(0))
      .toString(),
    '141111',
  );

  // 잠정으로 들어간 건을 거래 수정에서 청구액으로 고치는 경로.
  // 카드 화면을 열지 않고 목록에서 바로 고치는 사용자가 있다.
  const editTarget = await expense({
    description: '수정으로 확정', amount: '20', currency: 'USD',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('수정 전에는 잠정', editTarget.body.rateProvisional, true);
  const edited = await call('PATCH', `/entries/${editTarget.body.id}${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '수정으로 확정', amount: '20', currency: 'USD', billedAmount: '28450',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('수정 성공', edited.status, 200);
  ctx.check('수정한 청구액이 들어간다', edited.body.amount, '28450');
  ctx.check('수정하면 잠정이 풀린다', edited.body.rateProvisional, false);

  // 환율도 청구액도 없이 다른 값만 고치면 잠정으로 남아야 한다.
  // 확정한 적이 없는데 확정 표시가 붙으면 카드 대조 목록에서 조용히 사라진다.
  const keepProvisional = await expense({
    description: '설명만 고칠 거래', amount: '20', currency: 'USD',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  const renamed = await call('PATCH', `/entries/${keepProvisional.body.id}${q}`, {
    kind: 'expense', personId: person.body.id, date: today,
    description: '설명을 고쳤다', amount: '20', currency: 'USD',
    categoryId: dining.body.id, cardId: card.body.id,
  });
  ctx.check('설명만 고치면 잠정 유지', renamed.body.rateProvisional, true);
  ctx.check('금액은 서버 환율로 다시 추정', renamed.body.amount, '27600');

  // ── 8. 신용카드가 아니면 추정으로 남길 수 없다 ─────────────
  //
  // 통장과 체크카드는 결제하는 그 자리에서 돈이 빠진다. 사용자가 실제 금액을
  // 알고 있고, 확정할 화면도 없다(카드 대조는 신용카드 전용이다).
  const debitCard = await call('POST', `/cards${q}`, {
    paymentAccountId: bank.body.id, name: '체크카드', cardType: 'debit',
    issuerId: issuers.body[0].id,
  });

  ctx.check(
    '원화 통장의 외화 지출은 청구액이 필요하다',
    (await expense({
      description: '통장 외화 지출', amount: '10', currency: 'USD',
      categoryId: dining.body.id, accountId: bank.body.id,
    })).status,
    400,
  );
  ctx.check(
    '체크카드도 마찬가지',
    (await expense({
      description: '체크카드 외화 결제', amount: '10', currency: 'USD',
      categoryId: dining.body.id, cardId: debitCard.body.id,
    })).status,
    400,
  );

  const debitBilled = await expense({
    description: '체크카드 외화 결제', amount: '10', currency: 'USD', billedAmount: '14120',
    categoryId: dining.body.id, cardId: debitCard.body.id,
  });
  ctx.check('청구액을 넣으면 통과', debitBilled.status, 201);
  ctx.check('확정으로 들어간다', debitBilled.body.rateProvisional, false);
  ctx.check('그 금액 그대로', debitBilled.body.amount, '14120');

  const debitRate = await expense({
    description: '환율로 넣은 통장 지출', amount: '10', currency: 'USD', exchangeRate: '1410',
    categoryId: dining.body.id, accountId: bank.body.id,
  });
  ctx.check('환율을 직접 넣어도 통과', debitRate.status, 201);
  ctx.check('환율 입력도 확정이다', debitRate.body.rateProvisional, false);

  ctx.check(
    '외화 수입도 실제 입금액이 필요하다',
    (await call('POST', `/entries${q}`, {
      kind: 'income', personId: person.body.id, date: today,
      description: '달러 수입', amount: '100', currency: 'USD',
      categoryId: salary.body.id, accountId: bank.body.id,
    })).status,
    400,
  );
  const income = await call('POST', `/entries${q}`, {
    kind: 'income', personId: person.body.id, date: today,
    description: '달러 수입', amount: '100', currency: 'USD', billedAmount: '138500',
    categoryId: salary.body.id, accountId: bank.body.id,
  });
  ctx.check('입금액을 넣으면 통과', income.status, 201);
  ctx.check('입금액 그대로', income.body.amount, '138500');

  // 위에서 남긴 신용카드 잠정 2건(확정 거부된 건, 설명만 고친 건)은 그대로다.
  ctx.check('신용카드 잠정은 그대로 남는다', (await pending()).body.items.length, 2);

  // 청구액을 쓸 수 없는 자리에서는 조용히 무시하지 않고 막는다.
  const usdBank = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, type: 'deposit', name: '달러통장', currency: 'USD',
    openingBalance: '1000',
  });
  ctx.check(
    '외화 계좌 거래는 청구액을 거부',
    (await expense({
      description: '달러 통장 지출', amount: '10', currency: 'USD', billedAmount: '14000',
      categoryId: dining.body.id, accountId: usdBank.body.id,
    })).status,
    400,
  );
  ctx.check(
    '기준통화 거래는 청구액을 거부',
    (await expense({
      description: '원화 지출', amount: '10000', billedAmount: '10000',
      categoryId: dining.body.id, cardId: card.body.id,
    })).status,
    400,
  );
  ctx.check(
    '0 이하 청구액은 거부',
    (await expense({
      description: '0원 청구액', amount: '10', currency: 'USD', billedAmount: '0',
      categoryId: dining.body.id, cardId: card.body.id,
    })).status,
    400,
  );

  ctx.check('마지막 전표 균형', await unbalancedCount(), 0);
  ctx.check('마지막 잔액 드리프트', await driftCount(), 0);
});
