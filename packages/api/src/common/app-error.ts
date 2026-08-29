import {
  BadRequestException,
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

export function forbidden(code: ErrorCode, message: string, details?: ErrorDetails) {
  return new ForbiddenException(payload(code, message, details));
}

export function unauthorized(code: ErrorCode, message: string, details?: ErrorDetails) {
  return new UnauthorizedException(payload(code, message, details));
}
