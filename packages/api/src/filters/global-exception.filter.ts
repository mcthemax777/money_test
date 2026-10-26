import { Catch, ExceptionFilter, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { ApiResponse } from '@money/types';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let message = '요청을 처리하지 못했습니다.';
    let details: unknown = undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const obj = exceptionResponse as Record<string, unknown>;
        errorCode = (obj.code || obj.error || 'HTTP_EXCEPTION') as string;
        message = (obj.message || message) as string;
        details = obj.details;
      } else {
        message = exceptionResponse as string;
      }
    }
    // HttpException이 아닌 오류는 메시지를 밖으로 내보내지 않는다.
    // Prisma는 실패한 쿼리와 컬럼 이름을 메시지에 담고, 그 밖의 오류도 파일
    // 경로나 접속 문자열을 흘린다. 진단에 필요한 내용은 아래 로그에만 남긴다.

    // 클라이언트가 재시도해도 소용없는 상황과 서버 오류를 구분할 수 있도록
    // 상관관계 ID를 함께 준다. 사용자가 이 값을 알려 주면 로그에서 찾는다.
    const traceId = randomUUID();

    const apiResponse: ApiResponse<null> = {
      success: false,
      error: {
        code: errorCode,
        message,
        details,
        traceId,
      },
      timestamp: new Date().toISOString(),
    };

    /*
     * 4xx 는 요청 쪽의 문제라 경고로만 남긴다 (2026-10-25). 예전에는 검색 로봇의 404(`/mcp`, `/status`)까지 전부
     * 오류로 오브젝트째 적어, 진짜 서버 오류가 묻히고 작은 디스크를 채웠다. 5xx 만 원인(exception)째 남긴다.
     */
    const summary = `Exception: ${errorCode} - ${traceId} - ${
      exception instanceof Error ? exception.message : message
    }`;
    if (statusCode < 500) {
      this.logger.warn(`${summary} (${request.method} ${request.path} ${statusCode})`);
    } else {
      this.logger.error(summary, {
        traceId,
        path: request.path,
        method: request.method,
        statusCode,
        exception,
      });
    }

    response.status(statusCode).json(apiResponse);
  }
}
