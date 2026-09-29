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

  export interface AdminListQuery {
    /** 'waiting' 답을 기다리는 것만, 없으면 전부. */
    status?: InquiryStatus;
  }
}
