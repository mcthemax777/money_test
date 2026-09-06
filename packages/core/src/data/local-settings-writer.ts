/**
 * 기기가 설정 엔티티(구성원·통장·카드·분류·태그)를 자기 저장소에 커밋하는 자리.
 *
 * 거래 쪽(`local-entry-writer`)과 하는 일이 같다. 사본에 먼저 적고, 같은 내용을 명령으로
 * 아웃박스에 쌓는다 (설계 문서의 D3). 다른 것은 병합 규칙이다 -- 전표는 통째로, 자산은
 * **필드별로** 늦은 값이 이긴다. 그래서 고치기 명령에는 바꾼 필드만 담는다. 통째로 담으면
 * 건드리지도 않은 이름이 남의 편집을 덮는다.
 *
 * 신용카드는 행 둘을 만든다(카드와 부채 계정). 두 id 를 모두 여기서 만들어 보낸다 --
 * 부채 계정 id 를 서버가 정하면, 오프라인에서 그 카드로 적은 거래가 어느 계정을 가리켜야
 * 하는지 알 수 없다.
 */

import {
  type AccountDto,
  type CardDto,
  type CategoryDto,
  type TagDto,
  type Mutation,
  type MutationKind,
  type PersonDto,
  newId,
} from '@money/types';

import type {
  AccountPatch,
  CardPatch,
  CategoryPatch,
  PersonPatch,
  SettingsWritePort,
  TagPatch,
} from './settings-write-port';
import type { LocalStore, SettingTable } from './local-store';
import { notifyMirrorChanged } from './mirror-events';

export interface LocalSettingsWriterOptions {
  store: LocalStore;
  /** 지금 보고 있는 프로젝트. 화면이 프로젝트를 갈 때 다시 만든다. */
  projectId: string;
  /** 명령을 쌓은 뒤 곧바로 보내 볼 기회. 온라인이면 여기서 나간다. */
  onQueued?: (mutation: Mutation) => void;
}

/** 사본에 담을 수 있는 값만 남긴다. undefined 는 "안 보냈다"라 아예 뺀다. */
function defined(values: Record<string, unknown>): Record<string, string | number | null> {
  const row: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    if (value === null) row[key] = null;
    else if (typeof value === 'boolean') row[key] = value ? 1 : 0;
    else if (typeof value === 'number') row[key] = value;
    else row[key] = String(value);
  }
  return row;
}

export function createLocalSettingsWriter({
  store,
  projectId,
  onQueued,
}: LocalSettingsWriterOptions): SettingsWritePort {
  /**
   * 사본에 적고 명령을 쌓는다.
   *
   * 명령을 먼저 넣는 이유. 시계를 그때 발급받아 사본의 그 줄에 같은 값을 찍어야, 다음
   * 편집이 이 값보다 뒤가 되고 서버가 판정한 결과와도 어긋나지 않는다.
   */
  const commit = async (
    kind: MutationKind,
    table: SettingTable,
    id: string,
    payload: Readonly<Record<string, unknown>>,
    row: Readonly<Record<string, unknown>>,
    extra?: { table: 'account'; id: string; row: Record<string, unknown> },
  ): Promise<void> => {
    const observed = await store.assetClock(table, id);
    const mutation = await store.enqueue({
      projectId,
      mutationId: newId(),
      kind,
      targets: extra ? [id, extra.id] : [id],
      payload: { id, ...payload },
      observed,
    });

    await store.writeAsset(table, id, defined({ projectId, ...row }), mutation.hlc);
    if (extra) {
      await store.writeAsset(extra.table, extra.id, defined({ projectId, ...extra.row }), mutation.hlc);
    }

    notifyMirrorChanged();
    onQueued?.(mutation);
  };

  return {
    async addPerson(input: PersonDto.CreateRequest) {
      const id = input.id ?? newId();
      await commit(
        'person.create',
        'person',
        id,
        { name: input.name, relationship: input.relationship ?? null },
        { name: input.name, relationship: input.relationship ?? null, isActive: true },
      );
      return { id };
    },

    async updatePerson(id: string, patch: PersonPatch) {
      await commit('person.update', 'person', id, { ...patch }, { ...patch });
    },

    async addAccount(input: AccountDto.CreateRequest) {
      const id = input.id ?? newId();
      await commit(
        'account.create',
        'account',
        id,
        {
          name: input.name,
          type: input.type,
          ownerId: input.ownerId ?? null,
          institutionId: input.institutionId ?? null,
          accountNumber: input.accountNumber ?? null,
          currency: input.currency,
          initialBalance: input.openingBalance,
        },
        {
          name: input.name,
          type: input.type,
          ownerId: input.ownerId ?? null,
          institutionId: input.institutionId ?? null,
          accountNumber: input.accountNumber ?? null,
          currency: input.currency ?? 'KRW',
          /*
           * 기초 잔액은 서버가 전표로 만든다. 사본에는 그 값을 잔액 컬럼에 그대로 적어
           * 둔다 -- 다음 pull 이 진짜 값으로 덮고, 그때까지 화면이 0원을 보여 주지 않는다.
           */
          balance: input.openingBalance ?? '0',
          isActive: true,
        },
      );
      return { id };
    },

    async updateAccount(id: string, patch: AccountPatch) {
      await commit('account.update', 'account', id, { ...patch }, { ...patch });
    },

    async addCard(input: CardDto.CreateRequest) {
      const id = input.id ?? newId();
      const isCredit = input.cardType === 'credit';
      const liabilityAccountId = isCredit ? input.liabilityAccountId ?? newId() : undefined;

      const payment = await store.accountById(projectId, input.paymentAccountId);

      await commit(
        'card.create',
        'card',
        id,
        {
          liabilityAccountId,
          name: input.name,
          cardType: input.cardType,
          issuerId: input.issuerId,
          paymentAccountId: input.paymentAccountId,
          cardNumber: input.cardNumber ?? null,
          creditLimit: input.creditLimit ?? null,
          performanceAmount: input.performanceAmount ?? null,
          statementClosingDay: input.statementClosingDay ?? null,
          paymentDueDay: input.paymentDueDay ?? null,
          color: input.color ?? null,
        },
        {
          liabilityAccountId: liabilityAccountId ?? null,
          name: input.name,
          cardType: input.cardType,
          issuerId: input.issuerId,
          paymentAccountId: input.paymentAccountId,
          cardNumber: input.cardNumber ?? null,
          creditLimit: input.creditLimit ?? null,
          performanceAmount: input.performanceAmount ?? null,
          statementClosingDay: input.statementClosingDay ?? null,
          paymentDueDay: input.paymentDueDay ?? null,
          color: input.color ?? null,
          isActive: true,
        },
        liabilityAccountId
          ? {
              table: 'account',
              id: liabilityAccountId,
              row: {
                /*
                 * 부채 계정은 카드에서 파생된다. 이름도 주인도 결제 통장을 따라가고,
                 * 사용자는 이것을 통장 목록에서 보지 않는다.
                 */
                name: input.name,
                type: 'credit_card',
                ownerId: payment?.ownerId ?? null,
                currency: payment?.currency ?? 'KRW',
                balance: '0',
                isActive: true,
              },
            }
          : undefined,
      );
      return { id };
    },

    async updateCard(id: string, patch: CardPatch) {
      await commit('card.update', 'card', id, { ...patch }, { ...patch });
    },

    async addCategory(input: CategoryDto.CreateRequest) {
      const id = input.id ?? newId();
      await commit(
        'category.create',
        'category',
        id,
        {
          name: input.name,
          type: input.type,
          parentId: input.parentId ?? null,
          icon: input.icon ?? null,
        },
        {
          name: input.name,
          type: input.type,
          parentId: input.parentId ?? null,
          icon: input.icon ?? null,
          isDefault: false,
          isActive: true,
        },
      );
      return { id };
    },

    async updateCategory(id: string, patch: CategoryPatch) {
      await commit('category.update', 'category', id, { ...patch }, { ...patch });
    },

    async addTag(input: TagDto.CreateRequest) {
      const id = input.id ?? newId();
      await commit(
        'tag.create',
        'tag',
        id,
        { name: input.name, color: input.color ?? null },
        { name: input.name, color: input.color ?? null, isActive: true },
      );
      return { id };
    },

    async updateTag(id: string, patch: TagPatch) {
      await commit('tag.update', 'tag', id, { ...patch }, { ...patch });
    },

    async setBudget(input) {
      const id = input.id ?? newId();
      await commit(
        'budget.set',
        'budget',
        id,
        {
          categoryId: input.categoryId ?? null,
          type: input.type ?? null,
          monthlyAmount: input.monthlyAmount,
          // 어느 달의 규칙을 고치는지. 사본의 행에는 담지 않는다(예산 행의 칸이 아니다).
          yearMonth: input.yearMonth,
        },
        {
          categoryId: input.categoryId ?? null,
          type: input.type ?? null,
          monthlyAmount: input.monthlyAmount,
        },
      );
      return { id };
    },

    async setBudgetOverride(input) {
      const id = input.id ?? newId();
      await commit(
        'budget.override',
        'budget_override',
        id,
        {
          budgetId: input.budgetId,
          year: input.year,
          month: input.month,
          amount: input.amount ?? null,
        },
        /*
         * 지우는 명령이면 사본에서도 그 줄을 비운다. 금액이 없는 조정은 뜻이 없어서,
         * 다음 pull 이 오기 전까지 화면이 옛 금액을 보여 주면 안 된다.
         */
        input.amount == null
          ? { budgetId: input.budgetId, year: input.year, month: input.month, amount: '0' }
          : {
              budgetId: input.budgetId,
              year: input.year,
              month: input.month,
              amount: input.amount,
            },
      );
      return { id };
    },
  };
}
