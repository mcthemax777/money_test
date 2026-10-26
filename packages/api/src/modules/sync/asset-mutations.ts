/**
 * 자산 명령(구성원·통장·카드)의 재생 (재생 서비스에서 떼어 냄, 2026-10-26).
 *
 * 전표와 규칙이 둘 다르다.
 *   1. **필드별 병합.** 이름과 색 사이에는 얽힌 불변식이 없어서, 서로 다른 필드를 고친
 *      두 편집은 다툴 이유가 없다 (D5). 이긴 필드만 골라 서비스에 넘긴다.
 *   2. **지움 명령이 없다.** 서버가 하는 일이 숨기기(isActive)라 update 로 온다.
 *      숨기기에는 선행조건이 있어(주인의 통장, 카드의 미결제액) 서버가 다시 본다 (D11).
 *
 * Nest 공급자가 아니라 재생 서비스가 자기 의존성으로 만들어 쓴다 (mutation-claim.ts 머리말).
 */
import {
  type AccountBalancePayload,
  type AccountCreatePayload,
  type AccountUpdatePayload,
  type AssetDeletePayload,
  type CardCreatePayload,
  type CardUpdatePayload,
  type Mutation,
  type MutationResult,
  type PersonCreatePayload,
  type PersonUpdatePayload,
  mergeFields,
} from '@money/types';
import type { PrismaService } from '@/config/prisma.service';
import type { ProjectAccessService } from '@/common/project-access.guard';
import { readFieldClocks } from '@/common/field-clock';
import { toMoney } from '@/common/money';
import { clientId } from '@/common/client-id';
import type { LedgerService } from '../ledger/ledger.service';
import type { PeopleService } from '../people/people.service';
import type { AccountsService } from '../accounts/accounts.service';
import type { CardsService } from '../cards/cards.service';
import { allFieldsLost, appliedResult, sameOrForeign, targetNotFound } from './mutation-results';

export class AssetMutations {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
    private readonly people: PeopleService,
    private readonly accounts: AccountsService,
    private readonly cards: CardsService,
  ) {}

  async createPerson(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as PersonCreatePayload;

    const existing = await this.prisma.person.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return sameOrForeign(mutation, existing.projectId, projectId, '구성원');

    await this.people.createPerson(
      userId,
      { id: payload.id, name: payload.name, relationship: payload.relationship ?? undefined },
      projectId,
      mutation.hlc,
    );
    return appliedResult(this.prisma, mutation, projectId);
  }

  async updatePerson(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as PersonUpdatePayload;

    const person = await this.prisma.person.findUnique({ where: { id: payload.id } });
    if (!person || person.projectId !== projectId) return targetNotFound(mutation, '구성원');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(person.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return allFieldsLost(mutation, merged.lost);

    /*
     * 숨기기는 따로 부른다. 선행조건(활성 통장 0개)이 그 함수 안에 있고, 그것을 건너뛰면
     * 주인이 목록에서 사라진 통장이 남는다.
     */
    const { isActive, ...rest } = merged.apply as PersonUpdatePayload;
    if (Object.keys(rest).length > 0) {
      /*
       * `relationship: null` 은 "비운다"다. DTO 는 undefined 만 받지만 서비스는 빈 값을
       * null 로 저장하므로, 여기서 빈 문자열로 옮겨 같은 뜻이 되게 한다.
       */
      await this.people.updatePerson(
        payload.id,
        userId,
        { ...rest, ...(rest.relationship === null ? { relationship: '' } : {}) } as never,
        mutation.hlc,
      );
    }
    if (isActive === false) await this.people.deactivatePerson(payload.id, userId, mutation.hlc);
    if (isActive === true) {
      await this.people.updatePerson(payload.id, userId, { isActive: true }, mutation.hlc);
    }

    return appliedResult(this.prisma, mutation, projectId);
  }

  async createAccount(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as AccountCreatePayload;

    const existing = await this.prisma.account.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return sameOrForeign(mutation, existing.projectId, projectId, '통장');

    await this.accounts.createAccount(
      userId,
      {
        id: payload.id,
        name: payload.name,
        type: payload.type,
        ownerId: payload.ownerId ?? undefined,
        institutionId: payload.institutionId ?? undefined,
        accountNumber: payload.accountNumber ?? undefined,
        matchText: payload.matchText ?? undefined,
        maturityDate: payload.maturityDate ?? undefined,
        currency: payload.currency,
        openingBalance: payload.initialBalance,
      } as never,
      projectId,
      mutation.hlc,
    );
    return appliedResult(this.prisma, mutation, projectId);
  }

  async updateAccount(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as AccountUpdatePayload;

    const account = await this.prisma.account.findUnique({ where: { id: payload.id } });
    if (!account || account.projectId !== projectId) return targetNotFound(mutation, '통장');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(account.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return allFieldsLost(mutation, merged.lost);

    const { isActive, ...rest } = merged.apply as AccountUpdatePayload;
    if (Object.keys(rest).length > 0) {
      await this.accounts.updateAccount(payload.id, userId, rest as never, mutation.hlc);
    }
    // 숨기기의 선행조건은 연결된 카드와 잔액이다. 통장 자체를 고치는 것과 다른 함수다.
    if (isActive === false) await this.accounts.deactivateAccount(payload.id, userId, mutation.hlc);
    if (isActive === true) {
      await this.accounts.updateAccount(payload.id, userId, { isActive: true }, mutation.hlc);
    }

    return appliedResult(this.prisma, mutation, projectId);
  }

  async createCard(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CardCreatePayload;

    const existing = await this.prisma.card.findUnique({
      where: { id: payload.id },
      select: { id: true, projectId: true },
    });
    if (existing) return sameOrForeign(mutation, existing.projectId, projectId, '카드');

    await this.cards.createCard(
      userId,
      {
        id: payload.id,
        liabilityAccountId: payload.liabilityAccountId,
        name: payload.name,
        cardType: payload.cardType,
        issuerId: payload.issuerId,
        paymentAccountId: payload.paymentAccountId,
        cardNumber: payload.cardNumber ?? undefined,
        creditLimit: payload.creditLimit ?? undefined,
        performanceAmount: payload.performanceAmount ?? undefined,
        statementClosingDay: payload.statementClosingDay ?? undefined,
        paymentDueDay: payload.paymentDueDay ?? undefined,
        color: payload.color ?? undefined,
        expiryDate: payload.expiryDate ?? undefined,
        matchText: payload.matchText ?? undefined,
      } as never,
      projectId,
      mutation.hlc,
    );
    return appliedResult(this.prisma, mutation, projectId);
  }

  async updateCard(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as CardUpdatePayload;

    const card = await this.prisma.card.findUnique({ where: { id: payload.id } });
    if (!card || card.projectId !== projectId) return targetNotFound(mutation, '카드');

    const { id: _id, ...patch } = payload;
    const merged = mergeFields(patch, mutation.hlc, readFieldClocks(card.fieldHlc));
    if (Object.keys(merged.apply).length === 0) return allFieldsLost(mutation, merged.lost);

    const { isActive, ...rest } = merged.apply as CardUpdatePayload;
    if (Object.keys(rest).length > 0) {
      await this.cards.updateCard(payload.id, userId, rest as never, mutation.hlc);
    }
    // 숨기기는 갚지 않은 사용액이 남아 있으면 막힌다. 부채 계정도 함께 내려간다.
    if (isActive === false) await this.cards.deactivateCard(payload.id, userId, mutation.hlc);
    if (isActive === true) {
      await this.cards.updateCard(payload.id, userId, { isActive: true }, mutation.hlc);
    }

    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 잔액 맞추기. 그때의 나머지 거래로 기초잔액을 다시 계산한다 -- 결과는 늘 목표 잔액이다.
   * 온라인의 잔액 수정(`updateAccount` 의 balance)과 같은 원장 함수를 쓴다.
   */
  async setAccountBalance(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const payload = mutation.payload as AccountBalancePayload;
    const account = await this.prisma.account.findUnique({ where: { id: payload.id } });
    if (!account || account.projectId !== projectId) return targetNotFound(mutation, '통장');
    await this.projectAccess.verifyUserHasAccessToProject(userId, projectId, 'editor');
    await this.ledger.setBalanceTo({
      projectId,
      accountId: payload.id,
      targetBalance: toMoney(payload.balance, '잔액'),
      createdByUserId: userId,
      openingEntryId: clientId(payload.openingEntryId, '기초잔액 전표 식별자'),
    });
    return appliedResult(this.prisma, mutation, projectId);
  }

  /**
   * 구성원·통장·카드 삭제. 온라인과 같은 서비스라 붙은 것이 있으면 같은 코드로 거절한다
   * (보류 칸으로 가고, 다음 동기화에서 그 줄이 사본에 되살아난다). 이미 없으면 끝난 것이다.
   */
  async deleteAsset(
    kind: 'person' | 'account' | 'card',
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const { id } = mutation.payload as AssetDeletePayload;
    const row =
      kind === 'person'
        ? await this.prisma.person.findUnique({ where: { id }, select: { projectId: true } })
        : kind === 'account'
          ? await this.prisma.account.findUnique({ where: { id }, select: { projectId: true } })
          : await this.prisma.card.findUnique({ where: { id }, select: { projectId: true } });
    if (!row) return appliedResult(this.prisma, mutation, projectId);
    if (row.projectId !== projectId) return targetNotFound(mutation, '자산');

    if (kind === 'person') await this.people.deletePerson(id, userId, mutation.hlc);
    else if (kind === 'account') await this.accounts.deleteAccount(id, userId, mutation.hlc);
    else await this.cards.deleteCard(id, userId, mutation.hlc);
    return appliedResult(this.prisma, mutation, projectId);
  }
}
