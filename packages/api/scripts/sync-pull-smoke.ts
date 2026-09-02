import { SyncService } from '@/modules/sync/sync.service';
import { CardsService } from '@/modules/cards/cards.service';
import { CategoriesService } from '@/modules/categories/categories.service';
import { InstitutionsService } from '@/modules/institutions/institutions.service';
import { PeopleService } from '@/modules/people/people.service';
import { makeAccounts, makeEntries, makeLedger, projectAccessStub, runSmoke } from './smoke-harness';

/**
 * 변경 피드가 빠뜨리지도, 겹치지도 않는지 본다.
 *
 * 오프라인 동기화가 이것 하나에 얹힌다. 기기는 "내가 마지막으로 본 번호"만 들고
 * 다시 물으므로, 한 번이라도 변경이 번호 아래로 묻히면 그 기기는 영원히 그것을
 * 보지 못한다. 그래서 아래 검사는 네 가지를 본다.
 *
 *   1. 처음(since=0)에는 전부 온다.
 *   2. 같은 번호로 다시 물으면 아무것도 오지 않는다 (겹치지 않는다).
 *   3. 지운 행은 자리표로 온다.
 *   4. 지운 행은 자리표로 온다.
 *   5. projectId 컬럼이 없는 표(평가액·할부 계획)도 부모를 거쳐 번호를 받는다.
 *   6. 상한에 걸려 끊길 때, 끊은 번호까지는 빠진 것이 없다.
 */
runSmoke('sync-pull', async (ctx) => {
  const project = await ctx.createProject({ ledgerCurrency: 'KRW' });
  const pid = project.id;
  const user = await ctx.createUser();
  const uid = user.id;
  const access = projectAccessStub(ctx.prisma, pid);

  const sync = new SyncService(ctx.prisma as any, access as any);
  const ledger = makeLedger(ctx.prisma, access);
  const institutions = new InstitutionsService(ctx.prisma as any, access);
  const accounts = makeAccounts(ctx.prisma, access, ledger, institutions);
  const people = new PeopleService(ctx.prisma as any, access);
  const categories = new CategoriesService(ctx.prisma as any, access);
  const entries = makeEntries(ctx.prisma, access, ledger);
  const cards = new CardsService(ctx.prisma as any, access, institutions);

  const pull = (since: number, limit?: number) => sync.pull(uid, { projectId: pid, since, limit });

  // ── 준비 ──
  const person = await people.createPerson(uid, { name: '김철수' }, pid);
  const food = await categories.createCategory(uid, { name: '식비', type: 'expense' }, pid);
  const bank = await accounts.createAccount(uid, {
    type: 'deposit', ownerId: person.id, name: '보통예금',
    institutionId: 'fi_bank_shinhan', openingBalance: '1000000',
  }, pid);
  const entry = await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-05T03:00:00.000Z',
    description: '점심', amount: '9000', categoryId: food.id, accountId: bank.id,
  }, pid);

  // ── 1. 처음에는 전부 온다 ──
  const first = await pull(0);
  ctx.check('사람이 온다', first.changes.people.length, 1);
  ctx.check('카테고리가 온다', first.changes.categories.length, 1);
  // 기초잔액이 자본 계정을 함께 만들므로 계좌는 둘이다.
  ctx.check('계좌가 온다 (통장 + 자본 계정)', first.changes.accounts.length, 2);
  // 점심 + 기초잔액 전표
  ctx.check('전표가 온다', first.changes.entries.length, 2);
  ctx.check('전표에 다리가 함께 온다',
    first.changes.entries.every((e) => Array.isArray(e.postings) && e.postings.length >= 2), true);
  ctx.check('프로젝트 자신도 온다', first.changes.project !== null, true);
  ctx.check('자리표는 없다', first.tombstones.length, 0);
  ctx.check('더 없다', first.hasMore, false);

  // ── 2. 같은 번호로 다시 물으면 빈손이다 ──
  const again = await pull(first.version);
  ctx.check('겹쳐 오지 않는다',
    again.changes.people.length + again.changes.entries.length + again.changes.accounts.length, 0);
  ctx.check('번호는 그대로', again.version, first.version);

  // ── 3. 한 건 고치면 그것만 온다 ──
  await people.updatePerson(person.id, uid, { name: '김철수(수정)' });
  const afterEdit = await pull(first.version);
  ctx.check('고친 사람만 온다', afterEdit.changes.people.length, 1);
  ctx.check('건드리지 않은 표는 비어 있다', afterEdit.changes.categories.length, 0);
  ctx.check('번호가 올라간다', afterEdit.version > first.version, true);

  // ── 4. 지우면 자리표로 온다 ──
  await entries.deleteEntry(entry.id, uid);
  const afterDelete = await pull(afterEdit.version);
  ctx.check('자리표 1건', afterDelete.tombstones.length, 1);
  ctx.check('자리표의 표 이름', afterDelete.tombstones[0]?.entity, 'JournalEntry');
  ctx.check('자리표의 id', afterDelete.tombstones[0]?.entityId, entry.id);
  // 잔액이 되돌려지므로 계좌도 함께 바뀐다. 지운 전표 자신은 행이 없으니 오지 않는다.
  ctx.check('지운 전표는 행으로 오지 않는다',
    afterDelete.changes.entries.some((e) => e.id === entry.id), false);

  /*
   * ── 4-2. projectId 컬럼이 없는 표도 피드에 실린다 ──
   *
   * 평가액은 계좌를, 할부 계획은 다리와 전표를 거쳐 프로젝트를 찾는다. 트리거가 그 길을
   * 못 따라가면 번호가 0 에 머물고, 그 행은 어떤 기기에도 닿지 않으면서 오류도 남기지
   * 않는다. 그래서 "번호가 올랐는가"가 아니라 "다음 pull 에 실려 오는가"로 본다.
   */
  const beforeSatellites = await pull(0);

  const stock = await accounts.createAccount(uid, {
    type: 'investment', ownerId: person.id, name: '주식계좌', openingBalance: '500000',
  }, pid);
  const valuation = await ctx.prisma.assetValuation.create({
    data: {
      accountId: stock.id, date: new Date('2026-08-31'),
      quantity: '10', price: '80000', marketValue: '800000',
    },
  });

  const card = await cards.createCard(uid, {
    paymentAccountId: bank.id, name: '신한 신용', cardType: 'credit',
    issuerId: 'fi_card_shinhan', statementClosingDay: 15, paymentDueDay: 25,
  }, pid);
  await entries.createEntry(uid, {
    kind: 'expense', personId: person.id, date: '2026-08-20T03:00:00.000Z',
    description: '노트북', amount: '300000', categoryId: food.id, cardId: card.id,
    installmentMonths: 3,
  }, pid);

  // 피드의 행은 표마다 모양이 달라 `unknown[]` 이다. 읽을 때 한 번만 편다.
  const rows = (list: unknown[]) => list as Array<Record<string, unknown>>;

  const satellites = await pull(beforeSatellites.version);
  ctx.check('평가액이 실려 온다', satellites.changes.assetValuations.length, 1);
  ctx.check('평가액의 계좌', rows(satellites.changes.assetValuations)[0]?.accountId, stock.id);
  ctx.check('할부 계획이 실려 온다', satellites.changes.installmentPlans.length, 1);
  ctx.check('할부 개월수', rows(satellites.changes.installmentPlans)[0]?.totalMonths, 3);

  // 고쳐도 다시 온다 (번호가 새로 찍힌다)
  const afterSatellites = await pull(satellites.version);
  ctx.check('겹쳐 오지 않는다 (평가액)', afterSatellites.changes.assetValuations.length, 0);
  await ctx.prisma.assetValuation.update({
    where: { id: valuation.id }, data: { marketValue: '900000' },
  });
  const revalued = await pull(satellites.version);
  ctx.check('고친 평가액이 온다', revalued.changes.assetValuations.length, 1);
  ctx.check('고친 값', String(rows(revalued.changes.assetValuations)[0]?.marketValue), '900000');

  // 지우면 자리표로 온다
  await ctx.prisma.assetValuation.delete({ where: { id: valuation.id } });
  const afterValuationDelete = await pull(revalued.version);
  ctx.check('평가액 자리표',
    afterValuationDelete.tombstones.some(
      (t) => t.entity === 'AssetValuation' && t.entityId === valuation.id,
    ), true);

  // ── 5. 상한에 걸려 끊길 때 빠진 것이 없다 ──
  //
  // 사람을 여럿 만들고 표당 상한을 2로 두면 서버가 중간에서 끊는다. 끊긴 자리부터
  // 이어 받아 결국 전부 모이는지가 핵심이다.
  const base = await pull(0);
  const made: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const row = await people.createPerson(uid, { name: `사람${i}` }, pid);
    made.push(row.id);
  }

  const collected = new Set<string>();
  let cursor = base.version;
  let rounds = 0;
  let sawMore = false;
  for (;;) {
    const page = await pull(cursor, 2);
    for (const row of page.changes.people as Array<{ id: string }>) collected.add(row.id);
    rounds += 1;
    if (page.hasMore) sawMore = true;
    if (!page.hasMore || rounds > 20) break;
    ctx.check(`${rounds}번째 쪽에서 번호가 전진한다`, page.version > cursor, true);
    cursor = page.version;
  }
  ctx.check('중간에 끊긴 적이 있다', sawMore, true);
  ctx.check('끊겼어도 결국 전부 모인다', made.every((id) => collected.has(id)), true);
  ctx.check('쪽수가 상식적이다 (7명 / 표당 2줄)', rounds <= 10, true);

  // ── 6. 남의 프로젝트는 받을 수 없다 ──
  // (권한 판정은 projectAccess 가 하고, 스모크의 스텁은 통과시키므로 여기서는
  //  서비스가 그 판정을 반드시 거치는지만 확인한다.)
  let asked: string | undefined;
  const spy = {
    ...access,
    resolveAndVerifyProjectId: async (_u: string, p?: string) => {
      asked = p;
      return pid;
    },
  };
  await new SyncService(ctx.prisma as any, spy as any).pull(uid, { projectId: pid, since: 0 });
  ctx.check('프로젝트 권한 판정을 거친다', asked, pid);
});
