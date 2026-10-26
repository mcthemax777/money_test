import { CategoryType, Prisma } from '@prisma/client';
import { initialRanks } from '@money/types';

/**
 * 새 가계부에 처음 넣는 분류 (2026-10-25). 만든 사람의 화면 언어로 이름을 붙인다.
 *
 * 가입하면 서버가 가계부를 만들어 주던 때(f03ed0e 전)에는 그 자리에서 함께 만들었다. 그 걸음을 없애면서 분류도
 * 함께 빠져, 새 가계부의 첫 지출이 "분류를 고르세요"로 막혔다. 이제 가계부를 만드는 트랜잭션이 부른다
 * (`ProjectsService.createProject`). 이름은 만든 뒤 사용자가 고칠 수 있는 값이라 언어를 바꿔도 옮기지 않는다.
 */
const DEFAULT_NAMES: Record<string, { income: string[]; expense: string[] }> = {
  ko: {
    income: ['급여', '상여금', '이자/배당금', '기타수입'],
    expense: ['식료품', '외식', '교통', '통신', '공과금', '교육', '의료', '쇼핑', '엔터테인먼트', '저축'],
  },
  en: {
    income: ['Salary', 'Bonus', 'Interest/Dividends', 'Other income'],
    expense: ['Groceries', 'Dining out', 'Transport', 'Phone/Internet', 'Utilities', 'Education', 'Medical', 'Shopping', 'Entertainment', 'Savings'],
  },
  ja: {
    income: ['給与', '賞与', '利息/配当', 'その他収入'],
    expense: ['食料品', '外食', '交通', '通信', '光熱費', '教育', '医療', '買い物', '娯楽', '貯蓄'],
  },
};

type CategoryWriter = Pick<Prisma.TransactionClient, 'category'>;

/** 그 가계부에 기본 분류를 넣는다. 이미 같은 이름이 있으면 건너뛴다. 언어를 모르면 한국어다. */
export async function createDefaultCategories(db: CategoryWriter, projectId: string, locale = 'ko'): Promise<void> {
  const names = DEFAULT_NAMES[locale] ?? DEFAULT_NAMES.ko;
  // 선언한 순서를 그대로 순서 값에 담는다. 비워 두면 목록이 이름순으로 보이고, 나중에 추가한 분류(맨 뒤)와 자리가 어긋난다.
  const rows = [
    ...names.income.map((name) => ({ projectId, name, type: CategoryType.income })),
    ...names.expense.map((name) => ({ projectId, name, type: CategoryType.expense })),
  ];
  const ranks = initialRanks(rows.length);
  await db.category.createMany({
    data: rows.map((row, index) => ({ ...row, sortRank: ranks[index] })),
    skipDuplicates: true,
  });
}
