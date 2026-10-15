import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError, finalize } from 'rxjs/operators';
import { Request, Response } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const startTime = Date.now();

    /*
     * 실시간 연결(SSE)은 흐름이라 신호마다 이 줄을 지난다 -- 25초마다의 ping 까지 연결마다 한 줄씩 쌓였다
     * (2026-10-16). 연결이 끝날 때 한 번만 적는다.
     */
    if (request.path.endsWith('/sync/events')) {
      return next.handle().pipe(
        finalize(() => {
          this.logger.log(`${request.method} ${request.path} - 연결 끝 (${Date.now() - startTime}ms)`);
        }),
      );
    }

    return next.handle().pipe(
      tap(() => {
        const duration = Date.now() - startTime;
        this.logger.log(
          `${request.method} ${request.path} - ${response.statusCode} (${duration}ms)`
        );
      }),
      catchError((error: Error & { status?: number }) => {
        const duration = Date.now() - startTime;
        this.logger.error(
          `${request.method} ${request.path} - ${error.status || 500} (${duration}ms)`,
          error.stack
        );
        throw error;
      }),
    );
  }
}
