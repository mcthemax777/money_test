import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { LoggingInterceptor } from './interceptors/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
