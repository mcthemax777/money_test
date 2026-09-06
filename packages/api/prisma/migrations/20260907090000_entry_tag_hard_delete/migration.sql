-- 태그를 하드 삭제해도 그 태그가 붙어 있던 전표가 기기에 닿게 한다.
--
-- 무엇이 문제였나. `EntryTag` 에는 변경 번호가 없다. 태그 연결은 전표에 실려 움직이고,
-- 연결이 바뀌는 자리(전표 만들기·갈아 끼우기·태그 표시)에서 전표에 도장이 찍히기 때문이다.
-- 그런데 **태그 행 자체를 지우면** 연결만 cascade 로 사라지고 전표의 번호는 그대로다.
-- 그러면 그 전표를 이미 받아 둔 기기는 사라진 태그를 영영 달고 있는다. 오류도 나지 않는다.
--
-- 화면은 소프트 삭제(isActive=false)만 하므로 지금 이 길로 들어올 일은 없다. 남는 것은
-- 정리 스크립트와 손으로 고치는 SQL 인데, 그런 자리일수록 잊기 쉽다. 규칙을 표에 걸어 둔다
-- (도장을 트리거에 둔 것과 같은 이유다).
--
-- **평소의 태그 변경에는 아무 일도 하지 않는다.** 태그가 그대로 있으면 그냥 지나간다.
-- 전표 저장 한 번에 연결 수십 줄이 지워지는 자리(`saveTags`)가 있어, 여기서 무조건
-- 전표를 건드리면 그 비용이 매번 붙는다.
CREATE OR REPLACE FUNCTION sync_stamp_entry_of_dead_tag() RETURNS TRIGGER AS $$
BEGIN
  -- 태그가 아직 있으면 평범한 태그 변경이다. 그때는 전표에 이미 도장이 찍힌다.
  IF EXISTS (SELECT 1 FROM "Tag" WHERE id = OLD."tagId") THEN
    RETURN NULL;
  END IF;

  /*
   * 전표까지 함께 사라지는 중이면 남길 것이 없다.
   *
   * 프로젝트를 지우면 전표와 태그가 같은 문장에서 함께 사라지는데, 그때 없는 전표를
   * UPDATE 하면 아무 행도 맞지 않아 조용히 지나가기는 한다. 그래도 명시한다 --
   * 읽는 사람이 "여기서 무슨 일이 일어나는가"를 묻지 않게.
   */
  IF NOT EXISTS (SELECT 1 FROM "JournalEntry" WHERE id = OLD."entryId") THEN
    RETURN NULL;
  END IF;

  /*
   * `updatedAt` 만 건드린다. 번호는 그 행의 도장 트리거(sync_stamp)가 발급기를 거쳐
   * 찍는다 -- 여기서 손으로 넣으면 다른 쓰기와 순서가 어긋난다.
   *
   * 시계(updatedHlc)는 건드리지 않는다. 이것은 사람의 편집이 아니라 뒷정리라,
   * 시계를 올리면 그 사이 도착한 오프라인 편집이 진 것처럼 밀린다.
   */
  UPDATE "JournalEntry" SET "updatedAt" = now() WHERE id = OLD."entryId";
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_stamp_dead_tag AFTER DELETE ON "EntryTag"
  FOR EACH ROW EXECUTE FUNCTION sync_stamp_entry_of_dead_tag();
