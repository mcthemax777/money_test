/**
 * 실제 HTTP 경로로 확인한다.
 * 서비스 직접 호출로는 잡히지 않는 DTO/컨트롤러 불일치를 여기서 잡는다.
 */

import { JwtService } from '@nestjs/jwt';

const BASE = 'http://localhost:3999';
import { runSmoke } from './smoke-harness';

runSmoke('http', async (ctx) => {
  const user = await ctx.createUser();
  const project = await ctx.createProject();
  await ctx.prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, role: 'owner' },
  });

  const jwtService = new JwtService({ secret: process.env.JWT_SECRET });
  const token = jwtService.sign(
    { sub: user.id, email: user.email, type: 'access' },
    { expiresIn: '1h' },
  );

  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    return { status: res.status, body: json };
  };

  const q = `?projectId=${project.id}`;

  // 1) 사람
  const person = await call('POST', `/people${q}`, { name: '김철수' });
  ctx.check('사람 생성', person.status, 201);

  // 2) 계좌 (웹 폼이 보내는 형태 그대로)
  const account = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id,
    type: 'deposit',
    name: '신한통장',
    institutionId: 'fi_bank_shinhan',
    openingBalance: '1000000',
    openingBalanceDate: '2026-01-01',
  });
  ctx.check('계좌 생성', account.status, 201);
  ctx.check('개설 잔액 반영', account.body?.balance, '1000000');

  // type 없이 보내면 거부되어야 한다
  const noType = await call('POST', `/accounts${q}`, {
    ownerId: person.body.id, name: '유형없음',
  });
  ctx.check('유형 없는 계좌 거부', noType.status >= 400, true);

  // 3) 카드 (웹 폼 형태)
  const credit = await call('POST', `/cards${q}`, {
    paymentAccountId: account.body.id,
    name: '신한 신용',
    cardType: 'credit',
    issuerId: 'fi_card_shinhan',
    creditLimit: '5000000',
    statementClosingDay: 15,
    paymentDueDay: 25,
  });
  ctx.check('신용카드 생성', credit.status, 201);
  ctx.check('부채 계정 자동 생성', Boolean(credit.body?.liabilityAccountId), true);

  // 4) 통장 목록에 부채 계정이 안 보여야 한다
  const accounts = await call('GET', `/accounts${q}`);
  ctx.check('통장 목록 (보통예금만)', accounts.body?.length, 1);

  // 5) 카테고리
  const cat = await call('POST', `/categories${q}`, { name: '식비', type: 'expense' });
  ctx.check('카테고리 생성', cat.status, 201);

  // 6) 거래 (신용카드 지출)
  const entry = await call('POST', `/entries${q}`, {
    kind: 'expense',
    personId: person.body.id,
    date: '2026-08-03T00:00:00.000Z',
    description: '스타벅스',
    merchant: '강남점',
    amount: '5000',
    categoryId: cat.body.id,
    cardId: credit.body.id,
  });
  ctx.check('신용카드 지출 생성', entry.status, 201);
  ctx.check('kind', entry.body?.kind, 'expense');
  ctx.check('통장 잔액 변동 없음',
    (await call('GET', `/accounts/${account.body.id}`)).body?.balance, '1000000');

  // 7) 목록 / 리포트
  // 기초잔액도 전표이므로 목록에 함께 나온다
  const list = await call('GET', `/entries${q}&limit=10`);
  ctx.check('거래 목록 (기초잔액 + 지출)', list.body?.data?.length, 2);
  ctx.check('목록 종류', list.body?.data?.map((e: any) => e.kind).sort().join(','), 'adjustment,expense');
  ctx.check('커서 (마지막 페이지)', list.body?.nextCursor, null);
  const summary = await call('GET', `/reports/summary${q}&yearMonth=2026-08`);
  ctx.check('월 지출 합계', summary.body?.expense, '5000');
  const netWorth = await call('GET', `/reports/net-worth${q}`);
  ctx.check('순자산 (예금 100만 - 카드 5천)', netWorth.body?.total, '995000');

  // 8) 청구서
  const statements = await call('GET', `/statements${q}`);
  ctx.check('청구서 자동 생성', statements.body?.length, 1);
  ctx.check('미결제액', statements.body?.[0]?.outstanding, '5000');

  const pay = await call('POST', `/statements/${statements.body[0].id}/pay`, {
    accountId: account.body.id,
    personId: person.body.id,
    date: '2026-08-25T00:00:00.000Z',
  });
  ctx.check('청구서 결제', pay.status, 201);
  ctx.check('결제 후 통장 잔액',
    (await call('GET', `/accounts/${account.body.id}`)).body?.balance, '995000');

  // 9) 계좌 원장
  const ledger = await call('GET', `/accounts/${account.body.id}/postings`);
  ctx.check('원장 행 수 (기초잔액 + 카드결제)', ledger.body?.data?.length, 2);

  // 10) 잔액 수정 -> 조정 전표
  await call('PATCH', `/accounts/${account.body.id}`, { balance: '900000' });
  ctx.check('잔액 조정',
    (await call('GET', `/accounts/${account.body.id}`)).body?.balance, '900000');

  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${project.id}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트', drift.length, 0);
});
