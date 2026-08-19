import { Prisma, PrismaClient } from '@prisma/client';

/**
 * 스모크 테스트 공용 뼈대.
 *
 * 이 파일이 존재하는 이유는 정리(cleanup) 때문이다.
 * 예전에는 스크립트마다 성공 경로에서만 정리했고, 실패하면 찌꺼기가 남았다.
 * 그 찌꺼기를 치우려고 `DELETE FROM "User"` 같은 전체 삭제를 손으로 돌리다가
 * 개발 중이던 실제 데이터까지 지웠다.
 *
 * 그래서 여기서 두 가지를 강제한다.
 *   1. 테스트가 만든 Project/User의 id를 추적해 그것만 지운다.
 *   2. 성공하든 실패하든 finally에서 반드시 지운다.
 * 범위를 지정하지 않는 삭제는 이 파일 어디에도 없어야 한다.
 */

export interface SmokeContext {
  prisma: PrismaClient;
  /** 기대값과 다르면 실패로 기록한다. 예외를 던지지 않아 나머지 검사도 계속 돈다. */
  check(label: string, actual: unknown, expected: unknown): void;
  /** 거부되어야 하는 호출. 통과하면 실패로 기록한다. */
  expectReject(label: string, fn: () => Promise<unknown>): Promise<void>;
  /** 정리 대상으로 등록되는 프로젝트 생성 */
  createProject(data?: Partial<Prisma.ProjectCreateInput>): Promise<{ id: string }>;
  /** 정리 대상으로 등록되는 사용자 생성 */
  createUser(data?: Partial<Prisma.UserCreateInput>): Promise<{ id: string; email: string }>;
}

export async function runSmoke(name: string, body: (ctx: SmokeContext) => Promise<void>) {
  const prisma = new PrismaClient();
  const projectIds: string[] = [];
  const userIds: string[] = [];
  let failures = 0;
  let crashed = false;

  const ctx: SmokeContext = {
    prisma,
    check(label, actual, expected) {
      const ok = String(actual) === String(expected);
      if (!ok) failures += 1;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  (기대 ${expected}, 실제 ${actual})`);
    },
    async expectReject(label, fn) {
      try {
        await fn();
        failures += 1;
        console.log(`FAIL  ${label}  (기대 거부, 실제 통과됨)`);
      } catch {
        console.log(`PASS  ${label} (거부됨)`);
      }
    },
    async createProject(data = {}) {
      const project = await prisma.project.create({
        data: { name: `${name} 스모크`, ...data } as Prisma.ProjectCreateInput,
      });
      projectIds.push(project.id);
      return project;
    },
    async createUser(data = {}) {
      // 같은 스크립트를 여러 번 돌려도 unique 제약에 걸리지 않도록 id를 섞는다
      const suffix = `${name}-${userIds.length}-${process.pid}`;
      const user = await prisma.user.create({
        data: {
          email: `smoke-${suffix}@example.invalid`,
          googleId: `smoke-${suffix}`,
          name: `스모크 ${suffix}`,
          ...data,
        } as Prisma.UserCreateInput,
      });
      userIds.push(user.id);
      return user;
    },
  };

  try {
    await body(ctx);
  } catch (error) {
    crashed = true;
    console.error(error);
  } finally {
    // 만든 것만, 반드시 지운다. 범위 없는 삭제는 하지 않는다.
    await cleanup(prisma, projectIds, userIds);
    await prisma.$disconnect();
  }

  if (crashed) {
    console.log('\n실행 중 오류');
  } else {
    console.log(failures === 0 ? '\n전체 통과' : `\n실패 ${failures}건`);
  }
  process.exit(crashed || failures > 0 ? 1 : 0);
}

async function cleanup(prisma: PrismaClient, projectIds: string[], userIds: string[]) {
  try {
    if (projectIds.length > 0) {
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    if (userIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  } catch (error) {
    // 정리 실패는 남은 id를 알려주고 넘어간다. 여기서 범위를 넓히지 않는다.
    console.error('정리 실패. 아래 id가 남아 있을 수 있습니다:', { projectIds, userIds }, error);
  }
}
