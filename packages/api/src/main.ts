import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE, isCookieMode, readCookie } from './common/session-cookies';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { LoggingInterceptor } from './interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  /*
   * 같은 기기의 nginx 가 넘겨준 사용자 주소(X-Forwarded-For)를 믿는다 (2026-10-16).
   *
   * 이것이 없으면 모든 요청의 주소가 nginx(127.0.0.1)라, 요청 제한(ThrottlerGuard 는 req.ip 로
   * 센다)이 사용자 전체에 한 통으로 걸렸다 -- 한 사람이 많이 부르거나 관리자 로그인을 몇 번 틀리면
   * 모두가 429 를 받았다. loopback 만 믿으므로 바깥에서 그 헤더를 지어 보내도 통하지 않는다.
   * nginx 가 헤더를 싣지 않으면 지금과 같다(127.0.0.1).
   */
  app.set('trust proxy', 'loopback');

  /*
   * CSRF 문 (2026-10-16). 웹은 토큰을 HttpOnly 쿠키로 들어(common/session-cookies), 브라우저가 쿠키를 저절로
   * 싣는다. 그래서 쿠키로 인증하는 쓰기 요청은 웹이 붙이는 머리글(X-Auth-Mode: cookie)이 있어야 받는다 --
   * 다른 사이트는 이 머리글을 붙여 보낼 수 없다(CORS 가 미리 묻기에서 막는다). 머리글 토큰(앱·관리 도구)은
   * 쿠키에 기대지 않으므로 상관없다.
   */
  app.use((req: Request, res: Response, next: NextFunction) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const usesCookie =
      !req.headers.authorization &&
      (readCookie(req, ACCESS_COOKIE) !== undefined || readCookie(req, REFRESH_COOKIE) !== undefined);
    if (unsafe && usesCookie && !isCookieMode(req)) {
      res.status(403).json({ error: { code: 'CSRF_REJECTED', message: '요청 출처를 확인할 수 없습니다.' } });
      return;
    }
    next();
  });

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || 'http://localhost:3000',
    credentials: true,
  });

  /*
   * whitelist를 켜지 않는다.
   *
   * DTO가 전부 인터페이스라 class-validator 메타데이터가 없다. 이 상태에서
   * whitelist를 켜면 "검증 규칙이 붙은 속성"이 하나도 없으므로 본문이 통째로
   * 비워져 모든 쓰기 엔드포인트가 망가진다.
   *
   * 그래서 낯선 키는 이 파이프가 걸러 주지 못한다. 서비스는 요청 본문을
   * Prisma에 스프레드로 넘기지 말고 허용 컬럼만 골라 담아야 한다.
   * 금액은 common/money.ts의 toMoney를 거친다.
   */
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // 응답에 서버 종류(Express)를 싣지 않는다. 알려 줄 이유가 없는 값이다.
  app.disable('x-powered-by');
  /*
   * 요청 본문 상한 (2026-10-25). 엑셀 가져오기 300줄과 동기화 묶음이 기본값(100KB)에 닿을 수 있어 넓힌다.
   * nginx 의 client_max_body_size 도 이 값 이상이어야 한다.
   */
  app.useBodyParser('json', { limit: '2mb' });

  const isProduction = process.env.NODE_ENV === 'production';
  // API 문서는 개발에서만 연다. 운영에서는 모든 경로와 본문 모양을 밖에 알려 줄 이유가 없다.
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('bboyong API')
      .setDescription('가계부 앱 API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }

  /*
   * 운영에서는 이 기계 안(nginx)에서만 받는다 (2026-10-25). 모든 주소로 열면 3001 번이 인터넷에 그대로 열려
   * nginx 의 TLS 와 상한을 건너뛰고 들어올 수 있었다. 다른 주소가 필요하면 HOST 로 준다.
   */
  const port = process.env.PORT || 3001;
  const host = process.env.HOST ?? (isProduction ? '127.0.0.1' : undefined);
  await (host ? app.listen(port, host) : app.listen(port));
  console.log(`✅ Server running on http://${host ?? 'localhost'}:${port}`);

  drainOnShutdown(app);
}

/**
 * 끝내라는 신호를 받으면 받던 요청을 마치고 나간다 (2026-10-16).
 *
 * 배포(`pm2 reload`)는 새 프로세스를 띄운 뒤 옛 프로세스에 SIGINT 를 보낸다. 아무것도 듣지 않으면 Node 는
 * 그 자리에서 끝나, 처리 중이던 요청이 끊기고 커밋하지 못한 트랜잭션이 되돌아간다. `/sync/push` 가 재생은
 * 커밋하고 결과 기록 전에 끊기면 그 명령이 "처리 중"으로 남았다가 60초 뒤 다시 재생된다.
 *
 * Nest 의 `enableShutdownHooks()` 만으로는 모자란다. 그쪽은 모듈 정리(onModuleDestroy -- DB 연결 끊기)를
 * HTTP 서버를 닫기 **전에** 부르므로, 받던 요청이 DB 를 잃는다. 그래서 순서를 직접 세운다:
 *
 *   1. 새 연결을 받지 않는다 (`server.close`). 쉬는 keep-alive 연결도 닫는다.
 *   2. 받던 요청이 끝나기를 기다린다. 실시간 신호(SSE)처럼 끝나지 않는 연결이 있으므로 오래 기다리지 않는다
 *      -- pm2 의 `kill_timeout`(5초) 안이어야 한다.
 *   3. 모듈을 정리하고(DB·레디스) 나간다.
 */
const DRAIN_TIMEOUT_MS = 3_500;

function drainOnShutdown(app: NestExpressApplication): void {
  let closing = false;

  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`🛑 ${signal} -- 받던 요청을 마치고 끝냅니다`);

    const server = app.getHttpServer() as import('http').Server;
    const drained = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections?.();

    await Promise.race([drained, new Promise((resolve) => setTimeout(resolve, DRAIN_TIMEOUT_MS))]);

    try {
      await app.close();
    } catch (error) {
      console.error('❌ Shutdown error:', error);
    }
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch(err => {
  console.error('❌ Bootstrap error:', err);
  process.exit(1);
});
