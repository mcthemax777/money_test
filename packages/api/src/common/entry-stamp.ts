/**
 * 딸린 행만 바뀐 전표에 도장을 다시 찍는다.
 *
 * 기기는 전표를 `JournalEntry.updatedVersion` 으로만 받아 간다. 다리(Posting)와 태그
 * 연결(EntryTag)에는 변경 번호가 없어, 그것만 고치면 그 전표는 풀 피드에 실리지 않는다
 * -- 고친 기기 말고는 아무도 모른다. 분류·태그 통합처럼 딸린 행을 한꺼번에 옮기는
 * 자리는 여기를 거친다.
 *
 * `updatedAt` 만 건드린다. 번호는 그 행의 도장 트리거(sync_stamp)가 발급기를 거쳐
 * 찍는다 -- 손으로 넣으면 다른 쓰기와 순서가 어긋난다. 시계(`updatedHlc`)는 그대로
 * 둔다. 통합은 전표의 편집이 아니라 이름의 정리라, 그 전표에 걸린 오프라인 편집을
 * 이기거나 지게 할 까닭이 없다.
 */
import type { Prisma } from '@prisma/client';

export async function touchEntries(
  tx: Prisma.TransactionClient,
  entryIds: Iterable<string>,
): Promise<void> {
  const ids = [...new Set(entryIds)];
  if (ids.length === 0) return;
  await tx.journalEntry.updateMany({
    where: { id: { in: ids } },
    data: { updatedAt: new Date() },
  });
}
