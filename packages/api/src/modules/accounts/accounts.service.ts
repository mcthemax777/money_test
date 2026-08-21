import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccountType, FinancialInstitutionType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService } from '../ledger/ledger.service';
import { InstitutionsService } from '../institutions/institutions.service';
import { AccountDto } from '@money/types';
import { assertReorderIds } from '@/common/reorder';

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
        currency: dto.currency ?? 'KRW',
        sortOrder: (lastOrder._max.sortOrder ?? -1) + 1,
      },
      include: ACCOUNT_INCLUDE,
    });

    // 개설 잔액은 컬럼에 직접 쓰지 않고 전표로 남긴다.
    // 그래야 "잔액 = posting 합계" 불변식이 처음부터 성립한다.
    // 날짜는 원장 맨 앞(1970-01-01)으로 고정된다. 기준일 입력은 없다.
    const opening = dto.openingBalance ? new Prisma.Decimal(dto.openingBalance) : null;
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

  /** 통장 목록. 카드 부채와 자본 계정은 제외한다. */
  async getAccounts(userId: string, projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.account.findMany({
      where: {
        projectId: finalProjectId,
        isActive: true,
        type: { notIn: HIDDEN_ACCOUNT_TYPES },
      },
      include: ACCOUNT_INCLUDE,
      // 사용자가 드래그로 정한 순서. 같으면 최근에 만든 것부터.
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /** 드래그로 바꾼 표시 순서 저장 */
  async reorderAccounts(userId: string, ids: string[], projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

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

  async getAccountById(id: string, userId: string) {
    const account = await this.prisma.account.findUnique({
      where: { id },
      include: ACCOUNT_INCLUDE,
    });
    if (!account) throw new NotFoundException('통장을 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, account.projectId);
    return account;
  }

  async updateAccount(id: string, userId: string, dto: AccountDto.UpdateRequest) {
    const account = await this.getAccountById(id, userId);

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
        targetBalance: new Prisma.Decimal(balance),
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

    // 잔액 추이를 함께 준다 (최신부터 거슬러 올라가며 계산)
    const account = await this.prisma.account.findUniqueOrThrow({ where: { id } });
    let running = account.balance;
    const data = page.map((posting) => {
      const balanceAfter = running;
      running = running.sub(posting.amount);
      return {
        postingId: posting.id,
        entryId: posting.entry.id,
        date: posting.entry.date.toISOString(),
        description: posting.entry.description,
        merchant: posting.entry.merchant,
        amount: posting.amount.toString(),
        balanceAfter: balanceAfter.toString(),
        cardId: posting.card?.id ?? null,
        cardName: posting.card?.name ?? null,
      };
    });

    return { data, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /**
   * 통장 비활성화. 원장 기록은 남겨야 하므로 하드 삭제하지 않는다.
   */
  async deleteAccount(id: string, userId: string) {
    const account = await this.getAccountById(id, userId);

    const cardCount = await this.prisma.card.count({
      where: { paymentAccountId: id, isActive: true },
    });
    if (cardCount > 0) {
      throw new BadRequestException('이 통장에 연결된 카드가 있어서 삭제할 수 없습니다.');
    }

    const postingCount = await this.prisma.posting.count({ where: { accountId: id } });
    if (postingCount > 0) {
      throw new BadRequestException('이 통장의 거래 기록이 있어서 삭제할 수 없습니다.');
    }

    if (!account.balance.isZero()) {
      throw new BadRequestException('잔액이 남아 있어 삭제할 수 없습니다.');
    }

    return this.prisma.account.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
