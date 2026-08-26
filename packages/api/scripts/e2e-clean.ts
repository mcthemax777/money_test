/**
 * 브라우저 검증용 데이터 정리.
 *
 * `e2e-seed.ts`가 심은 것만 지운다. 범위를 지정하지 않는 삭제는 쓰지 않는다
 * (smoke-harness 주석 참고 - 예전에 개발 중이던 실제 데이터를 지운 적이 있다).
 */

import { PrismaClient } from '@prisma/client';
import { E2E_TAG } from './e2e-seed';

async function main() {
  const prisma = new PrismaClient();

  const projects = await prisma.project.findMany({
    where: { name: { startsWith: E2E_TAG } },
    select: { id: true, name: true },
  });
  const users = await prisma.user.findMany({
    where: { email: { startsWith: E2E_TAG } },
    select: { id: true, email: true },
  });

  // Project/User 삭제는 하위 데이터에 cascade가 걸려 있다 (schema.prisma).
  await prisma.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });

  console.log(`프로젝트 ${projects.length}개, 사용자 ${users.length}개를 지웠습니다.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
