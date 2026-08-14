import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';
import { PersonDto } from '@money/types';

@Injectable()
export class PeopleService {
  constructor(private readonly prisma: PrismaService) {}

  private async getUserDefaultProjectId(userId: string): Promise<string> {
    const member = await this.prisma.projectMember.findFirst({
      where: { userId, role: 'owner' },
      select: { projectId: true },
    });

    if (!member) {
      throw new BadRequestException('기본 프로젝트를 찾을 수 없습니다.');
    }

    return member.projectId;
  }

  async createPerson(userId: string, dto: PersonDto.CreateRequest, projectId?: string): Promise<PersonDto.Response> {
    const finalProjectId = projectId || (dto as any).projectId || dto.projectId || (await this.getUserDefaultProjectId(userId));

    return this.prisma.person.create({
      data: {
        projectId: finalProjectId,
        userId,
        name: dto.name,
        relationship: dto.relationship,
      },
    });
  }

  async getPeople(userId: string, projectId?: string): Promise<PersonDto.Response[]> {
    const finalProjectId = projectId || (await this.getUserDefaultProjectId(userId));

    return this.prisma.person.findMany({
      where: { userId, projectId: finalProjectId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getPersonById(id: string, userId: string): Promise<PersonDto.Response> {
    const person = await this.prisma.person.findUnique({
      where: { id },
    });

    if (!person || person.userId !== userId) {
      throw new NotFoundException('사람을 찾을 수 없습니다.');
    }

    return person;
  }

  async updatePerson(
    id: string,
    userId: string,
    dto: PersonDto.UpdateRequest,
  ): Promise<PersonDto.Response> {
    await this.getPersonById(id, userId);

    return this.prisma.person.update({
      where: { id },
      data: dto,
    });
  }

  async deletePerson(id: string, userId: string): Promise<PersonDto.Response> {
    await this.getPersonById(id, userId);

    // 해당 사람이 주인인 계좌가 있는지 확인
    const accountCount = await this.prisma.account.count({
      where: { ownerId: id, isActive: true },
    });

    if (accountCount > 0) {
      throw new BadRequestException('이 사람이 주인인 계좌가 있어서 삭제할 수 없습니다.');
    }

    // 해당 사람이 사용자인 거래가 있는지 확인
    const transactionCount = await this.prisma.transaction.count({
      where: { personId: id },
    });

    if (transactionCount > 0) {
      throw new BadRequestException('이 사람의 거래 기록이 있어서 삭제할 수 없습니다.');
    }

    return this.prisma.person.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
