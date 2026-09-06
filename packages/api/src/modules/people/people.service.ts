import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, ProjectRole } from '@prisma/client';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { PersonDto, initialRanks, rankAfter } from '@money/types';
import { assertReorderIds } from '@/common/reorder';
import { clientId, rejectDuplicateId } from '@/common/client-id';
import { badRequest } from '@/common/app-error';
import { stampFieldClocks } from '@/common/field-clock';
import { lockLedgerWrites } from '@/common/ledger-lock';
import { ServerClockService } from '@/common/server-clock';

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly clock: ServerClockService,
  ) {}

  /**
   * 구성원 만들기.
   *
   * `hlc` 는 기기가 오프라인에서 적은 명령을 재생할 때만 온다. 온라인 요청은 비우고,
   * 그때는 서버 시계를 찍는다 -- 언제나 가장 늦은 값이라 뒤에 도착한 옛 편집에 지지 않는다.
   */
  async createPerson(
    userId: string,
    dto: PersonDto.CreateRequest,
    projectId?: string,
    hlc?: string,
  ) {
    const finalProjectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectId || dto.projectId,
      'editor',
    );

    // 새 구성원은 목록 맨 뒤에 붙인다. 지금 마지막 순서 뒤에 값을 하나 만든다.
    const lastRank = await this.prisma.person.aggregate({
      where: { projectId: finalProjectId },
      _max: { sortRank: true },
    });

    return rejectDuplicateId('구성원', () =>
      this.prisma.person.create({
        data: {
          id: clientId(dto.id, '구성원 식별자'),
          projectId: finalProjectId,
          name: dto.name,
          relationship: dto.relationship,
          sortRank: rankAfter(lastRank._max.sortRank),
          fieldHlc: stampFieldClocks(null, ['name', 'relationship'], hlc ?? this.clock.now()),
        },
      }),
    );
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
      orderBy: [{ sortRank: 'asc' }, { createdAt: 'asc' }],
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

    /*
     * 목록 전체를 받았으니 순서 값도 고르게 다시 매긴다.
     *
     * 웹의 드래그가 아직 목록 전체를 보내는 경로다. 오프라인 이동은 이 길이 아니라
     * 그 항목 한 줄의 `sortRank` 만 바꾸는 명령으로 온다 (필드별 병합).
     */
    const ranks = initialRanks(ids.length);
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.person.update({ where: { id }, data: { sortRank: ranks[index] } }),
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

  async updatePerson(id: string, userId: string, dto: PersonDto.UpdateRequest, hlc?: string) {
    const person = await this.getPersonById(id, userId, 'editor');

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
    // 순서 바꾸기는 이 필드 하나다 (분수 색인). 목록 전체를 다시 쓰지 않는다.
    if (dto.sortRank !== undefined) data.sortRank = dto.sortRank;

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('변경할 내용이 없습니다.');
    }

    // 바꾼 필드에만 시계를 찍는다. 건드리지 않은 필드는 남의 편집이 그대로 이긴다.
    data.fieldHlc = stampFieldClocks(person.fieldHlc, Object.keys(data), hlc ?? this.clock.now());

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
  async deactivatePerson(id: string, userId: string, hlc?: string) {
    const person = await this.getPersonById(id, userId, 'editor');

    /*
     * 확인과 숨기기를 한 트랜잭션에 넣고, 먼저 원장 쓰기를 줄 세운다 (`lockLedgerWrites`).
     *
     * 밖에서 세면 그 사이에 이 사람 앞으로 통장이 하나 생길 수 있고, 그러면 주인이
     * 목록에서 사라진 통장이 남는다.
     */
    return this.prisma.$transaction(async (tx) => {
      await lockLedgerWrites(tx, person.projectId);

      const accountCount = await tx.account.count({
        where: { ownerId: id, isActive: true },
      });
      if (accountCount > 0) {
        throw badRequest('PERSON_HAS_ACCOUNTS', '이 사람이 주인인 통장이 있어서 숨길 수 없습니다.');
      }

      const fresh = await tx.person.findUniqueOrThrow({ where: { id } });
      return tx.person.update({
        where: { id },
        data: {
          isActive: false,
          fieldHlc: stampFieldClocks(fresh.fieldHlc, ['isActive'], hlc ?? this.clock.now()),
        },
      });
    });
  }
}
