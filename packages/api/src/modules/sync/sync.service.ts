import { Injectable } from '@nestjs/common';
import { SyncDto } from '@money/types';
import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';

/** 표당 기본 상한. 한 가정의 하루 변경은 이 안에 넉넉히 들어온다. */
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

/**
 * 변경 피드를 읽어 주는 곳.
 *
 * 두 가지를 지킨다.
 *
 * 1) 상한을 먼저 읽는다. Project.syncVersion 을 맨 처음 읽어 그 번호를 모든 질의의
 *    상한으로 쓴다. 그러지 않으면 표를 하나씩 읽는 사이에 들어온 쓰기가 어떤 표에는
 *    실리고 어떤 표에는 빠진 채 응답 번호 아래로 묻힌다. 묻힌 변경은 다음 요청에서도
 *    "이미 본 번호"라 다시 오지 않는다.
 *
 * 2) 넘치면 안전한 자리에서 끊는다. 어느 표든 상한을 넘겼으면, 그 표에서 버린 첫 행의
 *    번호 바로 앞까지만 응답에 담는다. 번호는 쓰기마다 하나씩 발급되므로 그 자리에서
 *    끊으면 어떤 변경도 반쪽만 실리지 않는다.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * 이 프로젝트가 지금 몇 번인가.
   *
   * SSE 로 붙는 순간에 한 번 보낸다. 끊겨 있던 동안의 신호는 이미 지나갔으므로,
   * 붙자마자 지금 번호를 알려 주어야 기기가 밀린 변경을 받아 간다.
   */
  async currentVersion(projectId: string): Promise<number> {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { syncVersion: true },
    });
    return project.syncVersion;
  }

  async pull(
    userId: string,
    query: SyncDto.PullQuery,
    projectIdParam?: string,
  ): Promise<SyncDto.PullResponse> {
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || query.projectId,
    );

    const since = Math.max(0, Number(query.since) || 0);
    const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_LIMIT), MAX_LIMIT);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { syncVersion: true },
      });
      const ceiling = project.syncVersion;

      if (ceiling <= since) {
        return this.emptyResponse(projectId, since, ceiling);
      }

      const window = { gt: since, lte: ceiling };
      const page = { orderBy: { updatedVersion: 'asc' }, take: limit + 1 } as const;

      // 표를 한 번에 읽는다. 상한이 이미 고정돼 있어 순서는 결과에 영향을 주지 않는다.
      const [
        projectRow,
        members,
        people,
        accounts,
        categories,
        tags,
        cards,
        entries,
        budgets,
        budgetOverrides,
        exchangeRates,
        assetValuations,
        installmentPlans,
        tombstones,
      ] = await Promise.all([
        tx.project.findFirst({ where: { id: projectId, updatedVersion: window } }),
        tx.projectMember.findMany({ where: { projectId, updatedVersion: window }, ...page }),
        tx.person.findMany({ where: { projectId, updatedVersion: window }, ...page }),
        tx.account.findMany({ where: { projectId, updatedVersion: window }, ...page }),
        tx.category.findMany({ where: { projectId, updatedVersion: window }, ...page }),
        tx.tag.findMany({ where: { projectId, updatedVersion: window }, ...page }),
        tx.card.findMany({ where: { projectId, updatedVersion: window }, ...page }),
        tx.journalEntry.findMany({
          where: { projectId, updatedVersion: window },
          /*
           * 태그 연결은 전표에 실어 함께 보낸다. 다리와 같은 이유다 -- 이 표에는
           * 번호가 없어 따로 실을 수 없다. 태그 자신(이름·색)은 위의 `tags` 로 온다.
           */
          include: { postings: true, tags: { select: { tagId: true } } },
          ...page,
        }),
        tx.budget.findMany({ where: { projectId, updatedVersion: window }, ...page }),
        tx.budgetOverride.findMany({
          where: { budget: { projectId }, updatedVersion: window },
          ...page,
        }),
        tx.exchangeRate.findMany({ where: { projectId, updatedVersion: window }, ...page }),
        /*
         * 두 표는 projectId 컬럼이 없어 부모를 거쳐 고른다.
         *
         * 평가액은 계좌를, 할부 계획은 다리와 전표를 거친다. 번호를 찍는 트리거도
         * 같은 길을 따라간다 (마이그레이션 20260902093000_sync_valuation_installment).
         */
        tx.assetValuation.findMany({
          where: { account: { projectId }, updatedVersion: window },
          ...page,
        }),
        tx.installmentPlan.findMany({
          where: { posting: { entry: { projectId } }, updatedVersion: window },
          ...page,
        }),
        tx.tombstone.findMany({
          where: { projectId, deletedVersion: window },
          orderBy: { deletedVersion: 'asc' },
          take: limit + 1,
        }),
      ]);

      const groups = [
        members,
        people,
        accounts,
        categories,
        tags,
        cards,
        entries,
        budgets,
        budgetOverrides,
        exchangeRates,
        assetValuations,
        installmentPlans,
      ];

      /*
       * 안전한 상한을 정한다.
       *
       * 상한을 넘긴 표에서 "담지 못한 첫 행"의 번호를 모아 그중 가장 작은 것을 찾고,
       * 그 앞 번호까지만 담는다. 넘긴 표가 없으면 처음 읽은 상한이 그대로 답이다.
       */
      let cutoff = ceiling;
      for (const rows of groups) {
        if (rows.length > limit) {
          cutoff = Math.min(cutoff, rows[limit].updatedVersion - 1);
        }
      }
      if (tombstones.length > limit) {
        cutoff = Math.min(cutoff, tombstones[limit].deletedVersion - 1);
      }
      const hasMore = cutoff < ceiling;

      const within = <T extends { updatedVersion: number }>(rows: T[]): T[] =>
        hasMore ? rows.filter((row) => row.updatedVersion <= cutoff) : rows.slice(0, limit);

      return {
        projectId,
        since,
        version: cutoff,
        hasMore,
        changes: {
          project: projectRow && projectRow.updatedVersion <= cutoff ? projectRow : null,
          members: within(members),
          people: within(people),
          accounts: within(accounts),
          categories: within(categories),
          tags: within(tags),
          cards: within(cards),
          // 조인 행을 id 목록으로 편다. 기기가 다루는 것은 연결이지 조인 행이 아니다.
          entries: within(entries).map(({ tags: entryTags, ...entry }) => ({
            ...entry,
            tagIds: entryTags.map((row) => row.tagId),
          })) as unknown as SyncDto.EntryRow[],
          budgets: within(budgets),
          budgetOverrides: within(budgetOverrides),
          exchangeRates: within(exchangeRates),
          assetValuations: within(assetValuations),
          installmentPlans: within(installmentPlans),
        },
        tombstones: (hasMore
          ? tombstones.filter((row) => row.deletedVersion <= cutoff)
          : tombstones.slice(0, limit)
        ).map((row) => ({
          entity: row.entity,
          entityId: row.entityId,
          deletedVersion: row.deletedVersion,
        })),
      };
    });
  }

  /** 바뀐 것이 없을 때. 기기는 번호만 갈아 끼우고 끝낸다. */
  private emptyResponse(projectId: string, since: number, version: number): SyncDto.PullResponse {
    return {
      projectId,
      since,
      version,
      hasMore: false,
      changes: {
        project: null,
        members: [],
        people: [],
        accounts: [],
        categories: [],
        tags: [],
        cards: [],
        entries: [],
        budgets: [],
        budgetOverrides: [],
        exchangeRates: [],
        assetValuations: [],
        installmentPlans: [],
      },
      tombstones: [],
    };
  }
}
