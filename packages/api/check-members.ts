import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // test123@naver.com의 프로젝트 멤버십
  const naver = await prisma.user.findUnique({
    where: { email: 'test123@naver.com' },
    select: { id: true },
  });

  const mcthemax = await prisma.user.findUnique({
    where: { email: 'mcthemax777@gmail.com' },
    select: { id: true },
  });

  console.log('\n=== User IDs ===');
  console.log('test123@naver.com:', naver?.id);
  console.log('mcthemax777@gmail.com:', mcthemax?.id);

  if (naver) {
    console.log('\n=== test123@naver.com의 프로젝트 멤버십 ===');
    const members = await prisma.projectMember.findMany({
      where: { userId: naver.id },
      include: { project: true },
    });
    members.forEach((m: any) => {
      console.log(`- ${m.project.name} (${m.projectId})`);
    });
  }

  if (mcthemax) {
    console.log('\n=== mcthemax777@gmail.com의 프로젝트 멤버십 ===');
    const members = await prisma.projectMember.findMany({
      where: { userId: mcthemax.id },
      include: { project: true },
    });
    members.forEach((m: any) => {
      console.log(`- ${m.project.name} (${m.projectId})`);
    });
  }

  // "11" 프로젝트의 모든 멤버
  console.log('\n=== "11" 프로젝트의 모든 멤버 ===');
  const project11 = await prisma.project.findFirst({
    where: { name: '11' },
  });

  if (project11) {
    const allMembers = await prisma.projectMember.findMany({
      where: { projectId: project11.id },
      include: { user: true },
    });
    allMembers.forEach((m: any) => {
      console.log(`- ${m.user.email} (${m.role})`);
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
