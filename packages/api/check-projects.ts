import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const projects = await prisma.project.findMany({
    include: {
      members: {
        include: {
          user: {
            select: {
              email: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log('Total projects:', projects.length);
  console.log('\nProjects:');
  projects.forEach((p: any) => {
    console.log(`- ID: ${p.id}, Name: ${p.name}`);
    p.members.forEach((m: any) => {
      console.log(`  └─ User: ${m.user.email} (${m.role})`);
    });
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
