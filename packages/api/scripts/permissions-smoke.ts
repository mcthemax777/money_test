/**
 * 권한과 응답 위생을 실제 HTTP 경로로 확인한다.
 *
 * 다른 스모크는 전부 owner로만 돌기 때문에 역할 분기가 통째로 빠져 있었다.
 * 실제로 viewer가 거래를 지울 수 있는 상태였는데도 모든 스모크가 통과했다.
 * 여기서는 같은 프로젝트에 owner / editor / viewer 세 사람을 두고
 * 같은 요청을 세 번 보내 결과가 갈리는지 본다.
 *
 * 서버가 :3999 에 떠 있어야 한다 (http-smoke와 같은 전제).
 */

import { JwtService } from '@nestjs/jwt';
import { runSmoke } from './smoke-harness';

const BASE = 'http://localhost:3999';

runSmoke('permissions', async (ctx) => {
  const project = await ctx.createProject();
  const other = await ctx.createProject();

  const jwtService = new JwtService({ secret: process.env.JWT_SECRET });

  /** 역할별 사용자를 만들고 그 사람으로 요청하는 함수를 돌려준다. */
  const memberAs = async (role: 'owner' | 'editor' | 'viewer') => {
    const user = await ctx.createUser();
    await ctx.prisma.projectMember.create({
      data: { projectId: project.id, userId: user.id, role },
    });
    const token = jwtService.sign({ sub: user.id, type: 'access' }, { expiresIn: '1h' });

    return async (method: string, path: string, body?: unknown) => {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
  };

  const owner = await memberAs('owner');
  const editor = await memberAs('editor');
  const viewer = await memberAs('viewer');

  const q = `?projectId=${project.id}`;

  // ── 준비물은 owner가 만든다 ────────────────────────────────
  const person = await owner('POST', `/people${q}`, { name: '김철수' });
  ctx.check('owner: 사람 생성', person.status, 201);

  const account = await owner('POST', `/accounts${q}`, {
    ownerId: person.body.id,
    type: 'deposit',
    name: '신한통장',
    openingBalance: '1000000',
  });
  ctx.check('owner: 통장 생성', account.status, 201);

  const category = await owner('POST', `/categories${q}`, { name: '외식', type: 'expense' });
  ctx.check('owner: 카테고리 생성', category.status, 201);

  // ── 읽기는 세 역할 모두 된다 ───────────────────────────────
  ctx.check('viewer: 통장 목록 조회', (await viewer('GET', `/accounts${q}`)).status, 200);
  ctx.check('viewer: 거래 목록 조회', (await viewer('GET', `/entries${q}`)).status, 200);

  // ── 쓰기는 editor만 된다 ───────────────────────────────────
  const expenseBody = {
    kind: 'expense',
    personId: person.body.id,
    date: new Date().toISOString(),
    description: '점심',
    amount: '9000',
    categoryId: category.body.id,
    accountId: account.body.id,
  };

  const editorEntry = await editor('POST', `/entries${q}`, expenseBody);
  ctx.check('editor: 거래 생성', editorEntry.status, 201);

  const viewerEntry = await viewer('POST', `/entries${q}`, expenseBody);
  ctx.check('viewer: 거래 생성 거부', viewerEntry.status, 403);

  ctx.check(
    'viewer: 거래 수정 거부',
    (await viewer('PATCH', `/entries/${editorEntry.body.id}`, expenseBody)).status,
    403,
  );
  ctx.check(
    'viewer: 거래 삭제 거부',
    (await viewer('DELETE', `/entries/${editorEntry.body.id}`)).status,
    403,
  );
  ctx.check(
    'viewer: 통장 생성 거부',
    (await viewer('POST', `/accounts${q}`, {
      ownerId: person.body.id,
      type: 'deposit',
      name: '몰래 만든 통장',
    })).status,
    403,
  );
  ctx.check(
    'viewer: 잔액 수정 거부',
    (await viewer('PATCH', `/accounts/${account.body.id}`, { balance: '99999999' })).status,
    403,
  );
  ctx.check(
    'viewer: 사람 수정 거부',
    (await viewer('PATCH', `/people/${person.body.id}`, { name: '바뀐이름' })).status,
    403,
  );
  ctx.check(
    'viewer: 카테고리 삭제 거부',
    (await viewer('DELETE', `/categories/${category.body.id}`)).status,
    403,
  );
  ctx.check(
    'viewer: 순서 변경 거부',
    (await viewer('PATCH', `/accounts/reorder${q}`, { ids: [account.body.id] })).status,
    403,
  );
  ctx.check(
    'viewer: 예산 생성 거부',
    (await viewer('POST', `/budgets${q}`, {
      categoryId: category.body.id,
      monthlyAmount: '100000',
    })).status,
    403,
  );

  // 거부가 실제로 아무것도 바꾸지 않았는지 확인한다. 403만 보고 넘기면
  // "쓰고 나서 403"인 구현을 놓친다.
  const afterDenied = await owner('GET', `/accounts/${account.body.id}`);
  ctx.check('거부 후 잔액 그대로', afterDenied.body.balance, '991000');

  // ── 요청 본문으로 소속을 바꿀 수 없다 ──────────────────────
  await editor('PATCH', `/people/${person.body.id}`, {
    name: '김철수',
    projectId: other.id,
  });
  const movedPerson = await ctx.prisma.person.findUnique({ where: { id: person.body.id } });
  ctx.check('본문의 projectId로 구성원을 옮길 수 없다', movedPerson?.projectId, project.id);

  // ── 카드번호는 어느 경로로도 원문이 나가지 않는다 ──────────
  const card = await owner('POST', `/cards${q}`, {
    paymentAccountId: account.body.id,
    name: '신한카드',
    cardType: 'credit',
    cardNumber: '1234567812345678',
    issuerId: (await owner('GET', `/institutions${q}&type=card_issuer`)).body[0].id,
    statementClosingDay: 15,
    paymentDueDay: 25,
  });
  ctx.check('카드 생성', card.status, 201);

  const initial = await owner('PATCH', '/users/me/default-project', { projectId: project.id });
  const initialCards = initial.body?.defaultProjectData?.cards ?? [];
  ctx.check('초기 데이터에 카드가 있다', initialCards.length, 1);
  ctx.check('초기 데이터에 카드번호 원문 없음', initialCards[0]?.cardNumber, undefined);
  ctx.check('초기 데이터도 마스킹된 번호를 준다', initialCards[0]?.cardNumberMasked, '****-****-****-5678');

  const initialJson = JSON.stringify(initial.body);
  ctx.check('응답 어디에도 원문이 없다', initialJson.includes('1234567812345678'), false);

  // ── 잘못된 금액은 400이고, 내부 메시지를 흘리지 않는다 ─────
  const badAmount = await editor('POST', `/entries${q}`, { ...expenseBody, amount: {} });
  ctx.check('금액이 객체면 400', badAmount.status, 400);

  const nanAmount = await editor('POST', `/entries${q}`, { ...expenseBody, amount: 'NaN' });
  ctx.check('금액이 NaN이면 400', nanAmount.status, 400);
  ctx.check(
    '오류 메시지에 Prisma가 노출되지 않는다',
    JSON.stringify(nanAmount.body).includes('Prisma'),
    false,
  );
});
