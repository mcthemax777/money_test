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

  // 8) 카드 사용 현황과 대금 이체
  const usage = await call('GET', `/cards/${credit.body.id}/usage`);
  ctx.check('남은 대금', usage.body?.outstanding, '5000');
  ctx.check('사용액이 잡힌 주기',
    usage.body?.periods?.filter((p: any) => Number(p.usage) !== 0).length, 1);

  const pay = await call('POST', `/cards/${credit.body.id}/transfers`, {
    accountId: account.body.id,
    personId: person.body.id,
    amount: '5000',
    direction: 'payment',
    date: '2026-08-25T00:00:00.000Z',
  });
  ctx.check('대금 결제 기록', pay.status, 201);
  ctx.check('결제 후 통장 잔액',
    (await call('GET', `/accounts/${account.body.id}`)).body?.balance, '995000');

  // 9) 계좌 원장
  const ledger = await call('GET', `/accounts/${account.body.id}/postings`);
  ctx.check('원장 행 수 (기초잔액 + 카드결제)', ledger.body?.data?.length, 2);

  // 10) 잔액 수정 -> 조정 전표
  await call('PATCH', `/accounts/${account.body.id}`, { balance: '900000' });
  ctx.check('잔액 조정',
    (await call('GET', `/accounts/${account.body.id}`)).body?.balance, '900000');

  // 11) 예산: 규칙 -> 이 달만 조정 -> 전체 초기화
  //
  // 라우트 순서가 중요하다. DELETE /budgets(전체)와 DELETE /budgets/:id(하나)가
  // 같은 컨트롤러에 있어서, 순서가 어긋나면 전체 삭제가 id 없는 개별 삭제로 잡힌다.
  const budget = await call('POST', `/budgets${q}`, {
    categoryId: cat.body.id,
    type: 'expense',
    monthlyAmount: '300000',
  });
  ctx.check('예산 생성', budget.status, 201);

  const monthly = await call('GET', `/budgets/2026/8${q}`);
  const budgetRow = monthly.body?.find((r: any) => r.categoryId === cat.body.id);
  ctx.check('월별 예산 금액', budgetRow?.monthlyAmount, '300000');
  ctx.check('조정 전에는 조정 id가 없다', budgetRow?.overrideId ?? null, null);

  const override = await call('POST', '/budgets/override', {
    budgetId: budget.body.id,
    year: 2026,
    month: 8,
    amount: '500000',
  });
  ctx.check('이 달만 조정', override.status, 201);

  const overridden = await call('GET', `/budgets/2026/8${q}`);
  const overriddenRow = overridden.body?.find((r: any) => r.categoryId === cat.body.id);
  ctx.check('조정된 금액이 내려온다', overriddenRow?.monthlyAmount, '500000');
  ctx.check('조정 id도 함께 내려온다', overriddenRow?.overrideId, override.body.id);

  const nextMonth = await call('GET', `/budgets/2026/9${q}`);
  ctx.check('9월은 규칙 금액 그대로',
    nextMonth.body?.find((r: any) => r.categoryId === cat.body.id)?.monthlyAmount, '300000');

  const split = await call('PATCH', `/budgets/${budget.body.id}`, {
    monthlyAmount: '400000',
    applyMode: 'from',
    applyFromMonth: '2026-09',
  });
  ctx.check('9월부터 새 규칙', split.status, 200);
  ctx.check('9월 금액이 바뀐다',
    (await call('GET', `/budgets/2026/9${q}`)).body
      ?.find((r: any) => r.categoryId === cat.body.id)?.monthlyAmount, '400000');
  ctx.check('8월은 조정값 그대로',
    (await call('GET', `/budgets/2026/8${q}`)).body
      ?.find((r: any) => r.categoryId === cat.body.id)?.monthlyAmount, '500000');

  // 월별 목록. 'schedule'이 :year/:month 나 :id 로 잡히면 안 된다.
  const schedule = await call('GET', `/budgets/schedule${q}&categoryId=${cat.body.id}&startMonth=2026-08&months=3`);
  ctx.check('월별 예산 목록', schedule.status, 200);
  ctx.check('요청한 개수만큼', schedule.body?.length, 3);
  ctx.check('첫 달', schedule.body?.[0]?.yearMonth, '2026-08');
  ctx.check('8월은 조정된 금액', schedule.body?.[0]?.amount, '500000');
  ctx.check('8월 조정 id', schedule.body?.[0]?.overrideId, override.body.id);
  ctx.check('8월 규칙 금액은 그대로', schedule.body?.[0]?.ruleAmount, '300000');
  ctx.check('9월은 새 규칙', schedule.body?.[1]?.amount, '400000');
  ctx.check('9월은 조정 없음', schedule.body?.[1]?.overrideId ?? null, null);
  ctx.check('9월 규칙은 9월부터', schedule.body?.[1]?.effectiveFrom, '2026-09');

  const reset = await call('DELETE', `/budgets${q}`);
  ctx.check('예산 전체 삭제', reset.status, 200);
  ctx.check('지운 규칙 수 (원래 규칙 + 나눠 만든 규칙)', reset.body?.deleted, 2);
  ctx.check('삭제 뒤 규칙 목록은 비어 있다', (await call('GET', `/budgets${q}`)).body?.length, 0);
  ctx.check('삭제 뒤 월별 금액은 0',
    (await call('GET', `/budgets/2026/8${q}`)).body
      ?.find((r: any) => r.categoryId === cat.body.id)?.monthlyAmount, '0');

  // 12) 카드 실적. ':id/performance'가 ':id'보다 먼저 잡혀야 한다.
  const creditPerf = await call('GET', `/cards/${credit.body.id}/performance`);
  ctx.check('신용카드 실적 조회', creditPerf.status, 200);
  ctx.check('신용카드는 마감일 기준', creditPerf.body?.basis, 'statement');
  ctx.check('기준액을 안 넣었으면 null', creditPerf.body?.target ?? null, null);

  await call('PATCH', `/cards/${credit.body.id}`, { performanceAmount: '10000' });
  const withTarget = await call('GET', `/cards/${credit.body.id}/performance`);
  ctx.check('기준액이 반영된다', withTarget.body?.target, '10000');

  /*
   * 사용액 자체는 확인하지 않는다.
   *
   * 실적은 "지금 진행 중인 주기"만 본다. 이 스크립트의 거래는 고정 날짜(8/3)라
   * 언제 돌리느냐에 따라 그 주기 안팎을 오간다. 날짜와 무관하게 성립하는 관계만 본다.
   * 구간별 금액은 card-performance-smoke가 오늘 기준으로 날짜를 만들어 확인한다.
   */
  const perfUsage = Number(withTarget.body?.usage);
  ctx.check('남은 금액 = 기준액 - 사용액', withTarget.body?.remaining,
    perfUsage >= 10000 ? '0' : String(10000 - perfUsage));
  ctx.check('달성 여부도 같은 기준', withTarget.body?.achieved, perfUsage >= 10000);

  // 체크카드는 청구 주기가 없어 다른 경로로 계산한다. 그 경로도 열려 있는지 본다.
  const debit = await call('POST', `/cards${q}`, {
    paymentAccountId: account.body.id,
    name: '신한 체크',
    cardType: 'debit',
    issuerId: 'fi_card_shinhan',
    performanceAmount: '50000',
  });
  ctx.check('체크카드 생성', debit.status, 201);
  const debitPerf = await call('GET', `/cards/${debit.body.id}/performance`);
  ctx.check('체크카드 실적 조회', debitPerf.status, 200);
  ctx.check('체크카드는 달력 월 기준', debitPerf.body?.basis, 'month');
  ctx.check('체크카드 기준액', debitPerf.body?.target, '50000');
  ctx.check('구간 시작은 그 달 1일',
    new Date(debitPerf.body?.periodStart).getUTCDate(), 1);

  const drift = await ctx.prisma.$queryRaw<{ id: string }[]>`
    SELECT a.id FROM "Account" a LEFT JOIN "Posting" p ON p."accountId" = a.id
    WHERE a."projectId" = ${project.id}
    GROUP BY a.id, a.balance HAVING COALESCE(SUM(p.amount), 0) <> a.balance`;
  ctx.check('잔액 드리프트', drift.length, 0);
});
