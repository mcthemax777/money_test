/**
 * 서버가 찍는 하이브리드 논리 시계.
 *
 * 웹에서 고친 것도 순서에 자리를 잡아야 한다. 시계를 비워 두면 비교 규칙에 따라
 * (`compareHlc`: 시계가 없는 쪽이 언제나 이르다) 그 편집이 가장 이른 것이 되어, 뒤에
 * 도착한 오프라인 명령이 **훨씬 전에 적은 것이라도** 병합에서 이긴다. 웹에서 방금 고친
 * 금액이 아무 말 없이 사라지는 자리다.
 *
 * 그래서 온라인 경로도 여기서 시계를 받는다. 그러면 오프라인 기기의 뒤늦은 편집은
 * 충돌로 갈리고, 사용자가 보류 칸에서 어느 값으로 할지 고른다 (설계 문서의 D6).
 *
 * 인스턴스마다 다른 이름을 쓴다. 같은 밀리초·같은 카운터가 겹쳐도 이름이 순서를 가르고,
 * 두 인스턴스가 같은 값을 내는 일이 없다.
 */
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { encodeHlc, hlcNext, type Hlc } from '@money/types';

@Injectable()
export class ServerClockService {
  private readonly node = `server-${randomUUID().slice(0, 8)}`;
  private last: Hlc | null = null;

  /**
   * 지금의 시계 값. 부를 때마다 반드시 앞엣것보다 뒤다.
   *
   * 같은 밀리초 안에서 여러 번 불려도 카운터가 올라가므로, 한 요청이 여러 전표를 고쳐도
   * 순서가 남는다.
   */
  now(): string {
    this.last = hlcNext(this.last, this.node);
    return encodeHlc(this.last);
  }
}
