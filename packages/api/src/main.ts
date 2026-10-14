import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
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

  const config = new DocumentBuilder()
    .setTitle('bboyong API')
    .setDescription('가계부 앱 API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log(`📚 API Docs: http://localhost:${port}/api/docs`);
}

bootstrap().catch(err => {
  console.error('❌ Bootstrap error:', err);
  process.exit(1);
});
