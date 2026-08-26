/**
 * 자산 잔액 추이의 구간 단위.
 *
 * 화면에서 일/월/년을 직접 고를 수 있게 되면서 서버가 세 가지 창을 만든다.
 *   - year  : endMonth의 연도를 포함해 뒤로 years개
 *   - month : endMonth를 포함해 뒤로 months개 (원래 있던 것)
 *   - day   : yearMonth를 주면 그 달 1일~말일, 안 주면 오늘까지 최근 days개
 *
 * 값은 "그 구간 끝까지 쌓인 잔액"이다. 구간이 달라져도 같은 시점의 잔액은 같아야 한다.
 */

import { PeopleService } from '@/modules/people/people.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { zonedDateKey, zonedDayStart, zonedParts } from '@money/types';
import {
  makeAccounts,
  makeEntries,
  makeLedger,
  makeReports,
  projectAccessStub,
  runSmoke,
} from './smoke-harness';

const TZ = 'Asia/Seoul';

runSmoke('balance-history', async (ctx) => {
  const project = await ctx.createProject({ timezone: TZ });
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const reports = makeReports(ctx.prisma, access);

  const chulsoo = await people.createPerson(uid, { name: '김철수' }, pid);
  await categories.createDefaultCategories(pid);
  const cats = await categories.getCategories(uid, undefined, pid);
  const dining = cats.find((c) => c.name === '외식')!;

  const bank = await accounts.createAccount(
    uid,
    {
      type: 'deposit',
      ownerId: chulsoo.id,
      name: '보통예금',
      institutionId: 'fi_bank_shinhan',
      openingBalance: '1000000',
    },
    pid,
  );

  /** 서울 기준 그 날 정오. 날짜 경계에 걸리지 않게 한낮으로 둔다. */
  const at = (year: number, month: number, day: number) =>
    new Date(zonedDayStart(year, month, day, TZ).getTime() + 12 * 3600_000).toISOString();

  const spend = (amount: string, date: string, description: string) =>
    entries.createEntry(
      uid,
      {
        kind: 'expense',
        personId: chulsoo.id,
        date,
        description,
        amount,
        categoryId: dining.id,
        accountId: bank.id,
      },
      pid,
    );

  // 2025년에 10만, 2026년 8월에 20만을 쓴다.
  await spend('100000', at(2025, 3, 10), '2025년 지출');
  await spend('200000', at(2026, 8, 10), '2026년 지출');

  // ── 연 단위 ──
  const years = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'year',
    endMonth: '2026-08',
    years: 3,
  });
  ctx.check('연 단위: 3개', years.length, 3);
  ctx.check('연 단위: 라벨은 연도만', years.map((p) => p.date).join(','), '2024,2025,2026');
  ctx.check('연 단위: 2024년 말 = 기초잔액', years[0]?.balance, '1000000');
  ctx.check('연 단위: 2025년 말 = 100000 빠짐', years[1]?.balance, '900000');
  ctx.check('연 단위: 2026년 말 = 200000 더 빠짐', years[2]?.balance, '700000');

  // years를 안 주면 기본 5년
  const defaultYears = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'year',
    endMonth: '2026-08',
  });
  ctx.check('연 단위: years 생략은 5년', defaultYears.length, 5);
  ctx.check('연 단위: 마지막 해는 endMonth의 연도', defaultYears[4]?.date, '2026');

  // 상한 (최대 30년). 넘겨도 잘린다.
  const cappedYears = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'year',
    endMonth: '2026-08',
    years: 999,
  });
  ctx.check('연 단위: 30년으로 자른다', cappedYears.length, 30);

  // ── 연 단위와 월 단위가 같은 시점을 같은 값으로 본다 ──
  const months = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'month',
    endMonth: '2026-12',
    months: 12,
  });
  ctx.check('월 단위: 2026-12 잔액', months[months.length - 1]?.balance, '700000');
  ctx.check('연 단위 2026 = 월 단위 2026-12', years[2]?.balance, months[months.length - 1]?.balance);

  // ── 일 단위: yearMonth를 주면 그 달 전체 ──
  const augDays = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'day',
    yearMonth: '2026-08',
  });
  ctx.check('일 단위(그 달): 31일', augDays.length, 31);
  ctx.check('일 단위(그 달): 첫 칸은 1일', augDays[0]?.date, '2026-08-01');
  ctx.check('일 단위(그 달): 지출 전날은 900000', augDays[8]?.balance, '900000');
  ctx.check('일 단위(그 달): 지출 당일은 700000', augDays[9]?.balance, '700000');

  // ── 일 단위: yearMonth 없이 오늘까지 최근 N일 ──
  const today = zonedParts(new Date(), TZ);
  const dayKey = (back: number) =>
    zonedDateKey(zonedDayStart(today.year, today.month, today.day - back, TZ), TZ);

  const recent = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'day',
    days: 7,
  });
  ctx.check('최근 N일: 7개', recent.length, 7);
  ctx.check('최근 N일: 마지막 칸은 오늘', recent[6]?.date, dayKey(0));
  ctx.check('최근 N일: 첫 칸은 6일 전', recent[0]?.date, dayKey(6));
  ctx.check('최근 N일: 오늘 잔액은 현재 잔액', recent[6]?.balance, '700000');

  // 달 경계를 넘어도 날짜가 이어진다. 45일이면 반드시 앞 달로 넘어간다.
  const across = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'day',
    days: 45,
  });
  ctx.check('최근 N일: 45개', across.length, 45);
  ctx.check('최근 N일: 첫 칸은 44일 전', across[0]?.date, dayKey(44));
  ctx.check(
    '최근 N일: 달을 넘어간다',
    new Set(across.map((p) => p.date.slice(0, 7))).size > 1,
    true,
  );
  ctx.check(
    '최근 N일: 날짜가 오름차순으로 하루씩',
    across.every((point, i) => i === 0 || point.date > across[i - 1].date),
    true,
  );

  // days 기본값 30, 상한 366
  const defaultDays = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'day',
  });
  ctx.check('최근 N일: days 생략은 30일', defaultDays.length, 30);

  const cappedDays = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'day',
    days: 9999,
  });
  ctx.check('최근 N일: 366일로 자른다', cappedDays.length, 366);

  // ── 알 수 없는 granularity는 월로 본다 (기존 동작) ──
  const fallback = await reports.getBalanceHistory(uid, {
    projectId: pid,
    accountId: bank.id,
    granularity: 'week' as any,
    endMonth: '2026-08',
    months: 2,
  });
  ctx.check('모르는 단위는 월로 본다', fallback.map((p) => p.date).join(','), '2026-07,2026-08');
});
