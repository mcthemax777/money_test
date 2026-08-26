/**
 * 브라우저 검증용 데이터 심기.
 *
 * 스모크 스크립트와 달리 정리하지 않는다. 브라우저가 붙어서 눌러 볼 데이터라
 * 프로세스가 끝나도 남아 있어야 한다. 대신 만든 것의 id를 전부 찍어 주고,
 * `e2e-clean.ts`가 그 프로젝트/사용자만 골라 지운다.
 *
 * 실행: npx ts-node -P tsconfig.scripts.json -r tsconfig-paths/register scripts/e2e-seed.ts
 */

import { PrismaClient } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { CardsService } from '@/modules/cards/cards.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { zonedDayStart, zonedParts } from '@money/types';
import { makeAccounts, makeBudgets, makeEntries, makeLedger, projectAccessStub } from './smoke-harness';

const TZ = 'Asia/Seoul';
/** 이 접두사가 붙은 프로젝트/사용자만 정리 대상이다. */
export const E2E_TAG = 'e2e-browser';

async function main() {
  const prisma = new PrismaClient();

  const user = await prisma.user.create({
    data: {
      email: `${E2E_TAG}-${Date.now()}@example.com`,
      googleId: `${E2E_TAG}-${Date.now()}`,
      name: '브라우저 검증',
    },
  });
  const project = await prisma.project.create({
    data: { name: `${E2E_TAG} 가계부`, timezone: TZ },
  });
  await prisma.projectMember.create({
    data: { projectId: project.id, userId: user.id, role: 'owner' },
  });

  const pid = project.id;
  const uid = user.id;
  const access = projectAccessStub(prisma, pid);
  const ledger = makeLedger(prisma, access);
  const institutions = new InstitutionsService(prisma as any, access);
  const accounts = makeAccounts(prisma, access, ledger, institutions);
  const people = new PeopleService(prisma as any, access);
  const categories = new CategoriesService(prisma as any, access);
  const cards = new CardsService(prisma as any, access, institutions);
  const entries = makeEntries(prisma, access, ledger);
  const budgets = makeBudgets(prisma, access);

  const appa = await people.createPerson(uid, { name: '아빠' }, pid);
  const umma = await people.createPerson(uid, { name: '엄마' }, pid);
  await prisma.projectMember.updateMany({
    where: { projectId: pid, userId: uid },
    data: { personId: appa.id },
  });

  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;
  const housing = cats.find((c) => c.name === '공과금')!;
  const salary = cats.find((c) => c.type === 'income')!;
  await categories.updateCategory(housing.id, uid, { defaultIsFixed: true });

  const appaBank = await accounts.createAccount(
    uid,
    {
      type: 'deposit', ownerId: appa.id, name: '급여통장',
      institutionId: 'fi_bank_shinhan', openingBalance: '5000000',
    },
    pid,
  );
  const ummaBank = await accounts.createAccount(
    uid,
    {
      type: 'deposit', ownerId: umma.id, name: '생활비통장',
      institutionId: 'fi_bank_kb', openingBalance: '2000000',
    },
    pid,
  );
  await accounts.createAccount(
    uid,
    { type: 'investment', ownerId: appa.id, name: '삼성전자', openingBalance: '3000000' },
    pid,
  );

  const credit = await cards.createCard(
    uid,
    {
      paymentAccountId: appaBank.id, name: '신한 신용', cardType: 'credit',
      issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
      creditLimit: '10000000', performanceAmount: '300000',
    },
    pid,
  );
  const debit = await cards.createCard(
    uid,
    {
      paymentAccountId: ummaBank.id, name: '국민 체크', cardType: 'debit',
      issuerId: 'fi_card_kb', performanceAmount: '200000',
    },
    pid,
  );

  const today = zonedParts(new Date(), TZ);
  const daysAgo = (back: number) =>
    new Date(
      zonedDayStart(today.year, today.month, today.day - back, TZ).getTime() + 12 * 3600_000,
    ).toISOString();

  await entries.createEntry(uid, {
    kind: 'expense', personId: appa.id, date: daysAgo(0), description: '점심 김밥',
    amount: '12000', categoryId: dining.id, cardId: credit.id,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'expense', personId: appa.id, date: daysAgo(1), description: '전기요금',
    amount: '85000', categoryId: housing.id, accountId: appaBank.id, isFixed: true,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'expense', personId: umma.id, date: daysAgo(2), description: '장보기',
    amount: '64000', categoryId: dining.id, cardId: debit.id,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'income', personId: appa.id, date: daysAgo(3), description: '월급',
    amount: '3500000', categoryId: salary.id, accountId: appaBank.id, isFixed: true,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'transfer', personId: appa.id, date: daysAgo(4), description: '생활비 이체',
    amount: '500000', accountId: appaBank.id, toAccountId: ummaBank.id,
  }, pid);

  // 예산: 외식은 규칙 하나, 공과금은 이번 달만 조정해 둔다 (월별 목록 확인용)
  await budgets.createBudget(uid, {
    categoryId: dining.id, type: 'expense', monthlyAmount: '400000',
  }, pid);
  const housingBudget = await budgets.createBudget(uid, {
    categoryId: housing.id, type: 'expense', monthlyAmount: '150000',
  }, pid);
  await budgets.createOverride(uid, {
    budgetId: housingBudget.id, year: today.year, month: today.month, amount: '250000',
  });

  const jwt = new JwtService({ secret: process.env.JWT_SECRET });
  const token = jwt.sign({ sub: uid, email: user.email, type: 'access' }, { expiresIn: '2h' });

  console.log(
    JSON.stringify(
      {
        userId: uid,
        projectId: pid,
        token,
        people: { appa: appa.id, umma: umma.id },
        accounts: { appaBank: appaBank.id, ummaBank: ummaBank.id },
        cards: { credit: credit.id, debit: debit.id },
        categories: { dining: dining.id, housing: housing.id },
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

/*
 * 직접 실행할 때만 심는다.
 *
 * e2e-clean.ts가 E2E_TAG를 import하는데, 그것만으로 이 파일이 실행되면 지우자마자
 * 다시 심긴다 (실제로 그렇게 동작했다).
 */
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
