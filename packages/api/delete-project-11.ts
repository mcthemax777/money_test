import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Deleting project "11" and related data...');

  // "11" 프로젝트 찾기
  const project = await prisma.project.findFirst({
    where: { name: '11' },
  });

  if (!project) {
    console.log('Project "11" not found');
    return;
  }

  console.log(`Found project: ${project.id} - ${project.name}`);

  // 프로젝트 멤버 삭제
  await prisma.projectMember.deleteMany({
    where: { projectId: project.id },
  });
  console.log('✓ Deleted projectMembers');

  // 카테고리 삭제
  await prisma.category.deleteMany({
    where: { projectId: project.id },
  });
  console.log('✓ Deleted categories');

  // 거래내역 삭제
  await prisma.transaction.deleteMany({
    where: { projectId: project.id },
  });
  console.log('✓ Deleted transactions');

  // 카드 삭제
  await prisma.card.deleteMany({
    where: { account: { projectId: project.id } },
  });
  console.log('✓ Deleted cards');

  // 계좌 삭제
  await prisma.account.deleteMany({
    where: { projectId: project.id },
  });
  console.log('✓ Deleted accounts');

  // 사람 삭제
  await prisma.person.deleteMany({
    where: { projectId: project.id },
  });
  console.log('✓ Deleted people');

  // 프로젝트 삭제
  await prisma.project.delete({
    where: { id: project.id },
  });
  console.log('✓ Deleted project');

  console.log('\n✅ Project "11" completely deleted!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
