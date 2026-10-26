/**
 * 기기가 보낸 명령을 재생하는 곳.
 *
 * **온라인 요청과 똑같은 도메인 서비스로 흘려보낸다**(설계 문서의 D3). 행을 그대로 밀어
 * 넣으면 전표의 균형 검증과 잔액 반영을 우회하는데, 그 두 가지가 이 가계부에서 조용히
 * 틀리는 자리다. 그래서 여기서는 명령을 EntriesService 가 받는 모양으로 되돌릴 뿐
 * 새 쓰기 경로를 만들지 않는다.
 *
 * 세 가지가 이 파일의 책임이다.
 *
 *   1. **멱등.** 같은 명령이 두 번 와도 한 번만 적힌다. 응답을 못 받은 기기는 반드시
 *      다시 보내고, 그때 서버가 적용했는지 기기는 알 수 없다.
 *      멱등은 **행을 먼저 잡는 방식**으로 지킨다. 조회한 뒤 재생하고 마지막에 기록하면,
 *      같은 명령이 동시에 두 번 도착했을 때 둘 다 "본 적 없다"로 읽는다. 인스턴스가
 *      하나일 때도 가능한 일이고 여럿이면 흔해진다.
 *   2. **순서.** 한 기기의 명령은 clientSeq 순서로만 적용한다.
 *   3. **의존.** 어떤 명령이 거절되면 **그 대상을 건드리는 뒤 명령만** 함께 보류한다.
 *      전표를 만든 명령이 거절되었는데 그것을 고치는 명령이 뒤따라 적용되면, 없는
 *      전표를 고치려다 실패하거나 더 나쁘게는 다른 전표에 적용된다.
 *
 * 이 파일에는 입구(push)와 한 건의 판정(applyOne)과 갈래 나누기만 있다. 명령 로그는
 * mutation-claim.ts, 갈래별 재생은 entry-/asset-/catalog-/settings-mutations.ts 에 있다
 * (2026-10-26 나눔).
 */
import { ForbiddenException, HttpException, Injectable, Logger } from '@nestjs/common';
import { isPrismaError, isTransientDbError } from '@/common/prisma-error';
import {
  type Mutation,
  type MutationResult,
  type PushRequest,
  type PushResponse,
  isBlockedBy,
} from '@money/types';

import { PrismaService } from '@/config/prisma.service';
import { ProjectAccessService } from '@/common/project-access.guard';
import { LedgerService } from '../ledger/ledger.service';
import { EntriesService } from '../entries/entries.service';
import { PeopleService } from '../people/people.service';
import { AccountsService } from '../accounts/accounts.service';
import { CardsService } from '../cards/cards.service';
import { CardLedgerService } from '../cards/card-ledger.service';
import { CategoriesService } from '../categories/categories.service';
import { TagsService } from '../tags/tags.service';
import { BudgetsService } from '../budgets/budgets.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ProjectsService } from '../projects/projects.service';
import { RecurringService } from '../entry-drafts/recurring.service';
import { MutationClaims } from './mutation-claim';
import { isWellFormedMutation, payloadForLog, withAliases, withSaneClock } from './mutation-shape';
import { EntryMutations } from './entry-mutations';
import { AssetMutations } from './asset-mutations';
import { CatalogMutations } from './catalog-mutations';
import { SettingsMutations } from './settings-mutations';

/** 한 번에 받는 명령 수. 일주일치를 한 요청에 밀면 끊긴다. */
const MAX_MUTATIONS = 200;

@Injectable()
export class MutationReplayService {
  private readonly logger = new Logger(MutationReplayService.name);
  /*
   * 갈래별 재생은 Nest 공급자가 아니라 여기서 만든다 (2026-10-26). 스모크가 이 서비스를 생성자
   * 인자 순서대로 직접 만들므로, 생성자 모양을 그대로 두고 안에서 나눠 준다.
   */
  private readonly claims: MutationClaims;
  private readonly entryMutations: EntryMutations;
  private readonly assetMutations: AssetMutations;
  private readonly catalogMutations: CatalogMutations;
  private readonly settingsMutations: SettingsMutations;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    ledger: LedgerService,
    entries: EntriesService,
    people: PeopleService,
    accounts: AccountsService,
    cards: CardsService,
    cardLedger: CardLedgerService,
    categories: CategoriesService,
    tags: TagsService,
    budgets: BudgetsService,
    exchangeRates: ExchangeRatesService,
    projects: ProjectsService,
    recurring: RecurringService,
  ) {
    this.claims = new MutationClaims(prisma, this.logger);
    this.entryMutations = new EntryMutations(prisma, ledger, entries, cardLedger);
    this.assetMutations = new AssetMutations(prisma, projectAccess, ledger, people, accounts, cards);
    this.catalogMutations = new CatalogMutations(prisma, categories, tags);
    this.settingsMutations = new SettingsMutations(
      prisma,
      projectAccess,
      budgets,
      exchangeRates,
      projects,
      recurring,
    );
  }

  async push(
    userId: string,
    request: PushRequest,
    projectIdParam?: string,
  ): Promise<PushResponse> {
    /*
     * 권한은 재생 시점에 다시 본다 (D10).
     *
     * editor 였을 때 큐에 넣은 명령이 viewer 로 바뀐 뒤 도착할 수 있다. 그때는 명령마다
     * 거절로 돌려주고, 기기가 그것을 보류 칸에 남겨 사용자에게 알린다.
     *
     * **요청 통째로 403 을 던지면 안 된다** (2026-10-16). 기기는 밀어 올리기가 실패하면
     * 받기 전에 멈추므로, 강등된 기기는 큐가 비지 않는 한 영영 새 변경을 받지 못한다.
     * 구성원이 아닌 경우만 그대로 던진다 -- 기기가 그 코드로 사본을 정리한다.
     */
    const projectId = await this.projectAccess.resolveAndVerifyProjectId(
      userId,
      projectIdParam || request.projectId,
      'viewer',
    );

    /*
     * 모양이 틀린 명령은 그것만 거절하고 나머지는 재생한다 (2026-10-16).
     *
     * 예전에는 targets·hlc·clientSeq 가 비거나 틀린 명령 하나가 재생 밖(정렬·막힘 판정)에서 터져 요청 전체가
     * 500 이 됐고, 기기는 같은 묶음을 영영 다시 보내며 받기까지 멈췄다. 거절로 돌려주면 보류 칸에 남아 사람이 고른다.
     */
    const received: unknown[] = Array.isArray(request?.mutations) ? request.mutations : [];
    const malformed = received
      .filter((mutation) => !isWellFormedMutation(mutation))
      .map((mutation) => (mutation as { mutationId?: unknown })?.mutationId)
      .filter((id): id is string => typeof id === 'string');
    const mutations = (received.filter(isWellFormedMutation) as Mutation[])
      .slice(0, MAX_MUTATIONS)
      // 한 기기가 보낸 명령은 언제나 이 순서로 적용한다.
      .sort((a, b) => a.clientSeq - b.clientSeq);

    // 구성원인 것은 위에서 확인했다. 여기서 막히면 역할이 모자란 것이다.
    const canWrite = await this.projectAccess
      .verifyUserHasAccessToProject(userId, projectId, 'editor')
      .then(
        () => true,
        (error: unknown) => {
          if (error instanceof ForbiddenException) return false;
          throw error;
        },
      );
    const malformedResults: MutationResult[] = malformed.map((mutationId) => ({
      mutationId,
      status: 'rejected' as const,
      code: 'MUTATION_MALFORMED',
      error: '명령의 모양이 올바르지 않습니다.',
    }));

    if (!canWrite) {
      const project = await this.prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { syncVersion: true },
      });
      return {
        // 모양이 어긋난 명령의 결과도 함께 돌려준다. 빠뜨리면 그 행들은 이 응답에서 답을 받지 못했다.
        results: [
          ...malformedResults,
          ...mutations.map((mutation) => ({
            mutationId: mutation.mutationId,
            status: 'rejected' as const,
            code: 'PROJECT_ROLE_VIEWER',
            error: '읽기 권한으로 바뀌어 이 변경을 올릴 수 없습니다.',
          })),
        ],
        version: project.syncVersion,
      };
    }

    const results: MutationResult[] = [...malformedResults];
    /** 앞에서 거절된 대상. 이것을 건드리는 뒤 명령은 서버까지 가지 않는다. */
    const blocked = new Set<string>();
    /**
     * 앞에서 판정이 나지 않은 대상.
     *
     * 거절과 갈라 두는 이유는 사용자에게 보일 것이 다르기 때문이다. 거절된 대상을
     * 건드리는 명령은 보류 칸으로 올려 사람이 고르게 하고, 판정이 나지 않은 대상은
     * 큐에 그대로 두어 다음 동기화가 다시 보내게 한다.
     */
    const deferred = new Set<string>();
    /**
     * 이 요청 안에서 생긴 별칭 (기기 id -> 서버가 채택한 id).
     *
     * 두 기기가 끊긴 채 같은 이름의 분류를 만들면 서버는 먼저 선 것을 채택하고 별칭을 돌려준다. 기기는 그것으로
     * 큐에 남은 명령을 고치지만, **같은 묶음에 이미 실려 온** 뒤 명령은 옛 id 를 든 채 재생되어 "없는 분류"로
     * 거절되고 보류 칸에 갇혔다 (2026-10-16). 그래서 이 묶음의 뒤 명령에도 여기서 바로 갈아 끼운다.
     */
    const aliases = new Map<string, string>();

    for (const original of mutations) {
      const mutation = aliases.size > 0 ? withAliases(original, aliases) : original;
      if (isBlockedBy(mutation, deferred)) {
        results.push({
          mutationId: mutation.mutationId,
          status: 'deferred',
          error: '앞선 명령의 결과를 아직 알 수 없어 함께 미뤘습니다.',
        });
        mutation.targets.forEach((target) => deferred.add(target));
        continue;
      }

      if (isBlockedBy(mutation, blocked)) {
        results.push({
          mutationId: mutation.mutationId,
          status: 'blocked',
          error: '앞선 명령이 처리되지 않아 함께 미뤘습니다.',
        });
        mutation.targets.forEach((target) => blocked.add(target));
        continue;
      }

      const result = await this.applyOne(userId, projectId, request.clientId, mutation);
      results.push(result);
      if (result.alias) aliases.set(result.alias.from, result.alias.to);

      /*
       * 거절만 뒤를 막는다. 충돌은 막지 않는다.
       *
       * 충돌은 "대상이 있는데 더 늦은 편집이 이겼다"는 뜻이라 뒤 명령이 가리킬 전표가
       * 그대로 있다. 오히려 뒤 명령은 그 늦은 편집보다 더 늦은 시계를 달고 있어 이길 수
       * 있다. 여기서 막으면 사용자의 가장 최근 편집이 사라진다.
       */
      if (result.status === 'rejected') {
        mutation.targets.forEach((target) => blocked.add(target));
      }

      // 다른 요청이 재생 중이면 이 전표의 지금 상태를 알 수 없다. 뒤 명령도 미룬다.
      if (result.status === 'deferred') {
        mutation.targets.forEach((target) => deferred.add(target));
      }
    }

    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { syncVersion: true },
    });

    return { results, version: project.syncVersion };
  }

  /**
   * 명령 하나를 각자의 트랜잭션에서 적용한다.
   *
   * 한 건이 거절되어도 뒤의 명령이 막히지 않게 하려면 트랜잭션을 함께 쓸 수 없다.
   * 하나로 묶으면 마지막 한 건의 실패가 앞의 성공까지 되돌린다.
   */
  private async applyOne(
    userId: string,
    projectId: string,
    clientId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    mutation = withSaneClock(mutation);
    const claim = await this.claims.claim(userId, projectId, clientId, mutation);

    if (claim.kind === 'settled') return claim.result;

    if (claim.kind === 'running') {
      /*
       * 다른 요청이 같은 명령을 재생하는 중이다.
       *
       * 기기가 응답을 못 받아 다시 보냈고, 두 요청이 서로 다른 인스턴스에 닿은 경우다.
       * 여기서 답할 수 있는 것이 없다 -- 적용이라고 하면 실패한 명령이 조용히 사라지고,
       * 거절이라고 하면 성공한 명령이 보류 칸에 뜬다. 판정을 미루고 다음 동기화에
       * 다시 묻게 한다. 그때는 저 요청이 남긴 결과가 있다.
       */
      return {
        mutationId: mutation.mutationId,
        status: 'deferred',
        error: '같은 명령을 이미 처리하고 있습니다.',
      };
    }

    if (claim.kind === 'seqTaken') {
      /*
       * (기기, 순번)이 이미 다른 명령의 것이다.
       *
       * 기기가 번호를 다시 썼다는 뜻이라 정상 경로에는 없다. 그냥 적용하면 결과를
       * 기록할 자리가 없어 멱등이 깨진다 -- 다시 보낼 때마다 또 적힌다. 그래서
       * 적용하지 않고 이유를 달아 돌려준다.
       */
      this.logger.warn(
        `순번 충돌 ${mutation.mutationId} (clientId ${clientId}, clientSeq ${mutation.clientSeq})`,
      );

      /*
       * 어긋난 정도를 함께 알려 준다.
       *
       * 이 기기가 뒤로 물러난 번호를 쓰고 있다는 뜻이므로, 다음 번호가 무엇인지 아는 것은
       * 서버뿐이다. 알려 주지 않으면 기기는 1씩 올려 보며 부딪히는 수밖에 없고, 그동안
       * 그 기기의 모든 변경이 조용히 서버에 닿지 않는다.
       */
      const last = await this.claims.lastClientSeq(userId, clientId);

      return {
        mutationId: mutation.mutationId,
        status: 'rejected',
        code: 'CLIENT_SEQ_TAKEN',
        error: '같은 순번을 다른 명령이 이미 썼습니다.',
        lastClientSeq: last ?? mutation.clientSeq,
      };
    }

    try {
      const result = await this.replay(userId, projectId, mutation);
      await this.claims.settle(mutation, result);
      return result;
    } catch (error) {
      /*
       * 데이터베이스가 잠시 앓은 것(연결 끊김·시간 초과·쓰기 충돌)은 판정이 아니다 (2026-10-16). 예전에는 그것도
       * 영구 거절로 적어, 다시 보내면 될 명령이 보류 칸에 갇혔다. 잡은 행을 놓고 "미룸"으로 돌려준다 -- 기기가
       * 다음 동기화에 다시 보내면 처음처럼 재생한다.
       */
      if (isTransientDbError(error)) {
        this.logger.warn(
          `명령 재생 일시 실패 ${mutation.kind} ${mutation.mutationId}: ${
            error instanceof Error ? error.message : error
          }`,
        );
        await this.claims.release(mutation.mutationId);
        return {
          mutationId: mutation.mutationId,
          status: 'deferred',
          error: '서버가 잠시 바빠 다음에 다시 보냅니다.',
        };
      }

      const message = error instanceof Error ? error.message : '알 수 없는 오류';
      /*
       * 코드는 두 군데에 산다. 원장 조립의 오류(LedgerBuildError)는 객체에, 서비스가 던지는
       * `badRequest(code, ...)` 는 HTTP 응답 본문에 있다. 뒤쪽을 읽지 않으면 기기가 코드를 받지
       * 못해 보류 칸에 사람이 고른 언어 대신 서버의 원문이 선다.
       */
      const body = error instanceof HttpException ? error.getResponse() : undefined;
      const code =
        (error as { code?: unknown })?.code ??
        (body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined);

      /*
       * 기기에 돌려줄 문장. 규칙이 거절한 것(HTTP 예외·코드가 붙은 원장 오류)만 그 문장을 보낸다.
       * 그 밖(DB 오류 따위)의 원문은 서버 내부가 드러나므로 로그에만 남긴다 (2026-10-16).
       */
      // Prisma 오류도 문자열 코드(P2003 따위)를 달고 오지만 규칙의 거절이 아니다. 원문에 질의가 실려 있다.
      const isDbError = isPrismaError(error);
      const isRuleError = !isDbError && (error instanceof HttpException || typeof code === 'string');
      const result: MutationResult = {
        mutationId: mutation.mutationId,
        status: 'rejected',
        error: isRuleError ? message : '서버가 이 변경을 처리하지 못했습니다.',
        ...(typeof code === 'string' && !isDbError ? { code } : {}),
      };
      await this.claims.settle(mutation, result);
      /*
       * 보낸 값을 함께 남긴다. 기기의 "보내지 못한 거래"에도 같은 값이 보이지만, 그 기기를
       * 손에 쥘 수 없을 때 무엇이 규칙에 걸렸는지 찾을 곳이 여기뿐이다. 길면 자른다.
       */
      this.logger.warn(
        `명령 거절 ${mutation.kind} ${mutation.mutationId} (clientSeq ${mutation.clientSeq}): ${message} ` +
          `payload=${payloadForLog(mutation.payload)}`,
      );
      return result;
    }
  }

  /** 명령의 갈래를 골라 재생한다. 모르는 갈래는 거절이다. */
  private async replay(
    userId: string,
    projectId: string,
    mutation: Mutation,
  ): Promise<MutationResult> {
    const entry = this.entryMutations;
    const asset = this.assetMutations;
    const catalog = this.catalogMutations;
    const settings = this.settingsMutations;
    switch (mutation.kind) {
      case 'entry.create':
        return entry.createEntry(userId, projectId, mutation);
      case 'entry.replace':
        return entry.replaceEntry(userId, projectId, mutation);
      case 'entry.delete':
        return entry.deleteEntry(userId, projectId, mutation);
      case 'entry.tags':
        return entry.changeEntryTags(userId, projectId, mutation);
      case 'entry.category':
        return entry.changeEntryCategory(userId, projectId, mutation);
      case 'entry.restate':
        return entry.restateEntries(userId, projectId, mutation);
      case 'person.create':
        return asset.createPerson(userId, projectId, mutation);
      case 'person.update':
        return asset.updatePerson(userId, projectId, mutation);
      case 'account.create':
        return asset.createAccount(userId, projectId, mutation);
      case 'account.update':
        return asset.updateAccount(userId, projectId, mutation);
      case 'card.create':
        return asset.createCard(userId, projectId, mutation);
      case 'card.update':
        return asset.updateCard(userId, projectId, mutation);
      case 'person.delete':
        return asset.deleteAsset('person', userId, projectId, mutation);
      case 'account.delete':
        return asset.deleteAsset('account', userId, projectId, mutation);
      case 'card.delete':
        return asset.deleteAsset('card', userId, projectId, mutation);
      case 'account.balance':
        return asset.setAccountBalance(userId, projectId, mutation);
      case 'category.create':
        return catalog.createCategory(userId, projectId, mutation);
      case 'category.update':
        return catalog.updateCategory(userId, projectId, mutation);
      case 'category.merge':
        return catalog.mergeCategories(userId, projectId, mutation);
      case 'tag.create':
        return catalog.createTag(userId, projectId, mutation);
      case 'tag.update':
        return catalog.updateTag(userId, projectId, mutation);
      case 'tag.merge':
        return catalog.mergeTags(userId, projectId, mutation);
      case 'budget.set':
        return settings.setBudget(userId, projectId, mutation);
      case 'budget.delete':
        return settings.deleteBudget(userId, projectId, mutation);
      case 'budget.setFrom':
        return settings.setBudgetFrom(userId, projectId, mutation);
      case 'budget.override':
        return settings.setOverride(userId, projectId, mutation);
      case 'exchangeRate.set':
        return settings.setExchangeRate(projectId, mutation);
      case 'exchangeRate.clear':
        return settings.clearExchangeRate(projectId, mutation);
      case 'project.update':
        return settings.updateProject(userId, projectId, mutation);
      case 'recurring.create':
        return settings.createRecurring(userId, projectId, mutation);
      case 'recurring.update':
        return settings.updateRecurring(userId, projectId, mutation);
      case 'recurring.delete':
        return settings.deleteRecurring(userId, projectId, mutation);
      default:
        return {
          mutationId: mutation.mutationId,
          status: 'rejected',
          error: `알 수 없는 명령입니다: ${mutation.kind}`,
        };
    }
  }
}
