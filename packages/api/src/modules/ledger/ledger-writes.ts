/**
 * 전표 쓰기를 둘러싼 트랜잭션 안의 작업 (ledger.service.ts 에서 떼어 냄, 2026-10-26).
 *
 * 잔액 캐시 움직이기, 태그·할부 일정 붙이기, 참조 대상 검사. 모두 부르는 쪽이 넘긴 트랜잭션
 * 클라이언트로만 읽고 쓴다 -- 원장 잠금과 트랜잭션 경계는 원장 서비스가 정한다.
 */
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { badRequest, notFound } from '@/common/app-error';
import type { InstallmentInterest } from './ledger-rows';
import type { Db, EntryInput, PostingInput, Tx } from './ledger-types';

const ZERO = new Prisma.Decimal(0);

/** 계좌 잔액과 투자 수량 캐시를 posting 합계만큼 움직인다. */
export async function applyBalanceDeltas(
  tx: Tx,
  postings: Array<{ accountId?: string; amount: Prisma.Decimal; quantity?: Prisma.Decimal }>,
) {
  const balanceDeltas = new Map<string, Prisma.Decimal>();
  const quantityDeltas = new Map<string, Prisma.Decimal>();

  for (const p of postings) {
    if (!p.accountId) continue;
    balanceDeltas.set(p.accountId, (balanceDeltas.get(p.accountId) ?? ZERO).add(p.amount));
    if (p.quantity) {
      quantityDeltas.set(p.accountId, (quantityDeltas.get(p.accountId) ?? ZERO).add(p.quantity));
    }
  }

  for (const [accountId, delta] of balanceDeltas) {
    if (delta.isZero()) continue;
    await tx.account.update({
      where: { id: accountId },
      data: { balance: { increment: delta } },
    });
  }

  for (const [accountId, delta] of quantityDeltas) {
    if (delta.isZero()) continue;
    await tx.investmentDetail.update({
      where: { accountId },
      data: { quantity: { increment: delta } },
    });
  }
}

/**
 * 태그 연결을 통째로 갈아 끼운다.
 *
 * 태그는 **줄에 붙는다.** 분류 다리마다 `tagIds` 가 실려 오고, 그 줄의 키로 연결이
 * 만들어진다. 분류 줄이 없는 전표(이체, 카드 대금 결제)만 `entryTagIds` 로 거래 자체에
 * 붙인다.
 *
 * 다리와 같은 규칙이다. 하나씩 견주어 더하고 빼지 않고 통째로 지운 뒤 다시 넣는다 --
 * 이 표에는 번호가 없어 부분 병합의 대상이 아니고, 갯수가 손에 꼽는다.
 *
 * 어느 쪽도 실려 오지 않으면 손대지 않는다. 잔액 조정처럼 원장이 스스로 만드는
 * 전표가 그 자리다 -- 사용자의 수정은 언제나 목록을 실어 보낸다(빈 목록도 목록이다).
 *
 * 남의 프로젝트 태그를 붙이지 못하게 여기서 막는다. 붙고 나면 그 거래를 보는
 * 사람에게 자기 프로젝트에 없는 이름이 뜬다.
 */
export async function saveTags(
  tx: Tx,
  entryId: string,
  projectId: string,
  postings: PostingInput[],
  entryTagIds?: string[],
) {
  const lineTagged = postings.some((posting) => posting.tagIds !== undefined);
  if (entryTagIds === undefined && !lineTagged) return;

  await tx.entryTag.deleteMany({ where: { entryId } });

  const rows: Array<{ entryId: string; lineKey: string | null; tagId: string }> = [];
  for (const posting of postings) {
    if (!posting.tagIds || !posting.lineKey) continue;
    for (const tagId of new Set(posting.tagIds)) {
      rows.push({ entryId, lineKey: posting.lineKey, tagId });
    }
  }
  for (const tagId of new Set(entryTagIds ?? [])) {
    rows.push({ entryId, lineKey: null, tagId });
  }
  if (rows.length === 0) return;

  const unique = [...new Set(rows.map((row) => row.tagId))];
  const found = await tx.tag.findMany({
    where: { id: { in: unique }, projectId },
    select: { id: true },
  });
  if (found.length !== unique.length) {
    throw badRequest('TAG_NOT_IN_PROJECT', '이 프로젝트에 없는 태그가 포함되어 있습니다.');
  }

  await tx.entryTag.createMany({ data: rows });
}

/**
 * 할부 일정을 카드 부채 posting에 붙인다.
 *
 * 전표 수정은 posting을 지우고 새로 만들므로(replaceEntry) 일정도 cascade로 사라진다.
 * 그래서 생성과 수정 양쪽에서 같은 함수를 부른다.
 */
export async function saveInstallmentPlan(
  tx: Tx,
  postings: Array<{ id: string; cardId: string | null; amount: Prisma.Decimal }>,
  months?: number,
  interestBearing?: boolean,
  shares?: string[],
  /** 회차별 이자와 그것을 만든 입력. 유이자 할부에만 있다. */
  interest?: InstallmentInterest,
) {
  if (!months || months < 2) return null;

  // 카드 부채 다리가 할부의 주인이다. 지출이면 음수 다리 하나뿐이다.
  const cardLeg = postings.find((p) => p.cardId && p.amount.lt(ZERO));
  if (!cardLeg) {
    throw badRequest('INSTALLMENT_CREDIT_ONLY', '할부는 신용카드 지출에만 설정할 수 있습니다.');
  }
  return tx.installmentPlan.create({
    data: {
      postingId: cardLeg.id,
      totalMonths: months,
      interestBearing: interestBearing ?? false,
      /*
       * 적어 둔 회차 금액. 없으면 읽는 쪽이 개월수로 나눈다.
       *
       * 금액이나 개월수를 고치면 화면이 새 값을 보내거나 아무것도 보내지 않는다.
       * 여기서 옛 값을 이어받지 않는 것이 요점이다 -- 길이나 합이 어긋난 값이 남으면
       * 주기별 청구액이 갚을 대금과 달라진다.
       */
      principalShares: shares ?? Prisma.JsonNull,
      /*
       * 회차별 이자와 그것을 만든 입력. 무이자로 되돌리면 조립이 비워 보낸다.
       *
       * 원금과 같은 규칙이다 -- 옛 값을 이어받지 않는다. 금액이나 개월수를 고치면
       * 화면이 새 표를 보내거나 아무것도 보내지 않고, 남은 옛 이자는 그 달에 나갈
       * 돈을 실제와 다르게 보여 준다.
       */
      interestShares: interest?.shares ?? Prisma.JsonNull,
      monthlyPayment: interest?.monthlyPayment ?? null,
      annualRate: interest?.annualRate ?? null,
    },
  });
}

/**
 * 숨긴 통장·카드에 **새로** 적지 못하게 한다 (2026-10-16). 원장 잠금 아래에서 부른다.
 *
 * 숨기기는 잠금 아래에서 "잔액 0", "갚지 않은 대금 없음"을 확인하고 숨긴다. 그런데 거래 쪽은 숨겼는지를 보지
 * 않아, 숨기기가 먼저 커밋한 뒤 도착한 거래가 숨긴 통장에 잔액을 남겼다 -- 총자산에는 들어가는데 목록에는
 * 없다. 잠금 덕에 숨기기와 이 확인은 차례로 돌므로, 여기서 보면 그 틈이 닫힌다.
 *
 * **이미 그 전표가 쓰던 통장·카드는 막지 않는다.** 숨긴 뒤에도 옛 거래의 메모·분류를 고칠 수 있어야 하고,
 * 그런 고치기는 그 통장의 잔액을 새로 만들지 않는다(금액을 바꾸면 만들지만, 그것은 숨기기 전에도 같은
 * 자리에 있던 거래다).
 */
export async function assertTargetsActive(
  tx: Tx,
  input: EntryInput,
  before: ReadonlyArray<{ accountId: string | null; cardId: string | null }> = [],
): Promise<void> {
  const had = new Set(before.flatMap((posting) => [posting.accountId, posting.cardId]).filter(Boolean));
  const accountIds = [
    ...new Set(input.postings.map((posting) => posting.accountId).filter((id): id is string => !!id)),
  ].filter((id) => !had.has(id));
  const cardIds = [
    ...new Set(input.postings.map((posting) => posting.cardId).filter((id): id is string => !!id)),
  ].filter((id) => !had.has(id));

  if (accountIds.length > 0) {
    const hidden = await tx.account.count({ where: { id: { in: accountIds }, isActive: false } });
    if (hidden > 0) {
      throw badRequest('ACCOUNT_INACTIVE', '숨긴 통장에는 새로 적을 수 없습니다. 먼저 숨기기를 풀어 주세요.');
    }
  }
  if (cardIds.length > 0) {
    const hidden = await tx.card.count({ where: { id: { in: cardIds }, isActive: false } });
    if (hidden > 0) {
      throw badRequest('CARD_INACTIVE', '숨긴 카드에는 새로 적을 수 없습니다. 먼저 숨기기를 풀어 주세요.');
    }
  }
}

/**
 * 전표가 참조하는 것이 모두 이 프로젝트 것인지 확인 (교차 프로젝트 오염 방지).
 *
 * 거래 주체(personId)도 함께 본다. 계좌와 카테고리만 검사하던 시절에는
 * 남의 프로젝트 Person id를 그대로 실어 보내면 저장이 됐고, 그 사람 이름이
 * 이쪽 거래 목록에 그대로 나왔다.
 */
export async function assertTargetsBelongToProject(db: Db, input: EntryInput) {
  const { projectId, postings } = input;
  const accountIds = [...new Set(postings.map((p) => p.accountId).filter(Boolean))] as string[];
  const categoryIds = [...new Set(postings.map((p) => p.categoryId).filter(Boolean))] as string[];

  // 거래한 사람은 비워도 된다(미지정). 골랐으면 이 프로젝트 사람이어야 한다.
  if (input.personId) {
    const person = await db.person.count({
      where: { id: input.personId, projectId },
    });
    if (person === 0) {
      throw notFound('NOT_PROJECT_MEMBER', '이 프로젝트의 구성원이 아닙니다.');
    }
  }

  if (accountIds.length > 0) {
    const found = await db.account.count({
      where: { id: { in: accountIds }, projectId },
    });
    if (found !== accountIds.length) {
      throw new NotFoundException('이 프로젝트에 없는 계좌가 포함되어 있습니다.');
    }
  }

  if (categoryIds.length > 0) {
    const found = await db.category.count({
      where: { id: { in: categoryIds }, projectId },
    });
    if (found !== categoryIds.length) {
      throw new NotFoundException('이 프로젝트에 없는 카테고리가 포함되어 있습니다.');
    }
  }
}
