/**
 * 카드 이용내역(2026년 8월)을 거래로 넣는다.
 *
 * `내역/` 폴더의 카드사 앱 스크린샷을 읽어 옮긴 것이다. 화면에서 100건 가까이
 * 손으로 입력하는 대신 여기 적어 두고 한 번에 넣는다.
 *
 *   PROJECT_ID=<id> npx ts-node -r tsconfig-paths/register \
 *     --project tsconfig.scripts.json scripts/seed-statements.ts
 *
 * 먼저 scripts/seed-categories.ts 로 분류를 만들어 두어야 한다. 아래 표가 그
 * 분류 이름을 그대로 가리킨다.
 *
 * 승인취소된 건은 넣지 않는다. 청구되지 않은 돈이라 가계부에 남을 이유가 없다.
 * 부분취소는 최종 승인 금액만 넣는다.
 */

import { CategoryType, PrismaClient } from '@prisma/client';
import { CardsService } from '@/modules/cards/cards.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { makeAccounts, makeEntries, makeLedger, projectAccessStub } from './smoke-harness';

/** 카드 세 장. 결제 통장은 카드사에 맞춰 나눈다. */
type CardKey = 'kbDebit' | 'kbCredit' | 'hana';

interface Row {
  /** "MM-DD" (2026년) */
  day: string;
  /** "HH:mm" */
  time: string;
  merchant: string;
  /** 원화 금액. currency가 있으면 그 통화의 금액이다. */
  amount: string;
  /** [대분류] 또는 [대분류, 소분류] */
  category: [string] | [string, string];
  /** 외화 결제. 청구액은 결제일에 정해지므로 비워 둔다(추정으로 들어간다). */
  currency?: 'USD';
}

/**
 * 국민 체크카드 (nori 체크카드). 26.08.01 ~ 08.22, 8건 34,500원.
 * 체크카드는 결제 즉시 통장에서 빠진다.
 */
const KB_DEBIT: Row[] = [
  { day: '08-05', time: '19:16', merchant: '지에스25 구로행운점', amount: '2000', category: ['식비', '간식'] },
  { day: '08-05', time: '17:40', merchant: '지에스25 아라정서진점', amount: '2000', category: ['식비', '간식'] },
  { day: '08-05', time: '16:11', merchant: '지에스25 구로행운점', amount: '3000', category: ['식비', '간식'] },
  { day: '08-05', time: '16:09', merchant: '지에스25 구로행운점', amount: '2400', category: ['식비', '간식'] },
  { day: '08-02', time: '15:15', merchant: '지에스25 구로행운점', amount: '2200', category: ['식비', '간식'] },
  { day: '08-01', time: '23:45', merchant: 'CJ CGV 예매', amount: '16000', category: ['문화생활'] },
  { day: '08-01', time: '22:55', merchant: '이마트24 개봉크로바점', amount: '4500', category: ['식비', '간식'] },
  { day: '08-01', time: '07:20', merchant: '지에스25 구로행운점', amount: '2400', category: ['식비', '간식'] },
];

/**
 * 국민 신용카드 (ktMmobile카드 6039). 26.08.01 ~ 08.22.
 *
 * 화면 합계는 국내 386,670원인데 아래 표의 합은 369,470원이다. 스크린샷이 긴
 * 화면을 이어 붙이면서 08월02일 KCP 줄 부근에서 한 건(17,200원)을 잃어버렸다.
 * 그 건은 원본을 다시 받아 채워야 한다.
 */
const KB_CREDIT: Row[] = [
  { day: '08-22', time: '15:11', merchant: '카페 타샤', amount: '2800', category: ['식비', '외식'] },
  { day: '08-22', time: '15:05', merchant: '씨유(CU) 개봉우리점', amount: '4500', category: ['식비', '간식'] },

  { day: '08-21', time: '19:53', merchant: '카페 타샤', amount: '2800', category: ['식비', '외식'] },
  { day: '08-21', time: '19:34', merchant: '오달소', amount: '32000', category: ['식비', '외식'] },
  { day: '08-21', time: '17:10', merchant: 'KICC(서울시현장)', amount: '800', category: ['교통', '주차비'] },
  { day: '08-21', time: '12:29', merchant: '이짬뽕', amount: '24000', category: ['식비', '외식'] },
  { day: '08-21', time: '00:20', merchant: '지에스25 구로행운점', amount: '4500', category: ['식비', '간식'] },

  { day: '08-19', time: '22:00', merchant: '카페 타샤', amount: '2700', category: ['식비', '외식'] },
  { day: '08-19', time: '21:24', merchant: '씨유(CU) 개봉우리점', amount: '2500', category: ['식비', '간식'] },
  { day: '08-19', time: '16:32', merchant: '씨유 가산디지털단지역점', amount: '4500', category: ['식비', '간식'] },
  { day: '08-19', time: '16:30', merchant: '투썸플레이스 가산디지털점', amount: '5600', category: ['식비', '외식'] },
  { day: '08-19', time: '08:41', merchant: 'KT통신요금자동납부', amount: '30740', category: ['공과금', '휴대폰비'] },

  { day: '08-18', time: '20:32', merchant: '카페 타샤', amount: '2800', category: ['식비', '외식'] },
  { day: '08-18', time: '20:26', merchant: '씨유(CU) 개봉우리점', amount: '5200', category: ['식비', '간식'] },
  { day: '08-18', time: '20:17', merchant: '(주)현대석유', amount: '10000', category: ['교통', '주유비'] },
  { day: '08-18', time: '18:34', merchant: '쿠팡(쿠페이)', amount: '15130', category: ['생활비', '생필품'] },
  // 외화 결제. 청구액은 결제일에 정해지므로 비워 둔다.
  { day: '08-18', time: '00:49', merchant: 'GODADDY#4160007742', amount: '1.20', category: ['기타', '월/연회비'], currency: 'USD' },

  { day: '08-17', time: '20:59', merchant: '춘천집', amount: '34000', category: ['식비', '외식'] },

  { day: '08-15', time: '12:57', merchant: '투썸플레이스', amount: '5500', category: ['식비', '외식'] },

  { day: '08-14', time: '23:49', merchant: '씨유(CU) 개봉우리점', amount: '3300', category: ['식비', '간식'] },
  { day: '08-14', time: '22:26', merchant: '플렉스 피씨(FLEX PC) 오류점', amount: '10000', category: ['문화생활'] },
  { day: '08-14', time: '20:55', merchant: '플렉스 피씨(FLEX PC) 오류점', amount: '8000', category: ['문화생활'] },
  { day: '08-14', time: '20:40', merchant: '플렉스 피씨(FLEX PC) 오류점', amount: '10000', category: ['문화생활'] },
  { day: '08-14', time: '12:48', merchant: '인성약국', amount: '55000', category: ['의료/건강', '약국'] },

  { day: '08-12', time: '21:50', merchant: '카페 타샤', amount: '2800', category: ['식비', '외식'] },
  { day: '08-12', time: '19:19', merchant: '쿠팡이츠', amount: '22800', category: ['식비', '배달'] },

  { day: '08-08', time: '22:33', merchant: '쿠팡이츠', amount: '40800', category: ['식비', '배달'] },
  { day: '08-08', time: '16:13', merchant: '할리스(가산디지털단지점)', amount: '6900', category: ['식비', '외식'] },

  { day: '08-02', time: '18:02', merchant: '옵티멈존PC카페 철산로데오점', amount: '10900', category: ['문화생활'] },
  { day: '08-02', time: '17:58', merchant: '옵티멈존PC카페 철산로데오점', amount: '6900', category: ['문화생활'] },
  { day: '08-02', time: '02:54', merchant: 'KCP(통신판매)', amount: '2000', category: ['기타', '월/연회비'] },
];

/** 하나 신용카드 (com2us 카드, 본인0775). 08.01 ~ 08.23, 합계 407,716원. */
const HANA_CREDIT: Row[] = [
  { day: '08-17', time: '12:15', merchant: '이마트24 가산대명벨리온점', amount: '4500', category: ['식비', '간식'] },
  { day: '08-17', time: '11:46', merchant: '코페이', amount: '11100', category: ['기타'] },

  { day: '08-16', time: '11:41', merchant: '씨유(CU) 개봉우리점', amount: '1200', category: ['식비', '간식'] },
  { day: '08-16', time: '11:39', merchant: '씨유(CU) 개봉우리점', amount: '1800', category: ['식비', '간식'] },

  { day: '08-15', time: '19:16', merchant: '(주)아성다이소', amount: '1000', category: ['생활비', '생필품'] },
  { day: '08-15', time: '12:52', merchant: '씨유(CU) 오류주민센터점', amount: '4500', category: ['식비', '간식'] },
  { day: '08-15', time: '10:51', merchant: '관악구시설관리공단', amount: '2500', category: ['교통', '주차비'] },
  { day: '08-15', time: '08:05', merchant: '카페베네', amount: '4500', category: ['식비', '외식'] },

  { day: '08-14', time: '18:30', merchant: '쿠팡이츠', amount: '20000', category: ['식비', '배달'] },
  { day: '08-14', time: '12:40', merchant: '인성약국', amount: '4600', category: ['의료/건강', '약국'] },
  { day: '08-14', time: '12:37', merchant: '삼성미래여성병원', amount: '3500', category: ['의료/건강', '병원'] },
  { day: '08-14', time: '12:37', merchant: '삼성미래여성병원', amount: '17800', category: ['의료/건강', '병원'] },
  { day: '08-14', time: '11:03', merchant: '메가엠지씨커피 오류남부점', amount: '2000', category: ['식비', '외식'] },
  { day: '08-14', time: '10:55', merchant: '브레드 홍', amount: '3500', category: ['식비', '간식'] },

  { day: '08-13', time: '18:20', merchant: '쿠팡(쿠페이)', amount: '4900', category: ['생활비', '생필품'] },
  { day: '08-13', time: '16:45', merchant: '투썸플레이스 가산디지털점', amount: '4700', category: ['식비', '외식'] },

  { day: '08-12', time: '21:41', merchant: '씨유(CU) 개봉우리점', amount: '4500', category: ['식비', '간식'] },

  { day: '08-11', time: '07:37', merchant: '쿠팡(쿠페이)', amount: '14580', category: ['생활비', '생필품'] },

  { day: '08-10', time: '17:58', merchant: '지에스25 구로행운점', amount: '2000', category: ['식비', '간식'] },

  { day: '08-09', time: '08:11', merchant: '스타벅스코리아', amount: '4700', category: ['식비', '외식'] },

  { day: '08-08', time: '22:37', merchant: '씨유홍대3호점', amount: '7700', category: ['식비', '간식'] },
  { day: '08-08', time: '20:37', merchant: '쿠팡(쿠페이)', amount: '16580', category: ['생활비', '생필품'] },
  { day: '08-08', time: '16:04', merchant: '씨유가산디지털단지역점', amount: '5200', category: ['식비', '간식'] },
  { day: '08-08', time: '12:51', merchant: '메가엠지씨커피 시흥능곡역점', amount: '1000', category: ['식비', '외식'] },
  { day: '08-08', time: '12:43', merchant: '냉면쟁이고기꾼', amount: '23000', category: ['식비', '외식'] },
  { day: '08-08', time: '08:34', merchant: '지에스25 구로행운점', amount: '3900', category: ['식비', '간식'] },

  { day: '08-07', time: '22:43', merchant: '(주)현대석유', amount: '50000', category: ['교통', '주유비'] },
  { day: '08-07', time: '19:03', merchant: '다락회전초밥', amount: '30400', category: ['식비', '외식'] },

  { day: '08-06', time: '22:15', merchant: '쿠팡(쿠페이)', amount: '39280', category: ['생활비', '생필품'] },

  { day: '08-05', time: '11:36', merchant: '(주)요헤미티', amount: '39000', category: ['식비', '외식'] },

  { day: '08-04', time: '14:15', merchant: '씨유(CU) 금천하이시티점', amount: '4500', category: ['식비', '간식'] },

  { day: '08-03', time: '12:10', merchant: 'Amazon_AWS_KCP', amount: '826', category: ['기타', '월/연회비'] },
  { day: '08-03', time: '12:10', merchant: 'Amazon_AWS_KCP', amount: '850', category: ['기타', '월/연회비'] },

  { day: '08-01', time: '23:41', merchant: '쿠팡(쿠페이)', amount: '12300', category: ['생활비', '생필품'] },
  { day: '08-01', time: '23:39', merchant: '쿠팡(쿠페이)', amount: '49310', category: ['생활비', '생필품'] },
  // 부분취소. 67,600원 중 5,990원만 남았다.
  { day: '08-01', time: '23:32', merchant: '쿠팡(쿠페이)', amount: '5990', category: ['생활비', '생필품'] },
];

async function main() {
  const prisma = new PrismaClient();

  try {
    const projectId = await resolveProjectId(prisma);
    const member = await prisma.projectMember.findFirstOrThrow({
      where: { projectId, role: 'owner' },
      select: { userId: true },
    });
    const userId = member.userId;

    // 권한 검증은 이 스크립트의 관심사가 아니다. 타임존은 프로젝트 값을 읽는다
    // (거래 시각을 그 타임존의 벽시계로 해석해야 날짜가 맞는다).
    const access = projectAccessStub(prisma, projectId);
    const ledger = makeLedger(prisma, access);
    const institutions = new InstitutionsService(prisma as any, access);
    const accounts = makeAccounts(prisma, access, ledger, institutions);
    const entries = makeEntries(prisma, access, ledger);
    const people = new PeopleService(prisma as any, access);
    const cards = new CardsService(prisma as any, access, institutions);

    const existing = await prisma.journalEntry.count({ where: { projectId } });
    if (existing > 0 && process.env.FORCE !== '1') {
      throw new Error(
        `이 프로젝트에 이미 거래가 ${existing}건 있습니다. 두 번 넣으면 그대로 겹칩니다. ` +
          '정말 넣으려면 FORCE=1 을 주세요.',
      );
    }

    const owner = await ensurePerson(people, prisma, userId, projectId, '김용찬');
    await ensurePerson(people, prisma, userId, projectId, '강보민');

    const kbBank = await accounts.createAccount(
      userId,
      { type: 'deposit', ownerId: owner.id, name: '국민은행 통장', institutionId: 'fi_bank_kb' },
      projectId,
    );
    const hanaBank = await accounts.createAccount(
      userId,
      { type: 'deposit', ownerId: owner.id, name: '하나은행 통장', institutionId: 'fi_bank_hana' },
      projectId,
    );

    /*
     * 마감일과 결제일은 명세서에 없어서 흔한 값(마감 말일, 결제 14일)으로 둔다.
     * 청구 주기 화면이 이 값으로 그려지므로 실제와 다르면 카드 설정에서 고친다.
     */
    const cardIds: Record<CardKey, string> = {
      kbDebit: (
        await cards.createCard(
          userId,
          {
            paymentAccountId: kbBank.id,
            name: 'nori 체크카드',
            cardType: 'debit',
            issuerId: 'fi_card_kb',
          },
          projectId,
        )
      ).id,
      kbCredit: (
        await cards.createCard(
          userId,
          {
            paymentAccountId: kbBank.id,
            name: 'ktMmobile 신용카드',
            cardType: 'credit',
            issuerId: 'fi_card_kb',
            statementClosingDay: 31,
            paymentDueDay: 14,
          },
          projectId,
        )
      ).id,
      hana: (
        await cards.createCard(
          userId,
          {
            paymentAccountId: hanaBank.id,
            name: 'com2us 신용카드',
            cardType: 'credit',
            issuerId: 'fi_card_hana',
            statementClosingDay: 31,
            paymentDueDay: 14,
          },
          projectId,
        )
      ).id,
    };

    const categoryId = await categoryResolver(prisma, projectId);
    const timeZone = (
      await prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { timezone: true },
      })
    ).timezone;

    let created = 0;
    for (const [key, rows] of [
      ['kbDebit', KB_DEBIT],
      ['kbCredit', KB_CREDIT],
      ['hana', HANA_CREDIT],
    ] as Array<[CardKey, Row[]]>) {
      for (const row of rows) {
        await entries.createEntry(
          userId,
          {
            kind: 'expense',
            personId: owner.id,
            // 시각은 그 타임존의 벽시계다. UTC로 찍으면 자정 근처 거래가 하루 밀린다.
            date: zonedIso(row.day, row.time, timeZone),
            description: row.merchant,
            merchant: row.merchant,
            amount: row.amount,
            categoryId: categoryId(row.category),
            cardId: cardIds[key],
            ...(row.currency ? { currency: row.currency } : {}),
          },
          projectId,
        );
        created += 1;
      }
    }

    console.log(`거래 ${created}건을 넣었습니다.`);
    console.log('  국민 체크카드', KB_DEBIT.length, '건');
    console.log('  국민 신용카드', KB_CREDIT.length, '건');
    console.log('  하나 신용카드', HANA_CREDIT.length, '건');
  } finally {
    await prisma.$disconnect();
  }
}

/** 같은 이름의 구성원이 있으면 그대로 쓴다. 두 번 돌려도 늘어나지 않는다. */
async function ensurePerson(
  people: PeopleService,
  prisma: PrismaClient,
  userId: string,
  projectId: string,
  name: string,
) {
  const found = await prisma.person.findFirst({ where: { projectId, name } });
  if (found) return found;
  return people.createPerson(userId, { name }, projectId);
}

/** [대분류] 또는 [대분류, 소분류] 를 카테고리 id로 바꾼다. */
async function categoryResolver(prisma: PrismaClient, projectId: string) {
  const rows = await prisma.category.findMany({
    where: { projectId, type: CategoryType.expense },
    select: { id: true, name: true, parentId: true },
  });

  const roots = new Map(rows.filter((row) => !row.parentId).map((row) => [row.name, row]));

  return ([parentName, childName]: [string] | [string, string]): string => {
    const parent = roots.get(parentName);
    if (!parent) {
      throw new Error(`대분류 '${parentName}' 가 없습니다. seed-categories 를 먼저 돌리세요.`);
    }
    if (!childName) return parent.id;

    const child = rows.find((row) => row.parentId === parent.id && row.name === childName);
    if (!child) {
      throw new Error(`소분류 '${parentName} > ${childName}' 가 없습니다.`);
    }
    return child.id;
  };
}

/** "MM-DD" + "HH:mm" 을 그 타임존의 벽시계로 읽어 UTC 인스턴트로 만든다. */
function zonedIso(day: string, time: string, timeZone: string): string {
  const [month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);

  // 타임존 오프셋을 직접 계산한다. 서울은 고정(+9)이지만 다른 타임존도 맞게 돈다.
  const guess = Date.UTC(2026, month - 1, date, hour, minute);
  const offset =
    new Date(guess).getTime() -
    new Date(new Date(guess).toLocaleString('en-US', { timeZone })).getTime();
  return new Date(guess + offset).toISOString();
}

/** PROJECT_ID 가 있으면 그것을, 없으면 하나뿐인 프로젝트를 쓴다. */
async function resolveProjectId(prisma: PrismaClient): Promise<string> {
  const given = process.env.PROJECT_ID?.trim();
  if (given) return given;

  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  if (projects.length === 1) return projects[0].id;
  if (projects.length === 0) {
    throw new Error('프로젝트가 없습니다. 먼저 로그인해 프로젝트를 만드세요.');
  }
  throw new Error(
    '프로젝트가 여러 개입니다. PROJECT_ID 로 지정하세요:\n' +
      projects.map((p) => `  ${p.id}  ${p.name}`).join('\n'),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
