/**
 * 지출 분류를 이 파일의 목록으로 갈아끼운다.
 *
 * 기본 분류(가입할 때 만들어지는 것)는 예시일 뿐이라, 실제로 쓰려면 한 번은
 * 손으로 다시 짜야 한다. 화면에서 스무 개 넘는 분류를 하나씩 만드는 대신
 * 여기 적어 두고 한 번에 넣는다.
 *
 * 수입 분류는 건드리지 않는다. 아래 목록이 지출뿐이라, 함께 지우면 급여를
 * 다시 만들어야 한다.
 *
 *   PROJECT_ID=<id> npx ts-node -r tsconfig-paths/register \
 *     --project tsconfig.scripts.json scripts/seed-categories.ts
 *
 * 프로젝트가 하나뿐이면 PROJECT_ID 를 생략해도 된다.
 * 이미 그 분류를 쓴 거래가 있으면 멈춘다. 정말 지우려면 FORCE=1 을 준다.
 */

import { CategoryType, PrismaClient } from '@prisma/client';

/** 첫 항목이 대분류, 나머지가 그 아래 소분류다. 적은 순서가 화면 순서가 된다. */
const EXPENSE_TREE: string[][] = [
  ['식비', '식료품', '외식', '간식', '배달'],
  ['생활비', '생필품', '가구 및 주방용품', '소모품'],
  ['공과금', '전기세', '가스비', '수도비', '지방세', '집 관리비', '휴대폰비', '인터넷'],
  ['의료/건강', '병원', '약국', '기타'],
  ['쇼핑/미용', '옷', '잡화', '미용'],
  ['문화생활', '여행 경비', '운동'],
  ['교통', '주차비', '주유비', '정비', '대중교통'],
  ['경조사', '생일', '결혼식', '장례식', '집들이', '선물'],
  ['저축', '결혼식+신혼여행', '내 집 마련(청약)', '적금'],
  ['보험료', '교보생명', '메리츠', '롯데손해', '한화생명', 'KB손해', '기타'],
  ['기타', '월/연회비', '대출금상환', '보험료', '교육', '기부', '기타'],
  ['개인용돈', '김용찬', '강보민'],
];

async function main() {
  const prisma = new PrismaClient();

  try {
    const projectId = await resolveProjectId(prisma);
    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { name: true },
    });

    const existing = await prisma.category.findMany({
      where: { projectId, type: CategoryType.expense },
      select: { id: true, name: true },
    });

    /*
     * 쓰인 분류를 지우면 그 거래의 카테고리 다리가 함께 사라진다(posting 은 카테고리를
     * 참조한다). 거래가 있는 데이터베이스에서 이 스크립트를 도는 것은 사고에 가까우므로
     * 막는다. 새 환경을 세팅하는 중이라면 FORCE=1 로 넘긴다.
     */
    const usedCount = await prisma.posting.count({
      where: { categoryId: { in: existing.map((row) => row.id) } },
    });
    if (usedCount > 0 && process.env.FORCE !== '1') {
      throw new Error(
        `이미 이 분류를 쓴 거래가 ${usedCount}건 있습니다. ` +
          '지우면 그 거래의 분류가 함께 사라집니다. 정말 지우려면 FORCE=1 을 주세요.',
      );
    }

    console.log(`프로젝트: ${project.name} (${projectId})`);
    console.log(`기존 지출 분류 ${existing.length}개를 지우고 새로 만듭니다.`);

    await prisma.$transaction(async (tx) => {
      // 소분류부터 지운다. 부모를 먼저 지워도 cascade 로 따라 사라지지만,
      // 지운 개수를 로그에 정확히 남기려면 순서를 지키는 편이 낫다.
      await tx.category.deleteMany({
        where: { projectId, type: CategoryType.expense, parentId: { not: null } },
      });
      await tx.category.deleteMany({
        where: { projectId, type: CategoryType.expense, parentId: null },
      });

      // sortOrder 는 적은 순서 그대로다. 전부 0이면 목록이 이름순으로 보인다.
      let order = 0;
      for (const [parentName, ...childNames] of EXPENSE_TREE) {
        const parent = await tx.category.create({
          data: {
            projectId,
            name: parentName,
            type: CategoryType.expense,
            sortOrder: order,
          },
        });
        order += 1;

        for (const [index, childName] of childNames.entries()) {
          await tx.category.create({
            data: {
              projectId,
              name: childName,
              type: CategoryType.expense,
              parentId: parent.id,
              sortOrder: index,
            },
          });
        }
      }
    });

    const created = await prisma.category.count({
      where: { projectId, type: CategoryType.expense },
    });
    const roots = EXPENSE_TREE.length;
    console.log(`대분류 ${roots}개, 소분류 ${created - roots}개를 만들었습니다.`);
  } finally {
    await prisma.$disconnect();
  }
}

/** PROJECT_ID 가 있으면 그것을, 없으면 하나뿐인 프로젝트를 쓴다. */
async function resolveProjectId(prisma: PrismaClient): Promise<string> {
  const given = process.env.PROJECT_ID?.trim();
  if (given) return given;

  const projects = await prisma.project.findMany({ select: { id: true, name: true } });
  if (projects.length === 1) return projects[0].id;

  if (projects.length === 0) {
    throw new Error('프로젝트가 없습니다. 먼저 로그인해 프로젝트를 만드세요.');
  }
  throw new Error(
    '프로젝트가 여러 개입니다. PROJECT_ID 로 지정하세요:\n' +
      projects.map((p) => `  ${p.id}  ${p.name}`).join('\n'),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
