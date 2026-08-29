import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, ProjectRole } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { PersonDto } from '@money/types';
import { assertReorderIds } from '@/common/reorder';
import { badRequest } from '@/common/app-error';

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createPerson(userId: string, dto: PersonDto.CreateRequest, projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId || dto.projectId,
      'editor',
    );

    // 새 구성원은 목록 맨 뒤에 붙인다. sortOrder를 기본값 0으로 두면
    // 드래그로 0,1,2...를 매긴 목록의 앞쪽에 끼어든다.
    const lastOrder = await this.prisma.person.aggregate({
      where: { projectId: finalProjectId },
      _max: { sortOrder: true },
    });

    return this.prisma.person.create({
      data: {
        projectId: finalProjectId,
        name: dto.name,
        relationship: dto.relationship,
        sortOrder: (lastOrder._max.sortOrder ?? -1) + 1,
      },
    });
  }

  /**
   * 프로젝트 멤버는 모두 같은 사람 목록을 본다 (입력자별로 나누지 않는다).
   * includeInactive를 주면 숨긴 구성원까지 함께 준다 (되돌리기 화면용).
   */
  async getPeople(userId: string, projectId?: string, includeInactive = false) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.person.findMany({
      where: {
        projectId: finalProjectId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      // 사용자가 드래그로 정한 순서. 같으면 만든 순.
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** 드래그로 바꾼 표시 순서 저장 */
  async reorderPeople(userId: string, ids: string[], projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId,
      'editor',
    );

    const rows = await this.prisma.person.findMany({
      where: { projectId: finalProjectId },
      select: { id: true },
    });
    assertReorderIds(ids, new Set(rows.map((row) => row.id)));

    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.person.update({ where: { id }, data: { sortOrder: index } }),
      ),
    );

    return this.getPeople(userId, finalProjectId);
  }

  /** 수정·삭제 경로는 requiredRole에 'editor'를 넘긴다. */
  async getPersonById(id: string, userId: string, requiredRole: ProjectRole = 'viewer') {
    const person = await this.prisma.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundException('사람을 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, person.projectId, requiredRole);
    return person;
  }

  async updatePerson(id: string, userId: string, dto: PersonDto.UpdateRequest) {
    await this.getPersonById(id, userId, 'editor');

    // 요청 본문을 스프레드로 Prisma에 넘기면 안 된다 (accounts/cards와 같은 이유).
    // DTO가 인터페이스라 ValidationPipe(whitelist: false)가 낯선 키를 지우지 않으므로
    // `{"projectId": "<남의 프로젝트>"}` 하나로 구성원을 다른 프로젝트로 옮길 수 있고,
    // `{"accounts": {...}}` 같은 관계 조작도 그대로 통과한다. 허용 컬럼만 골라 담는다.
    const data: Prisma.PersonUpdateInput = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('이름을 입력해주세요.');
      data.name = name;
    }
    if (dto.relationship !== undefined) data.relationship = dto.relationship || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('변경할 내용이 없습니다.');
    }

    return this.prisma.person.update({ where: { id }, data });
  }

  /**
   * 구성원 숨기기. 하드 삭제하지 않는다.
   *
   * 거래 기록이 있어도 숨길 수 있다. 예전에는 거래가 하나라도 있으면 막았는데,
   * 이 함수는 isActive를 내리는 것뿐이라 더 이상 쓰지 않는 구성원을 목록에서
   * 치울 방법이 없었다. 과거 거래는 personId로 이름을 계속 해석하므로
   * 거래 목록의 표시는 그대로다.
   *
   * 활성 계좌 조건만 남긴다. 주인이 목록에서 사라진 통장이 생기면 안 된다.
   */
  async deactivatePerson(id: string, userId: string) {
    await this.getPersonById(id, userId, 'editor');

    const accountCount = await this.prisma.account.count({
      where: { ownerId: id, isActive: true },
    });
    if (accountCount > 0) {
      throw badRequest('PERSON_HAS_ACCOUNTS', '이 사람이 주인인 통장이 있어서 숨길 수 없습니다.');
    }

    return this.prisma.person.update({ where: { id }, data: { isActive: false } });
  }
}
