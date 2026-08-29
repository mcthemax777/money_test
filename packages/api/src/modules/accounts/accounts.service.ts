import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccountType, FinancialInstitutionType, Prisma, ProjectRole } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService } from '../ledger/ledger.service';
import { InstitutionsService } from '../institutions/institutions.service';
import { AccountDto } from '@money/types';
import { assertReorderIds } from '@/common/reorder';
import { toMoney, toOptionalMoney } from '@/common/money';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { badRequest } from '@/common/app-error';

/**
 * 사용자가 "통장"으로 인식하지 않는 내부 계정.
 * credit_card는 카드 화면의 "사용액", opening_balance는 기초잔액 상대편이라
 * 통장 목록에 노출하면 안 된다.
 */
export const HIDDEN_ACCOUNT_TYPES: AccountType[] = [
  AccountType.credit_card,
  AccountType.opening_balance,
];

/** 개설 기관이라는 개념이 없는 계정 유형. 기관이 들어오면 거부한다. */
const NO_INSTITUTION_TYPES: AccountType[] = [
  AccountType.cash,
  AccountType.real_estate,
  AccountType.opening_balance,
];

/** owner와 institution을 함께 주는 조회 형태. 응답 모양을 한곳에서 정한다. */
const ACCOUNT_INCLUDE = { owner: true, institution: true } satisfies Prisma.AccountInclude;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly ledger: LedgerService,
    private readonly institutions: InstitutionsService,
    private readonly exchangeRates: ExchangeRatesService,
  ) {}

  /**
   * 개설 기관을 검증해 저장할 값으로 바꾼다.
   * 현금/부동산처럼 기관이 없는 유형에 기관이 들어오면 조용히 버리지 않고 거부한다.
   */
  private async resolveInstitutionId(
    institutionId: string | null | undefined,
    type: AccountType,
    projectId: string,
  ): Promise<string | null> {
    if (!institutionId) return null;

    if (NO_INSTITUTION_TYPES.includes(type)) {
      throw new BadRequestException('이 유형의 계좌에는 개설 기관을 지정할 수 없습니다.');
    }

    await this.institutions.assertUsable(
      institutionId,
      projectId,
      FinancialInstitutionType.bank,
    );
    return institutionId;
  }

  async createAccount(userId: string, dto: AccountDto.CreateRequest, projectIdParam?: string) {
    const { id: projectId } = await this.projectAccess.resolveProject(
      userId,
      projectIdParam || dto.projectId,
      'editor',
    );

    if (HIDDEN_ACCOUNT_TYPES.includes(dto.type as AccountType)) {
      throw new BadRequestException('이 유형의 계정은 직접 만들 수 없습니다.');
    }

    const owner = await this.prisma.person.findUnique({ where: { id: dto.ownerId } });
    if (!owner || owner.projectId !== projectId) {
      throw new NotFoundException('유효한 통장 주인이 아닙니다.');
    }

    const institutionId = await this.resolveInstitutionId(
      dto.institutionId,
      dto.type as AccountType,
      projectId,
    );

    // 통화는 만들 때 정하고 그 뒤로 바꾸지 않는다. 거래가 쌓인 뒤에 바꾸면
    // 지금까지의 금액이 어느 통화였는지 알 수 없게 된다.
    const currency = dto.currency
      ? this.exchangeRates.assertCurrency(dto.currency, '계좌 통화')
      : await this.projectAccess.getProjectLedgerCurrency(projectId);

    // 목록은 주인별로 나뉘어 있고 드래그도 그 안에서 이뤄진다. 같은 주인의
    // 마지막 번호 다음을 준다. 기본값 0으로 두면 그 주인 목록의 앞쪽에 끼어든다.
    const lastOrder = await this.prisma.account.aggregate({
      where: { projectId, ownerId: dto.ownerId },
      _max: { sortOrder: true },
    });

    const account = await this.prisma.account.create({
      data: {
        projectId,
        ownerId: dto.ownerId,
        type: dto.type as AccountType,
        name: dto.name,
        institutionId,
        accountNumber: dto.accountNumber ?? null,
        currency,
        sortOrder: (lastOrder._max.sortOrder ?? -1) + 1,
      },
      include: ACCOUNT_INCLUDE,
    });

    // 개설 잔액은 컬럼에 직접 쓰지 않고 전표로 남긴다.
    // 그래야 "잔액 = posting 합계" 불변식이 처음부터 성립한다.
    // 날짜는 원장 맨 앞(1970-01-01)으로 고정된다. 기준일 입력은 없다.
    const opening = toOptionalMoney(dto.openingBalance, '기초 잔액');
    if (opening && !opening.isZero()) {
      await this.ledger.setBalanceTo({
        projectId,
        accountId: account.id,
        targetBalance: opening,
        createdByUserId: userId,
      });
      return this.getAccountById(account.id, userId);
    }

    return account;
  }

  /**
   * 통장 목록. 카드 부채와 자본 계정은 제외한다.
   *
   * includeInactive를 주면 사용자가 숨긴 통장까지 함께 준다. 숨기기를 되돌릴
   * 화면이 필요하기 때문이다. (HIDDEN_ACCOUNT_TYPES는 이것과 다른 개념으로,
   * 사용자에게 통장으로 보이지 않는 내부 계정이라 어느 경우에도 빠진다.)
   */
  async getAccounts(userId: string, projectId?: string, includeInactive = false) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.account.findMany({
      where: {
        projectId: finalProjectId,
        ...(includeInactive ? {} : { isActive: true }),
        type: { notIn: HIDDEN_ACCOUNT_TYPES },
      },
      include: ACCOUNT_INCLUDE,
      // 사용자가 드래그로 정한 순서. 같으면 최근에 만든 것부터.
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** 드래그로 바꾼 표시 순서 저장 */
  async reorderAccounts(userId: string, ids: string[], projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId,
      'editor',
    );

    const rows = await this.prisma.account.findMany({
      where: { projectId: finalProjectId },
      select: { id: true },
    });
    assertReorderIds(ids, new Set(rows.map((row) => row.id)));

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.account.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    return this.getAccounts(userId, finalProjectId);
  }

  /**
   * 통장 조회. 수정·삭제 경로는 requiredRole에 'editor'를 넘겨
   * 읽기 전용 구성원이 통장을 고치지 못하게 한다.
   */
  async getAccountById(id: string, userId: string, requiredRole: ProjectRole = 'viewer') {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: ACCOUNT_INCLUDE,
    });
    if (!account) throw new NotFoundException('통장을 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, account.projectId, requiredRole);
    return account;
  }

  async updateAccount(id: string, userId: string, dto: AccountDto.UpdateRequest) {
    const account = await this.getAccountById(id, userId, 'editor');

    const { balance, institutionId } = dto;

    // 요청 본문을 스프레드로 Prisma에 넘기면 안 된다.
    // DTO가 인터페이스라 ValidationPipe(whitelist: false)가 낯선 키를 지우지 않으므로
    // `{"institution": {"connect": {"id": ...}}}` 같은 관계 조작이 그대로 통과해
    // institutionId 검증을 우회한다. `{"type": "cash"}`로 유형만 바꿔
    // 기관 없는 유형에 기관을 남길 수도 있다. 그래서 허용 컬럼만 골라 담는다.
    const data: Prisma.AccountUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.accountNumber !== undefined) data.accountNumber = dto.accountNumber;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    // 키가 아예 없을 때(변경 의사 없음)와 null일 때(연결 해제)를 구분한다.
    if ('institutionId' in dto) {
      const resolved = await this.resolveInstitutionId(
        institutionId,
        account.type,
        account.projectId,
      );
      data.institution = resolved ? { connect: { id: resolved } } : { disconnect: true };
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.account.update({ where: { id }, data });
    }

    // 잔액 수정은 조정 전표를 새로 쌓지 않는다. 기초잔액 전표를 다시 계산해
    // 덮어쓰므로, 지금까지의 거래는 그대로 남고 현재 잔액만 목표값이 된다.
    if (balance !== undefined) {
      await this.ledger.setBalanceTo({
        projectId: account.projectId,
        accountId: id,
        targetBalance: toMoney(balance, '잔액'),
        createdByUserId: userId,
      });
    }

    return this.getAccountById(id, userId);
  }

  /**
   * 계좌 원장. 이 계좌를 거쳐간 posting만 시간순으로 준다.
   *
   * 예전에는 `accountId OR toAccountId` 조합에 credit_usage 제외 조건까지 붙여야 했다.
   * 원장 구조에서는 accountId 하나로 끝난다.
   */
  async getAccountPostings(
    id: string,
    userId: string,
    options: { limit?: number; cursor?: string } = {},
  ) {
    await this.getAccountById(id, userId);
    const limit = Math.min(Number(options.limit) || 50, 200);

    const rows = await this.prisma.posting.findMany({
      where: { accountId: id },
      include: {
        entry: { select: { id: true, date: true, description: true, merchant: true } },
        card: { select: { id: true, name: true } },
      },
      orderBy: [{ entry: { date: 'desc' } }, { id: 'desc' }],
      take: limit + 1,
      ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    if (page.length === 0) {
      return { data: [], nextCursor: null };
    }

    /*
     * 잔액 추이.
     *
     * 이 페이지에서 가장 오래된 행 **직전**까지 쌓인 잔액을 DB에서 구한 뒤,
     * 오래된 것부터 금액을 더해 올라가며 각 행의 잔액을 만든다.
     *
     * 예전에는 계좌의 현재 잔액에서 시작해 빼 내려갔다. 첫 페이지는 맞지만
     * 두 번째 페이지도 다시 현재 잔액에서 시작해, 이미 지나온 거래 금액만큼
     * 통째로 어긋났다.
     */
    const oldest = page[page.length - 1];
    let running = (await this.cumulativeBalanceThrough(id, oldest)).sub(oldest.amount);

    const data = page
      .slice()
      .reverse()
      .map((posting) => {
        running = running.add(posting.amount);
        return {
          postingId: posting.id,
          entryId: posting.entry.id,
          date: posting.entry.date.toISOString(),
          description: posting.entry.description,
          merchant: posting.entry.merchant,
          amount: posting.amount.toString(),
          balanceAfter: running.toString(),
          cardId: posting.card?.id ?? null,
          cardName: posting.card?.name ?? null,
        };
      })
      .reverse();

    return { data, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /**
   * 그 posting까지(포함) 이 계좌에 쌓인 잔액.
   *
   * 목록의 정렬 기준이 (entry.date desc, posting.id desc)이므로 "앞선 행"의
   * 판정도 같은 튜플로 해야 한다. 날짜만 비교하면 같은 날짜의 여러 거래가
   * 서로의 잔액에 끼어든다.
   *
   * 계좌의 balance 컬럼을 쓰지 않고 posting을 더하는 이유는, 이 값이 페이지
   * 중간 지점의 잔액이어서 캐시 컬럼으로는 만들 수 없기 때문이다.
   */
  private async cumulativeBalanceThrough(
    accountId: string,
    row: { id: string; entry: { date: Date } },
  ): Promise<Prisma.Decimal> {
    const total = await this.prisma.posting.aggregate({
      _sum: { amount: true },
      where: {
        accountId,
        OR: [
          { entry: { date: { lt: row.entry.date } } },
          { entry: { date: row.entry.date }, id: { lte: row.id } },
        ],
      },
    });

    return total._sum.amount ?? new Prisma.Decimal(0);
  }

  /**
   * 통장 숨기기. 원장 기록은 남겨야 하므로 하드 삭제하지 않는다.
   *
   * 거래 기록이 있어도 숨길 수 있다. 예전에는 posting이 하나라도 있으면 막았는데,
   * 이 함수는 애초에 isActive를 내리는 것뿐이라 해지한 통장을 목록에서 치울
   * 방법이 아예 없었다. 기록은 그대로 남고 목록에서만 빠진다.
   *
   * 남겨 둔 조건은 숨겼을 때 숫자가 어긋나는 경우뿐이다.
   *   - 잔액이 남아 있으면: 순자산 집계가 활성 계좌만 보므로 총자산이 조용히 준다.
   *   - 연결된 활성 카드가 있으면: 결제 통장이 사라진 카드가 남는다.
   */
  async deactivateAccount(id: string, userId: string) {
    const account = await this.getAccountById(id, userId, 'editor');

    const cardCount = await this.prisma.card.count({
      where: { paymentAccountId: id, isActive: true },
    });
    if (cardCount > 0) {
      throw badRequest('ACCOUNT_HAS_CARDS', '이 통장에 연결된 카드가 있어서 숨길 수 없습니다.');
    }

    if (!account.balance.isZero()) {
      throw badRequest(
        'ACCOUNT_HAS_BALANCE',
        '잔액이 남아 있어 숨길 수 없습니다. 먼저 잔액을 0으로 맞추세요.',
      );
    }

    return this.prisma.account.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
