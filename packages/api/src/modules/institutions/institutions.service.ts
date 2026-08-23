import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { FinancialInstitutionType, Prisma } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';

@Injectable()
export class InstitutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * 은행/카드사 목록.
   *
   * 기본 제공 항목(projectId IS NULL)과 이 프로젝트가 직접 추가한 항목을 합쳐서 준다.
   * 프로젝트가 기본 항목과 같은 이름을 추가했다면 사용자 것만 남긴다.
   * 그러지 않으면 드롭다운에 같은 이름이 두 번 보인다.
   */
  async getInstitutions(
    userId: string,
    type?: FinancialInstitutionType,
    projectId?: string,
  ) {
    // 쿼리스트링은 검증을 거치지 않는다. 걸러내지 않으면 잘못된 값이 Prisma까지 내려가 500이 된다.
    if (type !== undefined && !Object.values(FinancialInstitutionType).includes(type)) {
      throw new BadRequestException('기관 종류가 올바르지 않습니다.');
    }

    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    const rows = await this.prisma.financialInstitution.findMany({
      where: {
        isActive: true,
        ...(type ? { type } : {}),
        OR: [{ projectId: null }, { projectId: finalProjectId }],
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const customKeys = new Set(
      rows.filter((r) => r.projectId !== null).map((r) => `${r.type}:${r.name}`),
    );

    return rows
      .filter((r) => r.projectId !== null || !customKeys.has(`${r.type}:${r.name}`))
      .map((r) => ({ ...r, isCustom: r.projectId !== null }));
  }

  /**
   * 계좌/카드가 참조하려는 기관이 이 프로젝트에서 쓸 수 있는지, 용도가 맞는지 확인한다.
   *
   * 다른 프로젝트가 추가한 항목을 id만 알아내 가리키는 것을 막아야 하고,
   * 은행을 카드사 자리에 넣는 것도 막아야 한다. 두 검사를 한곳에 모아 둔다.
   */
  async assertUsable(
    institutionId: string,
    projectId: string,
    expectedType: FinancialInstitutionType,
  ): Promise<void> {
    const institution = await this.prisma.financialInstitution.findUnique({
      where: { id: institutionId },
    });

    if (!institution || !institution.isActive) {
      throw new NotFoundException('기관을 찾을 수 없습니다.');
    }
    // projectId가 null이면 기본 제공 항목이라 모든 프로젝트가 쓸 수 있다.
    if (institution.projectId !== null && institution.projectId !== projectId) {
      throw new NotFoundException('기관을 찾을 수 없습니다.');
    }
    if (institution.type !== expectedType) {
      throw new BadRequestException(
        expectedType === FinancialInstitutionType.bank
          ? '은행으로 등록된 기관이 아닙니다.'
          : '카드사로 등록된 기관이 아닙니다.',
      );
    }
  }

  /**
   * 프로젝트 전용 기관을 추가한다.
   * 추가 화면은 아직 없지만, 기본 목록에 없는 기관을 쓰려면 이 경로가 필요하다.
   */
  async createInstitution(
    userId: string,
    dto: { type: FinancialInstitutionType; name: string; projectId?: string },
    projectIdParam?: string,
  ) {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || dto.projectId,
      'editor',
    );

    // DTO가 인터페이스라 ValidationPipe가 걸러 주지 않는다.
    // 검사하지 않으면 잘못된 type이 Prisma까지 내려가 500이 된다.
    if (!Object.values(FinancialInstitutionType).includes(dto.type)) {
      throw new BadRequestException('기관 종류가 올바르지 않습니다.');
    }

    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('기관 이름을 입력해 주세요.');

    // 기본 제공 목록에 이미 있으면 새로 만들지 않고 그 행을 돌려준다.
    // 같은 이름이 두 벌 생기는 것을 막는다.
    const preset = await this.prisma.financialInstitution.findFirst({
      where: { projectId: null, type: dto.type, name, isActive: true },
    });
    if (preset) return { ...preset, isCustom: false };

    try {
      const created = await this.prisma.financialInstitution.create({
        data: { projectId, type: dto.type, name },
      });
      return { ...created, isCustom: true };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('이미 등록된 기관입니다.');
      }
      throw error;
    }
  }
}
