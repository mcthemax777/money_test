import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { PersonDto } from '@money/types';
import { assertReorderIds } from '@/common/reorder';

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

  /** 프로젝트 멤버는 모두 같은 사람 목록을 본다 (입력자별로 나누지 않는다). */
  async getPeople(userId: string, projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.person.findMany({
      where: { projectId: finalProjectId, isActive: true },
      // 사용자가 드래그로 정한 순서. 같으면 만든 순.
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** 드래그로 바꾼 표시 순서 저장 */
  async reorderPeople(userId: string, ids: string[], projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

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

  async getPersonById(id: string, userId: string) {
    const person = await this.prisma.person.findUnique({ where: { id } });
    if (!person) throw new NotFoundException('사람을 찾을 수 없습니다.');

    await this.projectAccess.verifyUserHasAccessToProject(userId, person.projectId);
    return person;
  }

  async updatePerson(id: string, userId: string, dto: PersonDto.UpdateRequest) {
    await this.getPersonById(id, userId);
    return this.prisma.person.update({ where: { id }, data: dto });
  }

  async deletePerson(id: string, userId: string) {
    await this.getPersonById(id, userId);

    const accountCount = await this.prisma.account.count({
      where: { ownerId: id, isActive: true },
    });
    if (accountCount > 0) {
      throw new BadRequestException('이 사람이 주인인 계좌가 있어서 삭제할 수 없습니다.');
    }

    const entryCount = await this.prisma.journalEntry.count({ where: { personId: id } });
    if (entryCount > 0) {
      throw new BadRequestException('이 사람의 거래 기록이 있어서 삭제할 수 없습니다.');
    }

    return this.prisma.person.update({ where: { id }, data: { isActive: false } });
  }
}
