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
  type RecurringFrequency,
  type RecurringHolidayRule,
  type RecurringRuleDto,
  type RecurringScheduleWithTime,
  Dec,
  RECURRING_KINDS,
  checkRecurring,
  newId,
  recurringScheduleFields,
  recurringSchedulePatch,
  resolveBudgetTarget,
  zonedDateKey,
} from '@money/types';

import type {
  AccountPatch,
  CardPatch,
  CategoryPatch,
  PersonPatch,
  SettingsWritePort,
  TagPatch,
} from './settings-write-port';
import { settingTableOf, type LocalStore } from './local-store';
import { notifyMirrorChanged } from './mirror-events';
import { apiClient } from '../lib/api-client';
import { codedError } from '../lib/api-error';

export interface LocalSettingsWriterOptions {
  store: LocalStore;
  /** 지금 보고 있는 프로젝트. 화면이 프로젝트를 갈 때 다시 만든다. */
  projectId: string;
  /** 명령을 쌓은 뒤 곧바로 보내 볼 기회. 온라인이면 여기서 나간다. */
  onQueued?: (mutation: Mutation) => void;
  /**
   * 아웃박스를 거치지 않고 서버에 곧바로 쓴 뒤 부른다. 사본을 다시 맞출 기회다.
   *
   * 잔액 맞추기가 여기 든다 -- 서버가 기초잔액 전표를 다시 계산하므로, 그 결과를
   * 받아 오기 전까지 사본의 잔액과 원장 줄은 옛 값이다.
   */
  onServerWrite?: () => void;
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
  onServerWrite,
}: LocalSettingsWriterOptions): SettingsWritePort {
  /**
   * 사본에 적고 명령을 쌓는다.
   *
   * 명령을 먼저 넣는 이유. 시계를 그때 발급받아 사본의 그 줄에 같은 값을 찍어야, 다음
   * 편집이 이 값보다 뒤가 되고 서버가 판정한 결과와도 어긋나지 않는다.
   *
   * 어느 표에 쓰는지는 명령 이름에서 얻는다(`settingTableOf`). 부르는 쪽마다 적어 두면
   * 막힌 명령을 다시 내는 쪽과 갈라질 수 있고, 갈라져도 아무 오류가 나지 않는다.
   */
  const commit = async (
    kind: MutationKind,
    id: string,
    payload: Readonly<Record<string, unknown>>,
    row: Readonly<Record<string, unknown>>,
    extra?: { table: 'account'; id: string; row: Record<string, unknown> },
  ): Promise<void> => {
    // 설정 명령만 이 함수로 온다. 표가 없다면 부르는 쪽이 전표 명령을 잘못 보낸 것이다.
    const table = settingTableOf(kind);
    if (!table) throw new Error(`설정 명령이 아닙니다: ${kind}`);

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

  /**
   * 표 한 줄에 붙지 않는 설정 명령을 쌓는다 (통합·삭제·환율·잔액 맞추기 등).
   *
   * 필드별 시계가 없어 "본 값"도 없다 -- 서버는 받은 차례대로 적용한다. 사본에 적는 일은
   * 명령마다 달라 `apply` 로 받는다. 큐에 넣은 뒤 적는다: 적다가 실패해도 명령은 남아
   * 서버가 바로잡는다(다음 pull). 반대 차례면 사본만 바뀌고 서버에는 가지 않을 수 있다.
   */
  const queue = async (
    kind: MutationKind,
    targets: string[],
    payload: Readonly<Record<string, unknown>>,
    apply?: (mutation: Mutation) => Promise<void>,
  ): Promise<void> => {
    const mutation = await store.enqueue({
      projectId,
      mutationId: newId(),
      kind,
      targets,
      payload,
      observed: null,
    });
    await apply?.(mutation);
    notifyMirrorChanged();
    onQueued?.(mutation);
  };

  /**
   * 반복 등록의 사본 행. 서버 `RecurringService.create`·`update` 와 같은 검사와 다듬기다.
   *
   * `current` 가 있으면 고치기다 -- 준 칸만 지금 행에 합친다. 일정은 합친 모습으로 검사하고,
   * 결제수단·분류는 갈래에 맞게 비운다(이체면 카드·분류·할부가 없고, 수수료가 없으면 그
   * 분류도 없다). 금액 모양은 폼이 이미 본다 -- 틀린 값이면 재생 때 서버가 거절한다.
   */
  const recurringRowOf = async (
    current: Record<string, unknown> | null,
    dto: RecurringRuleDto.UpdateRequest & { id?: string },
  ): Promise<Record<string, unknown>> => {
    const has = (key: keyof RecurringRuleDto.Body) => current === null || key in dto;
    const pick = <K extends keyof RecurringRuleDto.Body>(key: K): unknown =>
      key in dto ? (dto[key] ?? null) : (current?.[key] ?? null);

    if (has('description')) {
      const description = String(dto.description ?? '').trim();
      if (!description) throw codedError('RECURRING_DESCRIPTION_REQUIRED');
      dto = { ...dto, description };
    }

    const parsedList = (value: unknown): unknown[] => {
      if (Array.isArray(value)) return value;
      try {
        const parsed = JSON.parse(String(value ?? '[]'));
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const base = current
      ? {
          frequency: current.frequency as RecurringFrequency,
          everyDays: (current.everyDays as number | null) ?? null,
          weekdays: parsedList(current.weekdays) as number[],
          holidayRule: current.holidayRule as RecurringHolidayRule,
          dayOfMonth: (current.dayOfMonth as number | null) ?? null,
          month: (current.month as number | null) ?? null,
          startDate: String(current.startDate),
          endDate: (current.endDate as string | null) ?? null,
          timeOfDay: (current.timeOfDay as string | null) ?? null,
        }
      : null;
    const schedule = { ...base, ...recurringSchedulePatch(dto) } as RecurringScheduleWithTime;
    if (checkRecurring(schedule)) throw codedError('RECURRING_INVALID');

    const kind = String(pick('kind'));
    if (!(RECURRING_KINDS as readonly string[]).includes(kind)) throw codedError('DRAFT_KIND_INVALID');

    let tagIds = parsedList(current?.tagIds) as string[];
    if (dto.tagIds !== undefined) {
      tagIds = [...new Set(dto.tagIds)];
      const known = new Set((await store.tagRows(projectId)).map((tag) => tag.id));
      if (tagIds.some((tagId) => !known.has(tagId))) throw codedError('TAG_NOT_IN_PROJECT');
    }

    const payment = {
      accountId: pick('accountId') as string | null,
      toAccountId: pick('toAccountId') as string | null,
      cardId: pick('cardId') as string | null,
      categoryId: pick('categoryId') as string | null,
      installmentMonths: pick('installmentMonths') as number | null,
      feeAmount: pick('feeAmount') as string | null,
      feeCategoryId: pick('feeCategoryId') as string | null,
    };
    if (kind !== 'transfer') {
      Object.assign(payment, { toAccountId: null, feeAmount: null, feeCategoryId: null });
    } else {
      if (payment.accountId && payment.accountId === payment.toAccountId) {
        throw codedError('TRANSFER_SAME_ACCOUNT');
      }
      if (payment.feeAmount != null && Dec.of(payment.feeAmount).isNegative()) {
        throw codedError('RECURRING_FEE_INVALID');
      }
      const hasFee = payment.feeAmount != null && Dec.of(payment.feeAmount).gt(0);
      Object.assign(payment, {
        cardId: null,
        categoryId: null,
        installmentMonths: null,
        feeAmount: hasFee ? payment.feeAmount : null,
        feeCategoryId: hasFee ? payment.feeCategoryId : null,
      });
    }

    return {
      ...(current ?? {}),
      id: current?.id ?? dto.id,
      isActive: current === null ? (dto.isActive ?? true) : pick('isActive'),
      ...recurringScheduleFields(schedule),
      kind,
      amount: pick('amount'),
      currency: pick('currency'),
      description: pick('description'),
      merchant: pick('merchant'),
      personId: pick('personId'),
      ...payment,
      tagIds,
    };
  };

  return {
    async addPerson(input: PersonDto.CreateRequest) {
      const id = input.id ?? newId();
      await commit(
        'person.create',
        id,
        { name: input.name, relationship: input.relationship ?? null },
        { name: input.name, relationship: input.relationship ?? null, isActive: true },
      );
      return { id };
    },

    async updatePerson(id: string, patch: PersonPatch) {
      await commit('person.update', id, { ...patch }, { ...patch });
    },

    async addAccount(input: AccountDto.CreateRequest) {
      const id = input.id ?? newId();
      await commit(
        'account.create',
        id,
        {
          name: input.name,
          type: input.type,
          ownerId: input.ownerId ?? null,
          institutionId: input.institutionId ?? null,
          accountNumber: input.accountNumber ?? null,
          matchText: input.matchText || null,
          currency: input.currency,
          initialBalance: input.openingBalance,
        },
        {
          name: input.name,
          type: input.type,
          ownerId: input.ownerId ?? null,
          institutionId: input.institutionId ?? null,
          accountNumber: input.accountNumber ?? null,
          matchText: input.matchText || null,
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
      await commit('account.update', id, { ...patch }, { ...patch });
    },

    /*
     * 잔액 맞추기. **뜻으로 쌓는다** -- "이 통장의 잔액을 X 로" (AccountBalancePayload).
     *
     * 서버는 재생할 때 그때의 나머지 거래로 기초잔액을 다시 계산하므로 결과는 늘 X 다
     * (끊긴 동안 다른 기기가 거래를 적었어도). 사본에는 같은 식으로 곧바로 적는다
     * (`applyBalanceTo`). 기초잔액 전표를 새로 세울 때의 id 를 여기서 만들어 서버와 같은 줄이 되게 한다.
     */
    async setAccountBalance(id: string, balance: string) {
      const openingEntryId = newId();
      await queue('account.balance', [id], { id, balance, openingEntryId }, (mutation) =>
        store.applyBalanceTo(projectId, { accountId: id, balance, openingEntryId, hlc: mutation.hlc }),
      );
    },

    async addCard(input: CardDto.CreateRequest) {
      const id = input.id ?? newId();
      const isCredit = input.cardType === 'credit';
      /*
       * 서버와 같은 검사다 (CREDIT_CARD_DAYS_REQUIRED). 이 창구는 사본에 먼저 적으므로 여기서
       * 막지 않으면 만들어진 것처럼 보이다가 동기화에서 거절당한다 -- 그 사이 실적·청구는
       * 계산되지 않는다.
       */
      if (isCredit && (!input.statementClosingDay || !input.paymentDueDay)) {
        throw codedError('CREDIT_CARD_DAYS_REQUIRED');
      }
      const liabilityAccountId = isCredit ? input.liabilityAccountId ?? newId() : undefined;

      const payment = await store.accountById(projectId, input.paymentAccountId);

      await commit(
        'card.create',
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
          expiryDate: input.expiryDate ?? null,
          matchText: input.matchText || null,
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
          expiryDate: input.expiryDate ?? null,
          matchText: input.matchText || null,
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
      // 신용카드의 마감일·결제일은 비울 수 없다 (서버와 같은 검사).
      const clearing =
        (patch as { statementClosingDay?: number | null }).statementClosingDay === null ||
        (patch as { paymentDueDay?: number | null }).paymentDueDay === null;
      if (clearing && (await store.cardById(projectId, id))?.cardType === 'credit') {
        throw codedError('CREDIT_CARD_DAYS_REQUIRED');
      }
      await commit('card.update', id, { ...patch }, { ...patch });
    },

    /*
     * 구성원·통장·카드 삭제. 명령으로 쌓는다 (오프라인에서도 된다).
     *
     * 붙은 것이 있으면 서버가 거절하므로 사본에서 **먼저 같은 검사**를 한다(같은 오류 코드,
     * `deleteBlocker`). 통과하면 사본에서 지우고 쌓는다. 끊긴 동안 다른 기기가 그 대상에
     * 거래를 붙였거나 사본에 없는 기록(투자 상세·청구서)이 있으면 재생할 때 서버가 거절하고,
     * 다음 동기화에서 그 줄이 사본에 되살아난다 -- 받아들인 규칙이다 (2026-10-01).
     */
    async removePerson(id: string) {
      const blocker = await store.deleteBlocker(projectId, 'person', id);
      if (blocker) throw codedError(blocker as never);
      await queue('person.delete', [id], { id }, () => store.forgetRow('person', id));
    },

    async removeAccount(id: string) {
      const blocker = await store.deleteBlocker(projectId, 'account', id);
      if (blocker) throw codedError(blocker as never);
      await queue('account.delete', [id], { id }, () => store.forgetRow('account', id));
    },

    async removeCard(id: string) {
      const blocker = await store.deleteBlocker(projectId, 'card', id);
      if (blocker) throw codedError(blocker as never);
      const card = await store.cardById(projectId, id);
      await queue('card.delete', [id], { id }, async () => {
        await store.forgetRow('card', id);
        // 신용카드의 부채 계정도 함께 간다 (서버의 removeLiability).
        if (card?.liabilityAccountId) await store.forgetRow('account', card.liabilityAccountId);
      });
    },

    async addCategory(input: CategoryDto.CreateRequest) {
      /*
       * 같은 이름이 이미 있으면 여기서 막는다.
       *
       * 서버의 유일성 제약과 같은 규칙이다. 이 창구는 사본에 먼저 쓰고 명령을 쌓으므로
       * 서버의 거절이 화면에 닿지 않는다 -- 만들어진 것처럼 보이고 목록에도 뜨다가,
       * 다음 동기화에서 보류 칸으로 가 사용자가 직접 버려야 했다.
       */
      const name = input.name.trim();
      if (await store.categoryNameTaken(projectId, name, input.parentId ?? null, input.type)) {
        throw codedError('CATEGORY_NAME_DUPLICATE');
      }

      const id = input.id ?? newId();
      await commit(
        'category.create',
        id,
        {
          name,
          type: input.type,
          parentId: input.parentId ?? null,
          icon: input.icon ?? null,
        },
        {
          name,
          type: input.type,
          parentId: input.parentId ?? null,
          icon: input.icon ?? null,
          isDefault: false,
        },
      );
      return { id };
    },

    async updateCategory(id: string, patch: CategoryPatch) {
      /*
       * 거래에 쓰이고 있으면 여기서 막는다.
       *
       * 서버의 `deleteCategory` 와 같은 규칙인데, 이 창구는 사본에 먼저 쓰고 명령을
       * 쌓으므로 서버의 거절이 화면에 닿지 않는다 -- 지워진 것처럼 보이다가 다음
       * 동기화에서 조용히 되돌아왔다. 코드를 붙여 던지면 웹과 같은 갈래로 읽히고,
       * 화면이 "거래내역 보기 / 다른 분류와 통합하기"를 내준다.
       */
      if (patch.isActive === false) {
        const counts = await store.categoryPostingCounts(id);
        const used = Object.values(counts).reduce((sum, count) => sum + count, 0);
        if (used > 0) throw codedError('CATEGORY_IN_USE');
      }

      /* 이름을 고치는 것도 만드는 것과 같은 규칙으로 본다 (서버도 같은 제약에 걸린다). */
      if (patch.name !== undefined) {
        const slot = await store.categorySlot(id);
        if (
          slot &&
          (await store.categoryNameTaken(
            projectId,
            patch.name.trim(),
            slot.parentId,
            slot.type,
            id,
          ))
        ) {
          throw codedError('CATEGORY_NAME_DUPLICATE');
        }
      }

      /*
       * 지우기는 사본에서도 **지우기**다.
       *
       * `isActive: false` 는 표에 담는 값이 아니라 "지워 달라"는 명령의 이름이다
       * (`CategoryDto.UpdateRequest`). 사본에 그 값을 적을 칸이 없으므로 명령만 쌓고,
       * 행은 여기서 걷어낸다. 서버가 거절하면 다음 동기화가 도로 실어 온다.
       */
      if (patch.isActive === false) {
        const { isActive: _removed, ...rest } = patch;
        await commit('category.update', id, { ...patch }, { ...rest });
        await store.removeCategory(id);
        notifyMirrorChanged();
        return;
      }

      await commit('category.update', id, { ...patch }, { ...patch });
    },

    async addTag(input: TagDto.CreateRequest) {
      const id = input.id ?? newId();
      await commit(
        'tag.create',
        id,
        { name: input.name, color: input.color ?? null },
        { name: input.name, color: input.color ?? null },
      );
      return { id };
    },

    async updateTag(id: string, patch: TagPatch) {
      /*
       * 지우기는 사본에서도 **지우기**다. 분류와 같은 규칙이다.
       *
       * 붙어 있던 연결도 함께 걷어낸다 -- 서버의 `deleteTag` 가 하는 일이 그것이다.
       * 명령 뒤에 하는 까닭은, 명령이 쌓이지 못하면(권한·저장소) 사본만 지워진 채로
       * 남지 않게 하기 위해서다.
       */
      if (patch.isActive === false) {
        const { isActive: _removed, ...rest } = patch;
        await commit('tag.update', id, { ...patch }, { ...rest });
        await store.removeTag(id);
        notifyMirrorChanged();
        return;
      }

      await commit('tag.update', id, { ...patch }, { ...patch });
    },

    async setBudget(input) {
      const id = input.id ?? newId();
      /*
       * 사본의 행에는 풀어서 적는다. 명령은 받은 그대로 보낸다(서버가 같은 함수로 푼다).
       * 전체 예산의 센티널을 분류 id 자리에 그대로 적으면 사본의 예산 조회가 그 줄을
       * 전체로도 분류로도 읽지 못해, 동기화 전까지 만든 예산이 보이지 않는다.
       */
      const target = resolveBudgetTarget(input.categoryId, input.type);
      await commit(
        'budget.set',
        id,
        {
          categoryId: input.categoryId ?? null,
          tagId: input.tagId ?? null,
          type: input.type ?? null,
          monthlyAmount: input.monthlyAmount,
          // 어느 달의 규칙을 고치는지. 사본의 행에는 담지 않는다(예산 행의 칸이 아니다).
          yearMonth: input.yearMonth,
        },
        {
          categoryId: target.categoryId ?? null,
          tagId: input.tagId ?? null,
          // 태그 예산은 유형을 두지 않는다 (서버도 버린다).
          type: input.tagId ? null : (target.type ?? null),
          monthlyAmount: input.monthlyAmount,
        },
      );
      return { id };
    },

    async deleteBudget(id) {
      /*
       * 사본에서 곧바로 지운다 (달별 조정도 함께 -- forgetRow). 명령에는 id 만 싣는다.
       * 행은 화면이 사본에서 읽어 연 것이라 늘 있다; 시계를 남긴 뒤 지운다.
       */
      await commit('budget.delete', id, {}, {});
      await store.forgetRow('budget', id);
      notifyMirrorChanged();
    },

    async mergeCategories(moves) {
      /*
       * 서버 `mergeCategories` 와 같은 검사, 같은 오류 코드다. 사본에 먼저 적으므로 여기서 막지
       * 않으면 옮겨진 것처럼 보이다가 동기화에서 거절당한다.
       */
      if (moves.length === 0) throw codedError('CATEGORY_MERGE_EMPTY');
      const fromIds = [...new Set(moves.map((move) => move.fromId))];
      const toIds = [...new Set(moves.map((move) => move.toId).filter((id): id is string => !!id))];
      const removing = new Set(fromIds);
      if (toIds.some((id) => removing.has(id))) throw codedError('CATEGORY_MERGE_INTO_REMOVED');

      const byId = new Map((await store.categoryRows(projectId)).map((row) => [row.id, row]));
      for (const id of [...fromIds, ...toIds]) {
        // 서버도 코드 없이 거절한다. 화면은 "통합에 실패했습니다"를 적는다.
        if (!byId.has(id)) throw new Error('카테고리를 찾을 수 없습니다.');
      }
      for (const move of moves) {
        const from = byId.get(move.fromId)!;
        if (from.isDefault) throw codedError('CATEGORY_DEFAULT_LOCKED');
        if (!move.toId) {
          if ((await store.categoryPostingCount(move.fromId)) > 0) {
            throw codedError('CATEGORY_MERGE_TARGET_REQUIRED');
          }
          continue;
        }
        if (from.type !== byId.get(move.toId)!.type) throw codedError('CATEGORY_MERGE_TYPE_MISMATCH');
      }

      let movedPostings = 0;
      await queue(
        'category.merge',
        [...fromIds, ...toIds],
        { id: fromIds[0], moves: moves.map((move) => ({ fromId: move.fromId, toId: move.toId ?? null })) },
        async () => {
          movedPostings = await store.applyCategoryMerge(projectId, moves);
        },
      );
      return { movedPostings };
    },

    async mergeTags(fromId, toId) {
      // 서버 `mergeTags` 와 같은 검사다.
      if (!fromId || !toId) throw codedError('TAG_MERGE_TARGET_REQUIRED');
      if (fromId === toId) throw codedError('TAG_MERGE_INTO_REMOVED');
      const ids = new Set((await store.tagRows(projectId)).map((row) => row.id));
      if (!ids.has(fromId) || !ids.has(toId)) throw new Error('태그를 찾을 수 없습니다.');
      await queue('tag.merge', [fromId, toId], { id: fromId, toId }, () => store.applyTagMerge(fromId, toId));
    },

    async createRecurringRule(input) {
      const id = input.id ?? newId();
      const now = new Date().toISOString();
      const row = await recurringRowOf(null, { ...input, id });
      // 짐은 온라인 요청 그대로다 -- 서버가 재생하며 같은 검사와 다듬기를 다시 한다.
      await queue('recurring.create', [id], { ...input, id }, () =>
        store.putRecurringRule(projectId, { ...row, createdAt: now, updatedAt: now }),
      );
    },

    async updateRecurringRule(id, patch) {
      const current = (await store.recurringRuleRows(projectId)).find((row) => row.id === id);
      if (!current) throw codedError('RECURRING_NOT_FOUND');
      const row = await recurringRowOf(current, patch);
      await queue('recurring.update', [id], { ...patch, id }, () =>
        store.putRecurringRule(projectId, { ...row, updatedAt: new Date().toISOString() }),
      );
    },

    async removeRecurringRule(id) {
      await queue('recurring.delete', [id], { id }, () => store.removeRecurringRule(id));
    },

    async setBudgetFrom(input) {
      /*
       * 뜻으로 쌓는다 -- 대상과 달 (BudgetSetFromPayload). 사본에는 서버와 같은 끊기를 곧바로
       * 한다 (planBudgetFrom). 새 규칙의 id 는 여기서 만들어 서버와 같은 줄이 되게 한다.
       */
      const target = resolveBudgetTarget(input.categoryId, input.type);
      const tagId = input.tagId ?? null;
      const type = tagId ? null : (target.type ?? null);
      const key = `${target.categoryId ?? ''}|${tagId ?? ''}|${type ?? ''}`;
      const ruleId = newId();
      await queue(
        'budget.setFrom',
        [key, input.budgetId],
        {
          id: key,
          categoryId: input.categoryId ?? null,
          tagId,
          type,
          fromMonth: input.fromMonth,
          amount: input.amount,
          ruleId,
        },
        () =>
          store.applyBudgetFrom(projectId, {
            categoryId: target.categoryId ?? null,
            tagId,
            type,
            fromMonth: input.fromMonth,
            amount: input.amount,
            ruleId,
          }),
      );
    },

    async resetBudgets() {
      // 지금 보이는 규칙만 하나씩 지운다 (창구 머리말). 달별 조정은 규칙과 함께 간다.
      const { rules } = await store.budgetRules(projectId);
      for (const rule of rules) {
        await queue('budget.delete', [rule.id], { id: rule.id }, () => store.forgetRow('budget', rule.id));
      }
      return rules.length;
    },

    async updateProject(targetId, patch) {
      // 타임존이 섞였거나 다른 가계부면 서버로 곧바로 (창구 머리말). 끊겨 있으면 그대로 실패한다.
      if (targetId !== projectId || patch.timezone !== undefined) {
        await apiClient.updateProject(targetId, patch as never);
        return { queued: false };
      }
      const { name, description, displayCurrency } = patch;
      await queue(
        'project.update',
        [projectId],
        { id: projectId, name, description, displayCurrency },
        () => store.patchProject(projectId, { name, description, displayCurrency }),
      );
      return { queued: true };
    },

    async setExchangeRate(input) {
      const pair = `${input.from}:${input.to}`;
      await queue('exchangeRate.set', [pair], { id: pair, from: input.from, to: input.to, rate: input.rate }, async () => {
        // 서버와 같이 그날의 줄로 적는다 (날짜는 가계부 타임존). 같은 날 다시 넣으면 덮는다.
        const project = await store.projectRow(projectId);
        const dateKey = zonedDateKey(new Date(), project?.timeZone ?? 'Asia/Seoul');
        await store.putExchangeRate(projectId, { id: newId(), ...input, dateKey });
      });
    },

    async clearExchangeRate(input) {
      const pair = `${input.from}:${input.to}`;
      await queue('exchangeRate.clear', [pair], { id: pair, from: input.from, to: input.to }, () =>
        // 그 쌍의 줄을 전부 지운다 (서버와 같다 -- 한 줄만 지우면 옛 날짜 줄이 살아난다).
        store.dropExchangeRates(projectId, input.from, input.to),
      );
    },

    async setBudgetOverride(input) {
      const id = input.id ?? newId();
      await commit(
        'budget.override',
        id,
        {
          budgetId: input.budgetId,
          year: input.year,
          month: input.month,
          amount: input.amount ?? null,
        },
        {
          budgetId: input.budgetId,
          year: input.year,
          month: input.month,
          // 지우는 명령이면 곧바로 아래에서 줄째 지운다. 칸이 NOT NULL 이라 자리만 채운다.
          amount: input.amount ?? '0',
        },
      );
      /*
       * 지우는 명령이면 사본에서도 그 줄을 지운다. 예전에는 0원 조정을 남겨 두어, 조정을
       * 걷어냈는데 다음 pull 전까지 그 달 예산이 0원으로 보였다 (조정은 금액이 있어야 선다).
       */
      if (input.amount == null) {
        await store.forgetRow('budget_override', id);
        notifyMirrorChanged();
      }
      return { id };
    },
  };
}
