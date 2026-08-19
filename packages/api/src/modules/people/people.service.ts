import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { PersonDto } from '@money/types';

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

    return this.prisma.person.create({
      data: {
        projectId: finalProjectId,
        name: dto.name,
        relationship: dto.relationship,
      },
    });
  }

  /** 프로젝트 멤버는 모두 같은 사람 목록을 본다 (입력자별로 나누지 않는다). */
  async getPeople(userId: string, projectId?: string) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(userId, projectId);

    return this.prisma.person.findMany({
      where: { projectId: finalProjectId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
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
