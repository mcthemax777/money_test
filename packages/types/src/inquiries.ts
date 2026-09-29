/**
 * 문의하기. 사용자가 설정에서 관리자에게 글을 보내고, 관리자가 관리 도구에서 답한다.
 *
 * 문의 하나가 한 줄기 대화다. 사용자는 같은 줄기에 덧붙여 물을 수 있고, 관리자의 답이
 * 오면 그 사용자의 기기로 푸시가 가고 설정의 "문의하기" 칸에 읽지 않은 답의 수가 뜬다.
 *
 * 기기 사본에 두지 않는다(반복 등록처럼 서버에서 곧바로 읽고 쓴다). 연결이 없으면 보내지 못한다.
 */

/** 한 글의 글자 수 상한. */
export const INQUIRY_BODY_MAX = 5000;

/**
 * 문의 목록이나 대화를 띄워 둔 동안 새 답을 묻는 간격(ms). 웹과 앱이 같은 값을 쓴다.
 *
 * 서버는 이 간격으로 오는 조회를 "사용자가 지금 보고 있다"는 표시로 읽고, 그동안에는
 * 답장 푸시를 보내지 않는다(`INQUIRY_WATCH_MS`). 보는 화면에 답이 곧바로 서는데 같은
 * 답이 알림으로 또 울리면 안 되어서다.
 */
export const INQUIRY_POLL_MS = 3000;

/**
 * 마지막 조회가 이만큼 안이면 보고 있는 것으로 친다. 조회 세 번 몫이다 -- 한두 번은
 * 느린 망에서 늦을 수 있어, 한 번 늦었다고 보는 사람에게 푸시가 가지 않게 한다.
 */
export const INQUIRY_WATCH_MS = INQUIRY_POLL_MS * 3 + 1000;

/** 누가 쓴 글인가. */
export type InquiryAuthor = 'user' | 'admin';

/** 마지막 글이 사용자 것이면 답을 기다리는 중, 관리자 것이면 답한 것이다. */
export type InquiryStatus = 'waiting' | 'answered';

export namespace InquiryDto {
  export interface Message {
    id: string;
    author: InquiryAuthor;
    body: string;
    createdAt: string;
  }

  export interface Summary {
    id: string;
    /** 첫 글의 앞부분. 목록의 제목 자리다. */
    preview: string;
    status: InquiryStatus;
    lastMessageAt: string;
    createdAt: string;
    /** 사용자가 아직 읽지 않은 관리자의 답 수. */
    unreadCount: number;
  }

  export interface Detail extends Summary {
    messages: Message[];
  }

  export interface CreateRequest {
    body: string;
  }

  export interface MessageRequest {
    body: string;
  }

  export interface UnreadResponse {
    count: number;
  }

  /** 관리 도구가 보는 문의. 누가 어느 판에서 보냈는지 함께 본다. */
  export interface AdminSummary extends Omit<Summary, 'unreadCount'> {
    userName: string;
    userEmail: string;
    platform: string | null;
    appVersion: string | null;
    messageCount: number;
  }

  export interface AdminDetail extends AdminSummary {
    messages: Message[];
  }

  /** 관리자가 먼저 보낼 사람을 찾을 때 한 줄. */
  export interface AdminUser {
    id: string;
    name: string;
    email: string;
  }

  /**
   * 관리자가 먼저 여는 대화. 사용자가 묻지 않았어도 보낼 수 있다 (공지·확인 요청).
   * 사용자의 문의하기 목록에 새 대화로 서고, 읽지 않은 글 하나로 세어진다.
   */
  export interface AdminStartRequest {
    userId: string;
    body: string;
  }

  export interface AdminListQuery {
    /** 'waiting' 답을 기다리는 것만, 없으면 전부. */
    status?: InquiryStatus;
  }
}
