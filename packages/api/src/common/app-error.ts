import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ErrorCode, ErrorDetails } from '@money/types';

/**
 * 화면이 자기 말로 다시 적을 수 있는 오류를 던진다.
 *
 * GlobalExceptionFilter가 응답 객체의 `code`·`message`·`details`를 그대로 실어
 * 보내므로, 예외에 그 모양을 담기만 하면 된다.
 *
 * `message`는 그대로 남긴다. 화면이 코드로 문구를 고르더라도 서버 로그와 다른
 * 클라이언트에는 읽을 수 있는 문장이 있어야 한다. 화면이 모르는 코드를 만났을 때
 * 마지막으로 기댈 곳이기도 하다.
 */
function payload(code: ErrorCode, message: string, details?: ErrorDetails) {
  return { code, message, details };
}

export function badRequest(code: ErrorCode, message: string, details?: ErrorDetails) {
  return new BadRequestException(payload(code, message, details));
}

export function notFound(code: ErrorCode, message: string, details?: ErrorDetails) {
  return new NotFoundException(payload(code, message, details));
}

/**
 * 요청 자체는 옳지만 지금 상태와 어긋난다. 다시 읽고 다시 하면 될 수 있다.
 *
 * 400 과 가르는 기준은 "다시 해 볼 여지가 있는가"다. 잘못 적은 금액은 다시 보내도
 * 같은 답이지만, 그 사이 남이 고친 거래는 최신 값을 받아 고치면 저장된다.
 */
export function conflict(code: ErrorCode, message: string, details?: ErrorDetails) {
  return new ConflictException(payload(code, message, details));
}

export function forbidden(code: ErrorCode, message: string, details?: ErrorDetails) {
  return new ForbiddenException(payload(code, message, details));
}

export function unauthorized(code: ErrorCode, message: string, details?: ErrorDetails) {
  return new UnauthorizedException(payload(code, message, details));
}
