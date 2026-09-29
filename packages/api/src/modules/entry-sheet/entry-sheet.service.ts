/**
 * 거래내역 엑셀 가져오기·내보내기. 열의 모양은 `@money/types` 의 `entry-sheet` 한 곳이다.
 *
 * 엑셀 파일을 읽고 쓰는 일은 화면(core 의 `entry-sheet`)이 하고, 여기는 글자로 된 행을 받아
 * 거래로 만들거나 거래를 글자로 된 행으로 푼다.
 *
 * **가져오기는 이름으로 맞춘다.** 구성원·결제수단·분류·태그를 이 가계부에서 이름으로 찾고,
 * 없으면 만든다(2026-09-30, 사용자 요청). 결제수단은 '자산 종류' 열로 무엇을 만들지 정하고,
 * 비었으면 이름으로 짐작한다(`guessEntrySheetAsset`). 만드는 길은 화면이 쓰는 서비스 그대로라
 * 변경 피드와 다른 기기 알림이 평소처럼 돈다.
 *
 * **행마다 따로 넣는다.** 한 거래가 실패해도 나머지는 들어가고, 넣지 못한 행과 까닭을
 * 돌려준다. 한 트랜잭션으로 묶지 않는 것은, 엑셀 몇 줄의 오타 때문에 수백 줄을 통째로
 * 되돌리면 사람이 오타를 찾을 길이 없어서다.
 *
 * **가져온 거래는 늘 새 거래다.** 거래ID 는 분할 거래의 행을 묶는 데만 쓴다.
 */
import { randomUUID } from 'crypto';

import { HttpException, Injectable } from '@nestjs/common';
import { AccountType, CardType, CategoryType, FinancialInstitutionType } from '@prisma/client';
import {
  Dec,
  ENTRY_SHEET_KINDS,
  EntrySheetDto,
  HIDDEN_ACCOUNT_TYPES,
  entrySheetAssetTypeOf,
  entrySheetKindOf,
  guessEntrySheetAsset,
  zonedDateKey,
  zonedDateStringToUtc,
  zonedFormValueToUtc,
  zonedTimeKey,
  type EntryDto,
  type EntrySheetAssetType,
  type EntrySheetKind,
  type EntrySheetRow,
} from '@money/types';

import { badRequest } from '@/common/app-error';
import { ProjectAccessService } from '@/common/project-access.guard';
import { PrismaService } from '@/config/prisma.service';
import { AccountsService } from '../accounts/accounts.service';
import { CardsService } from '../cards/cards.service';
import { CategoriesService } from '../categories/categories.service';
import { ENTRY_INCLUDE, toListItem } from '../entries/entry-view';
import { EntriesService } from '../entries/entries.service';
import { InstitutionsService } from '../institutions/institutions.service';
import { PeopleService } from '../people/people.service';
import { TagsService } from '../tags/tags.service';

/** 분류가 비었을 때 쓰는 분류. 지출·수입이 같은 이름이면 유일 제약(이름, 부모)에 걸린다. */
const FALLBACK_CATEGORY: Record<'expense' | 'income', string> = { expense: '기타', income: '기타수입' };
/** 이체 수수료의 분류. */
const FEE_CATEGORY = '수수료';
/** 카드사를 이름에서 못 찾았을 때 만드는 카드사. */
const FALLBACK_ISSUER = '기타 카드사';
/**
 * 새로 만드는 신용카드의 마감일·결제일. 카드마다 달라 사람이 나중에 고친다.
 * 가장 흔한 모양(전월 1일~말일 사용분을 14일에 결제)으로 둔다.
 */
const DEFAULT_CLOSING_DAY = 31;
const DEFAULT_DUE_DAY = 14;
/** 내보낼 때 한 번에 읽는 거래 수. */
const EXPORT_BATCH = 500;

const ACCOUNT_TYPE_OF: Partial<Record<EntrySheetAssetType, AccountType>> = {
  deposit: AccountType.deposit,
  savings: AccountType.savings,
  investment: AccountType.investment,
  cash: AccountType.cash,
  loan: AccountType.loan,
};
const ASSET_LABEL: Record<string, string> = {
  deposit: '통장',
  savings: '적금',
  investment: '투자',
  cash: '현금',
  loan: '대출',
  real_estate: '통장',
  debit: '체크카드',
  credit: '신용카드',
};

interface Asset {
  kind: 'account' | 'card';
  id: string;
  /** 카드면 debit | credit, 통장이면 AccountType. */
  type: string;
}

interface CategoryRow {
  id: string;
  name: string;
  type: CategoryType;
  parentId: string | null;
}

/** 한 번의 가져오기 동안 들고 있는 이름표. 만든 것도 곧바로 여기 더해 다음 행이 쓴다. */
interface ImportContext {
  userId: string;
  projectId: string;
  timeZone: string;
  myPersonId: string | null;
  people: Map<string, string>;
  assets: Map<string, Asset>;
  /** 구성원마다 카드 결제 통장으로 쓸 첫 통장. */
  depositOf: Map<string, string>;
  categories: CategoryRow[];
  tags: Map<string, string>;
  issuers: Array<{ id: string; name: string }>;
  created: EntrySheetDto.ImportResponse['createdNames'];
}

/** 이름을 견주는 모양. 앞뒤 빈칸과 대소문자를 무시한다. */
function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 행에서 넣지 못할 까닭. 사람이 읽을 문장이 곧 오류 문구다. */
class RowError extends Error {}

@Injectable()
export class EntrySheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly entries: EntriesService,
    private readonly people: PeopleService,
    private readonly accounts: AccountsService,
    private readonly cards: CardsService,
    private readonly categories: CategoriesService,
    private readonly tags: TagsService,
    private readonly institutions: InstitutionsService,
  ) {}

  // ---------------------------------------------------------------------------
  // 가져오기
  // ---------------------------------------------------------------------------

  async import(
    userId: string,
    dto: EntrySheetDto.ImportRequest,
    projectIdParam?: string,
  ): Promise<EntrySheetDto.ImportResponse> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(
      userId,
      projectIdParam,
      'editor',
    );
    const rows = Array.isArray(dto?.rows) ? dto.rows : null;
    if (!rows) throw badRequest('ENTRY_SHEET_INVALID', '행 목록이 없습니다.');
    if (rows.length > EntrySheetDto.MAX_ROWS) {
      throw badRequest('ENTRY_SHEET_INVALID', `한 번에 ${EntrySheetDto.MAX_ROWS}행까지 보낼 수 있습니다.`);
    }

    const context = await this.loadContext(userId, projectId, timeZone);
    const result: EntrySheetDto.ImportResponse = { created: 0, skipped: [], createdNames: context.created };

    for (const group of groupRows(rows)) {
      const rowNumbers = group.map((row) => row.row);
      try {
        const request = await this.buildEntry(context, group);
        if (!request) {
          result.skipped.push({ rows: rowNumbers, reason: '잔액 조정은 가져오지 않습니다.' });
          continue;
        }
        await this.entries.createEntry(userId, request, projectId);
        result.created += 1;
      } catch (error) {
        result.skipped.push({ rows: rowNumbers, reason: reasonOf(error) });
      }
    }
    return result;
  }

  private async loadContext(userId: string, projectId: string, timeZone: string): Promise<ImportContext> {
    const [member, people, accounts, cards, categories, tags, issuers] = await Promise.all([
      this.prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { personId: true },
      }),
      this.prisma.person.findMany({ where: { projectId }, select: { id: true, name: true }, orderBy: { sortRank: 'asc' } }),
      this.prisma.account.findMany({
        // 사람이 만든 자산만 이름으로 맞춘다. "미지정"이라 적은 결제수단이 숨은 계정에 붙지 않게 한다.
        where: { projectId, type: { notIn: [...HIDDEN_ACCOUNT_TYPES] as AccountType[] } },
        select: { id: true, name: true, type: true, ownerId: true },
        orderBy: { sortRank: 'asc' },
      }),
      this.prisma.card.findMany({ where: { projectId }, select: { id: true, name: true, cardType: true } }),
      this.prisma.category.findMany({
        where: { projectId },
        select: { id: true, name: true, type: true, parentId: true },
      }),
      this.prisma.tag.findMany({ where: { projectId }, select: { id: true, name: true } }),
      this.prisma.financialInstitution.findMany({
        where: {
          type: FinancialInstitutionType.card_issuer,
          OR: [{ projectId: null }, { projectId }],
        },
        select: { id: true, name: true },
      }),
    ]);

    const assets = new Map<string, Asset>();
    // 카드를 뒤에 넣는다. 통장과 카드 이름이 같으면 카드가 이긴다(카드 결제가 더 흔하다).
    for (const account of accounts) assets.set(nameKey(account.name), { kind: 'account', id: account.id, type: account.type });
    for (const card of cards) assets.set(nameKey(card.name), { kind: 'card', id: card.id, type: card.cardType });

    const depositOf = new Map<string, string>();
    for (const account of accounts) {
      if (account.ownerId && account.type === AccountType.deposit && !depositOf.has(account.ownerId)) {
        depositOf.set(account.ownerId, account.id);
      }
    }

    return {
      userId,
      projectId,
      timeZone,
      myPersonId: member?.personId ?? null,
      people: new Map(people.map((person) => [nameKey(person.name), person.id])),
      assets,
      depositOf,
      categories,
      tags: new Map(tags.map((tag) => [nameKey(tag.name), tag.id])),
      issuers,
      created: { people: [], accounts: [], cards: [], categories: [], tags: [] },
    };
  }

  /**
   * 한 거래(분할이면 여러 행)를 만들기 요청으로. 잔액 조정이면 null.
   *
   * **먼저 전부 읽고, 그다음에 만든다.** 날짜·금액·할부·자산 종류를 다 따져 본 뒤에야
   * 구성원·자산·분류·태그를 만든다. 순서를 뒤집으면 넣지 못할 행이 카드나 분류만 남기고
   * 떠난다(검사에서 할부 행이 체크카드를 남겼다).
   */
  private async buildEntry(context: ImportContext, group: EntrySheetRow[]): Promise<EntryDto.CreateRequest | null> {
    const [head] = group;
    const kind = kindOf(head);
    if (kind === 'adjustment') return null;

    const date = dateOf(head, context.timeZone);
    const text = {
      merchant: clean(head.merchant),
      description: clean(head.description),
      detailedNote: clean(head.memo),
    };

    if (kind === 'transfer' || kind === 'card_payment' || kind === 'card_refund') {
      if (group.length > 1) throw new RowError('이체·카드대금은 한 행이어야 합니다. 거래ID 가 겹치지 않는지 보세요.');
      const amount = amountOf(head.amount, '금액');
      const fee = optionalAmount(head.fee, '수수료');
      const fromPlan = planAsset(context, head.payment, head.paymentType, '결제수단');
      const toPlan = planAsset(context, head.toAsset, head.toAssetType, '받는 자산');
      if (kind === 'transfer' && (fromPlan.kind !== 'account' || toPlan.kind !== 'account')) {
        throw new RowError('이체는 통장끼리만 됩니다. 카드로 가는 돈은 구분을 "카드대금"으로 적어 주세요.');
      }
      if (kind !== 'transfer' && fromPlan.kind === toPlan.kind) {
        throw new RowError('카드대금은 결제수단과 받는 자산 가운데 하나가 통장, 하나가 카드여야 합니다.');
      }

      // 여기부터 만든다.
      const personId = await this.personOf(context, head.person);
      const from = await this.assetOf(context, fromPlan, personId);
      const to = await this.assetOf(context, toPlan, personId);
      const tagIds = await this.tagsOf(context, head.tags);
      const description = text.description ?? text.merchant ?? ENTRY_SHEET_KINDS[kind][0];

      if (kind === 'transfer') {
        return {
          kind: 'transfer',
          personId,
          date,
          description,
          merchant: text.merchant ?? undefined,
          detailedNote: text.detailedNote ?? undefined,
          amount,
          accountId: from.id,
          toAccountId: to.id,
          tagIds,
          ...(fee && Dec.of(fee).isPositive()
            ? {
                transferFee: fee,
                transferFeeCategoryId: await this.categoryOf(context, 'expense', FEE_CATEGORY, undefined),
                transferFeeLineKey: randomUUID(),
              }
            : {}),
        };
      }

      // 카드대금: 통장 → 카드. 환불이면 반대로 적혀 와도 통장과 카드를 가려 쓴다.
      const account = from.kind === 'account' ? from : to;
      const card = from.kind === 'card' ? from : to;
      return {
        kind: 'card_payment',
        personId,
        date,
        description,
        detailedNote: text.detailedNote ?? undefined,
        amount,
        accountId: account.id,
        cardId: card.id,
        cardTransferDirection: kind === 'card_refund' ? 'refund' : 'payment',
        tagIds,
      };
    }

    // 지출·수입 -- 먼저 읽는다.
    const parsedLines = group.map((row) => {
      const amount = amountOf(row.amount, '금액');
      const discount = optionalAmount(row.discount, '할인');
      if (discount && Dec.of(discount).gt(Dec.of(amount))) throw new RowError(`${row.row}행: 할인이 금액보다 큽니다.`);
      return { row, amount, discount: discount && Dec.of(discount).isPositive() ? discount : undefined };
    });
    /*
     * 결제수단이 비었으면 고르지 않은 것으로 넣는다. 조립이 미지정 계정에 붙이고, 내보낼 때도
     * 그 거래는 결제수단 칸이 비어 나가므로 그대로 되돌아온다.
     */
    const paymentName = clean(head.payment);
    const paymentPlan = paymentName ? planAsset(context, paymentName, head.paymentType, '결제수단') : null;
    const months = head.installmentMonths ? Number(String(head.installmentMonths).replace(/[^\d]/g, '')) : 0;
    if (months >= 2 && (kind !== 'expense' || paymentPlan?.kind !== 'card' || paymentPlan.type !== CardType.credit)) {
      throw new RowError('할부는 신용카드 지출에만 적을 수 있습니다.');
    }
    const currency = clean(head.currency)?.toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) throw new RowError(`통화 "${head.currency}"는 KRW·USD 처럼 세 글자로 적어 주세요.`);
    const billedAmount = optionalAmount(head.billedAmount, '청구액');

    // 여기부터 만든다.
    const personId = await this.personOf(context, head.person);
    const payment = paymentPlan ? await this.assetOf(context, paymentPlan, personId) : null;
    const lines = [];
    for (const line of parsedLines) {
      lines.push({
        categoryId: await this.categoryOf(context, kind, line.row.parentCategory, line.row.category),
        amount: line.amount,
        lineKey: randomUUID(),
        discountAmount: line.discount,
        tagIds: await this.tagsOf(context, line.row.tags),
      });
    }

    const description = text.description ?? text.merchant ?? this.categoryNameOf(context, lines[0].categoryId);
    const base = {
      kind,
      personId,
      date,
      description,
      merchant: text.merchant ?? undefined,
      detailedNote: text.detailedNote ?? undefined,
      ...(payment ? (payment.kind === 'card' ? { cardId: payment.id } : { accountId: payment.id }) : {}),
      ...(currency ? { currency } : {}),
      ...(billedAmount ? { billedAmount } : {}),
      ...(months >= 2 ? { installmentMonths: months, installmentInterest: false } : {}),
    } as const;

    if (lines.length === 1) {
      const [line] = lines;
      return {
        ...base,
        amount: line.amount,
        categoryId: line.categoryId,
        lineKey: line.lineKey,
        discountAmount: line.discountAmount,
        tagIds: line.tagIds,
      };
    }
    return {
      ...base,
      amount: Dec.sum(lines.map((line) => Dec.of(line.amount))).toString(),
      splits: lines,
    };
  }

  private async personOf(context: ImportContext, name: string | undefined): Promise<string> {
    const wanted = clean(name);
    if (!wanted) {
      if (context.myPersonId) return context.myPersonId;
      const first = context.people.values().next().value;
      if (first) return first;
      throw new RowError('구성원이 비었고 이 가계부에 "나"로 고른 구성원도 없습니다. 구성원 열을 채워 주세요.');
    }
    const found = context.people.get(nameKey(wanted));
    if (found) return found;

    const person = await this.people.createPerson(context.userId, { name: wanted }, context.projectId);
    context.people.set(nameKey(wanted), person.id);
    context.created.people.push(wanted);
    return person.id;
  }

  /** 결제수단·받는 자산. 있던 것이면 그대로, 없으면 계획(`planAsset`)대로 만든다. */
  private async assetOf(context: ImportContext, plan: AssetPlan, ownerId: string): Promise<Asset> {
    if (plan.existing) return plan.existing;
    // 같은 거래 안에서 방금 만든 것일 수 있다(한 행의 결제수단과 받는 자산이 같은 새 이름).
    const again = context.assets.get(nameKey(plan.name));
    if (again) return again;

    let asset: Asset;
    if (plan.kind === 'card') {
      const cardType = plan.type === CardType.credit ? CardType.credit : CardType.debit;
      const card = await this.cards.createCard(
        context.userId,
        {
          name: plan.name,
          cardType,
          paymentAccountId: await this.paymentAccountOf(context, ownerId, plan.name),
          issuerId: await this.issuerOf(context, plan.name),
          ...(cardType === CardType.credit
            ? { statementClosingDay: DEFAULT_CLOSING_DAY, paymentDueDay: DEFAULT_DUE_DAY }
            : {}),
        },
        context.projectId,
      );
      asset = { kind: 'card', id: card.id, type: cardType };
      context.created.cards.push(plan.name);
    } else {
      const accountType = plan.type as AccountType;
      const account = await this.accounts.createAccount(
        context.userId,
        { name: plan.name, type: accountType, ownerId },
        context.projectId,
      );
      asset = { kind: 'account', id: account.id, type: accountType };
      context.created.accounts.push(plan.name);
      if (accountType === AccountType.deposit && !context.depositOf.has(ownerId)) {
        context.depositOf.set(ownerId, account.id);
      }
    }
    context.assets.set(nameKey(plan.name), asset);
    return asset;
  }

  /** 새 카드의 결제 통장. 그 구성원의 첫 통장, 없으면 "<카드 이름> 결제 통장"을 만든다. */
  private async paymentAccountOf(context: ImportContext, ownerId: string, cardName: string): Promise<string> {
    const existing = context.depositOf.get(ownerId);
    if (existing) return existing;
    const name = `${cardName} 결제 통장`;
    const account = await this.accounts.createAccount(
      context.userId,
      { name, type: AccountType.deposit, ownerId },
      context.projectId,
    );
    context.depositOf.set(ownerId, account.id);
    context.assets.set(nameKey(name), { kind: 'account', id: account.id, type: AccountType.deposit });
    context.created.accounts.push(name);
    return account.id;
  }

  /**
   * 카드 이름에서 카드사를 찾는다. "신한카드" 는 "신한"으로, "KB국민카드" 는 "KB국민"·"국민"으로
   * 견준다. 못 찾으면 이 가계부에 "기타 카드사"를 만들어 쓴다.
   */
  private async issuerOf(context: ImportContext, cardName: string): Promise<string> {
    const target = nameKey(cardName);
    const matched = context.issuers.find((issuer) => {
      const key = nameKey(issuer.name).replace(/카드$/, '');
      return target.includes(key) || (key.startsWith('kb') && target.includes(key.slice(2)));
    });
    if (matched) return matched.id;

    const fallback = context.issuers.find((issuer) => issuer.name === FALLBACK_ISSUER);
    if (fallback) return fallback.id;
    const created = await this.institutions.createInstitution(
      context.userId,
      { type: FinancialInstitutionType.card_issuer, name: FALLBACK_ISSUER },
      context.projectId,
    );
    context.issuers.push({ id: created.id, name: FALLBACK_ISSUER });
    return created.id;
  }

  /**
   * 분류. 대분류·소분류 이름으로 찾고 없으면 만든다.
   *
   * 소분류가 비었으면 대분류 칸의 이름을 **어느 층에서든** 찾는다 -- '분류' 열 하나만 있는
   * 엑셀은 "커피" 처럼 소분류 이름을 그 칸에 적는다. 없으면 대분류로 만든다.
   */
  private async categoryOf(
    context: ImportContext,
    kind: 'expense' | 'income',
    parentName: string | undefined,
    childName: string | undefined,
  ): Promise<string> {
    const type = kind === 'income' ? CategoryType.income : CategoryType.expense;
    const parent = clean(parentName);
    const child = clean(childName);

    if (!parent && !child) return this.categoryOf(context, kind, FALLBACK_CATEGORY[kind], undefined);
    if (!parent || !child) {
      const only = (parent ?? child)!;
      const anyLevel =
        context.categories.find((row) => row.type === type && !row.parentId && nameKey(row.name) === nameKey(only)) ??
        context.categories.find((row) => row.type === type && nameKey(row.name) === nameKey(only));
      if (anyLevel) return anyLevel.id;
      return this.createCategory(context, only, type, null);
    }

    const top =
      context.categories.find((row) => row.type === type && !row.parentId && nameKey(row.name) === nameKey(parent))?.id ??
      (await this.createCategory(context, parent, type, null));
    const sub = context.categories.find(
      (row) => row.type === type && row.parentId === top && nameKey(row.name) === nameKey(child),
    );
    return sub ? sub.id : this.createCategory(context, child, type, top);
  }

  private async createCategory(
    context: ImportContext,
    name: string,
    type: CategoryType,
    parentId: string | null,
  ): Promise<string> {
    // 같은 층에 다른 갈래의 같은 이름이 있으면 유일 제약에 걸린다. 알아볼 문장으로 먼저 막는다.
    const clash = context.categories.find(
      (row) => row.parentId === parentId && nameKey(row.name) === nameKey(name) && row.type !== type,
    );
    if (clash) {
      throw new RowError(
        `분류 "${name}"이(가) 이미 ${clash.type === CategoryType.income ? '수입' : '지출'} 분류로 있어 ${type === CategoryType.income ? '수입' : '지출'} 분류로 만들 수 없습니다.`,
      );
    }
    const category = await this.categories.createCategory(
      context.userId,
      { name, type, ...(parentId ? { parentId } : {}) },
      context.projectId,
    );
    context.categories.push({ id: category.id, name, type, parentId });
    context.created.categories.push(parentId ? `${this.parentName(context, parentId)} > ${name}` : name);
    return category.id;
  }

  private parentName(context: ImportContext, id: string): string {
    return context.categories.find((row) => row.id === id)?.name ?? '';
  }

  private categoryNameOf(context: ImportContext, id: string): string {
    return context.categories.find((row) => row.id === id)?.name ?? '';
  }

  /** 태그. 쉼표·세미콜론·# 로 나눈다. 없으면 만든다. */
  private async tagsOf(context: ImportContext, text: string | undefined): Promise<string[]> {
    const names = [...new Set((text ?? '').split(/[,;#、，]/).map((part) => part.trim()).filter(Boolean))];
    const ids: string[] = [];
    for (const name of names) {
      let id = context.tags.get(nameKey(name));
      if (!id) {
        const tag = await this.tags.createTag(context.userId, { name }, context.projectId);
        id = tag.id;
        context.tags.set(nameKey(name), id);
        context.created.tags.push(name);
      }
      ids.push(id);
    }
    return ids;
  }

  // ---------------------------------------------------------------------------
  // 내보내기
  // ---------------------------------------------------------------------------

  /**
   * 거래를 행으로. 오래된 것부터, 분할 거래는 줄마다 한 행이다.
   *
   * 금액은 **정가**다(차감 전). 차감은 할인 칸에 따로 적는다 -- 가져오기가 금액에서 할인을
   * 빼므로, 차감 뒤의 값을 적으면 다시 가져올 때 두 번 빠진다. 한 줄짜리 외화 결제는 원래
   * 통화 금액과 청구액을 적고, 분할된 외화 결제는 장부 통화로 적는다(줄마다의 원래 통화
   * 금액이 저장되어 있지 않다).
   */
  async export(userId: string, query: EntrySheetDto.ExportQuery, projectIdParam?: string): Promise<EntrySheetRow[]> {
    const { id: projectId, timeZone } = await this.projectAccess.resolveProject(userId, projectIdParam);
    const cards = await this.prisma.card.findMany({ where: { projectId }, select: { id: true, cardType: true } });
    const cardTypeOf = new Map(cards.map((card) => [card.id, card.cardType as string]));

    const dateFilter = {
      ...(query.startDate ? { gte: zonedDateStringToUtc(checkDay(query.startDate), timeZone) } : {}),
      ...(query.endDate ? { lt: nextDay(zonedDateStringToUtc(checkDay(query.endDate), timeZone)) } : {}),
    };

    const rows: EntrySheetRow[] = [];
    let cursor: { date: Date; id: string } | null = null;
    for (;;) {
      const batch = await this.readBatch(projectId, dateFilter, cursor);
      if (batch.length === 0) break;
      for (const entry of batch) rows.push(...entryRows(entry, timeZone, cardTypeOf));
      const last = batch[batch.length - 1];
      cursor = { date: last.date, id: last.id };
      if (batch.length < EXPORT_BATCH) break;
    }
    // 행 번호는 머리글 다음부터다. 가져오기의 번호와 같은 뜻이다.
    rows.forEach((row, index) => (row.row = index + 2));
    return rows;
  }

  private readBatch(projectId: string, dateFilter: { gte?: Date; lt?: Date }, cursor: { date: Date; id: string } | null) {
    return this.prisma.journalEntry.findMany({
      where: {
        projectId,
        ...(Object.keys(dateFilter).length ? { date: dateFilter } : {}),
        ...(cursor ? { OR: [{ date: { gt: cursor.date } }, { date: cursor.date, id: { gt: cursor.id } }] } : {}),
      },
      include: ENTRY_INCLUDE,
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: EXPORT_BATCH,
    });
  }
}

// -----------------------------------------------------------------------------
// 가져오기의 조각
// -----------------------------------------------------------------------------

/** 거래ID 가 같은 행을 묶는다. 거래ID 가 빈 행은 혼자다. 처음 나온 차례를 지킨다. */
function groupRows(rows: EntrySheetRow[]): EntrySheetRow[][] {
  const groups: EntrySheetRow[][] = [];
  const byKey = new Map<string, EntrySheetRow[]>();
  for (const row of rows) {
    const key = clean(row.group);
    if (!key) {
      groups.push([row]);
      continue;
    }
    const group = byKey.get(key);
    if (group) group.push(row);
    else {
      const created = [row];
      byKey.set(key, created);
      groups.push(created);
    }
  }
  return groups;
}

function clean(value: string | undefined): string | undefined {
  const text = value?.toString().trim();
  return text ? text : undefined;
}

/** 결제수단을 무엇으로 쓸지. 있던 것이면 `existing`, 없으면 만들 종류다. 아직 아무것도 만들지 않는다. */
interface AssetPlan {
  name: string;
  kind: 'account' | 'card';
  /** 카드면 debit | credit, 통장이면 AccountType. */
  type: string;
  existing?: Asset;
}

function planAsset(
  context: Pick<ImportContext, 'assets'>,
  name: string | undefined,
  typeText: string | undefined,
  column: string,
): AssetPlan {
  const wanted = clean(name);
  if (!wanted) throw new RowError(`${column}이 비었습니다.`);
  const existing = context.assets.get(nameKey(wanted));
  if (existing) return { name: wanted, kind: existing.kind, type: existing.type, existing };

  const typed = clean(typeText);
  const type = typed ? entrySheetAssetTypeOf(typed) : guessEntrySheetAsset(wanted);
  if (!type) {
    throw new RowError(`자산 종류 "${typed}"를 모릅니다. 통장·적금·투자·현금·대출·체크카드·신용카드 가운데 하나로 적어 주세요.`);
  }
  if (type === 'debit_card' || type === 'credit_card') {
    return { name: wanted, kind: 'card', type: type === 'credit_card' ? CardType.credit : CardType.debit };
  }
  return { name: wanted, kind: 'account', type: ACCOUNT_TYPE_OF[type] ?? AccountType.deposit };
}

/**
 * 갈래. 구분 칸이 비었으면 짐작한다 -- 받는 자산이 있으면 이체, 금액이 음수면 지출,
 * 나머지도 지출이다(가계부에 적는 것의 대부분이 지출이다).
 */
function kindOf(head: EntrySheetRow): EntrySheetKind {
  const written = clean(head.kind);
  if (written) {
    const kind = entrySheetKindOf(written);
    if (!kind) throw new RowError(`구분 "${written}"을 모릅니다. 지출·수입·이체·카드대금·카드환불 가운데 하나로 적어 주세요.`);
    return kind;
  }
  if (clean(head.toAsset)) return 'transfer';
  return 'expense';
}

/** "12,000원", "₩12,000", "-4500" 같은 글에서 양수 금액을. 음수는 부호를 뗀다(갈래가 방향을 정한다). */
function amountOf(value: string | undefined, column: string): string {
  const amount = optionalAmount(value, column);
  if (!amount) throw new RowError(`${column}이 비었습니다.`);
  if (!Dec.of(amount).isPositive()) throw new RowError(`${column}은 0보다 커야 합니다.`);
  return amount;
}

function optionalAmount(value: string | undefined, column: string): string | undefined {
  const text = clean(value);
  if (!text) return undefined;
  const cleaned = text.replace(/[,\s원₩$¥€]|KRW|USD|JPY|EUR|CNY/gi, '').replace(/^\((.*)\)$/, '-$1');
  if (!/^[-+]?\d+(\.\d+)?$/.test(cleaned)) throw new RowError(`${column} "${text}"을 숫자로 읽지 못했습니다.`);
  return cleaned.replace(/^[-+]/, '').replace(/^0+(?=\d)/, '');
}

/**
 * 날짜와 시각. 날짜 칸에 시각이 함께 있어도 읽는다("2026-09-30 14:23").
 *
 * 받는 모양: 2026-09-30 · 2026.09.30 · 2026/9/30 · 2026. 9. 30. · 2026년 9월 30일 · 20260930.
 * 엑셀 날짜 칸은 화면이 "YYYY-MM-DD HH:mm" 로 바꿔 보낸다.
 */
function dateOf(head: EntrySheetRow, timeZone: string): string {
  const text = clean(head.date);
  if (!text) throw new RowError('날짜가 비었습니다.');

  const match =
    text.match(/(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/) ?? text.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!match) throw new RowError(`날짜 "${text}"를 읽지 못했습니다. 2026-09-30 처럼 적어 주세요.`);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new RowError(`날짜 "${text}"는 달력에 없는 날입니다.`);
  }

  const time = timeOf(clean(head.time) ?? text.slice((match.index ?? 0) + match[0].length));
  const dateOnly = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return zonedFormValueToUtc(dateOnly, time, timeZone).toISOString();
}

/** "14:23", "14:23:05", "오후 2:23", "2:23 PM". 못 읽으면 undefined(그날 0시). */
function timeOf(text: string): string | undefined {
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (/오후|pm/i.test(text) && hour < 12) hour += 12;
  if (/오전|am/i.test(text) && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** 서비스가 던진 것을 사람이 읽을 문장으로. */
function reasonOf(error: unknown): string {
  if (error instanceof RowError) return error.message;
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: unknown }).message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  return error instanceof Error ? error.message : String(error);
}

function checkDay(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw badRequest('ENTRY_SHEET_INVALID', '날짜는 2026-09-30 처럼 보내 주세요.');
  return value;
}

function nextDay(instant: Date): Date {
  return new Date(instant.getTime() + 24 * 60 * 60 * 1000);
}

// -----------------------------------------------------------------------------
// 내보내기의 조각
// -----------------------------------------------------------------------------

type ExportEntry = Parameters<typeof toListItem>[0];

function entryRows(entry: ExportEntry, timeZone: string, cardTypeOf: Map<string, string>): EntrySheetRow[] {
  const item = toListItem(entry);
  const date = new Date(item.date);
  const common: EntrySheetRow = {
    row: 0,
    group: item.id,
    date: zonedDateKey(date, timeZone),
    time: zonedTimeKey(date, timeZone),
    person: item.personName || undefined,
    merchant: item.merchant ?? undefined,
    description: item.description || undefined,
    memo: item.detailedNote ?? undefined,
  };

  const accountType = (id: string | null) =>
    entry.postings.find((posting) => posting.account?.id === id)?.account?.type as string | undefined;
  const typeLabel = (kind: 'account' | 'card', id: string | null): string | undefined => {
    if (!id) return undefined;
    const type = kind === 'card' ? cardTypeOf.get(id) : accountType(id);
    return type ? ASSET_LABEL[type] : undefined;
  };
  const tagText = (tags: Array<{ name: string }>) => tags.map((tag) => tag.name).join(', ') || undefined;

  if (item.kind === 'transfer') {
    const fee = item.feeAmount && Dec.of(item.feeAmount).isPositive() ? item.feeAmount : undefined;
    return [
      {
        ...common,
        kind: ENTRY_SHEET_KINDS.transfer[0],
        amount: item.amount,
        payment: item.accountName ?? undefined,
        paymentType: typeLabel('account', item.accountId),
        toAsset: item.toAccountName ?? undefined,
        toAssetType: typeLabel('account', item.toAccountId),
        fee,
        tags: tagText(item.tags),
      },
    ];
  }

  if (item.kind === 'card_payment' || item.kind === 'adjustment') {
    // 카드 부채 계정에서 돈이 나갔으면(카드 → 통장) 카드사 환불이다.
    const outgoing = entry.postings.find((posting) => posting.account && Dec.of(posting.baseAmount.toString()).isNegative());
    const isRefund = outgoing?.account?.type === AccountType.credit_card;
    const bank = entry.postings.find(
      (posting) => posting.account && posting.account.type !== AccountType.credit_card && posting.account.type !== AccountType.opening_balance,
    )?.account;
    if (item.kind === 'adjustment') {
      return [{ ...common, kind: ENTRY_SHEET_KINDS.adjustment[0], amount: item.amount, payment: bank?.name ?? item.accountName ?? undefined }];
    }
    return [
      {
        ...common,
        kind: isRefund ? ENTRY_SHEET_KINDS.card_refund[0] : ENTRY_SHEET_KINDS.card_payment[0],
        amount: item.amount,
        payment: bank?.name,
        paymentType: bank ? ASSET_LABEL[bank.type] : undefined,
        toAsset: item.cardName ?? undefined,
        toAssetType: typeLabel('card', item.cardId),
        tags: tagText(item.tags),
      },
    ];
  }

  // 지출·수입: 줄마다 한 행.
  const kindLabel = item.kind === 'income' ? ENTRY_SHEET_KINDS.income[0] : ENTRY_SHEET_KINDS.expense[0];
  const payment = item.cardId
    ? { payment: item.cardName ?? undefined, paymentType: typeLabel('card', item.cardId) }
    : { payment: item.accountName ?? undefined, paymentType: typeLabel('account', item.accountId) };
  const foreign =
    item.lines.length === 1 && !item.discountAmount && entry.originalCurrency && entry.originalAmount
      ? { amount: entry.originalAmount.toString(), currency: entry.originalCurrency }
      : null;

  return item.lines.map((line) => {
    const listPrice = line.discountAmount ? Dec.of(line.amount).plus(Dec.of(line.discountAmount)).toString() : line.amount;
    return {
      ...common,
      kind: kindLabel,
      amount: foreign ? foreign.amount : listPrice,
      currency: foreign ? foreign.currency : undefined,
      billedAmount: foreign ? listPrice : undefined,
      discount: line.discountAmount ?? undefined,
      parentCategory: line.parentCategoryName ?? line.categoryName,
      category: line.parentCategoryName ? line.categoryName : undefined,
      ...payment,
      tags: tagText(line.tags),
      installmentMonths: item.installmentMonths && item.installmentMonths >= 2 ? String(item.installmentMonths) : undefined,
    };
  });
}
