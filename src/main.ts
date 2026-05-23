import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '@/app.module';
import { HttpExceptionFilter, ResponseInterceptor } from '@/common';

async function bootstrap() {
  const apiPrefix = process.env.API_PREFIX ?? 'v1/matchchat';
  const docsPath = process.env.API_DOCS_PATH ?? 'v1/matchchat/docs';
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix(apiPrefix);
  const corsOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) =>
    origin.trim(),
  ) ?? ['*'];
  app.enableCors({ origin: corsOrigins, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle('BeeFriends - Match Chat Service')
    .setDescription('API documentation for BeeFriends Match Chat Service')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(docsPath, app, document);

  const port = process.env.PORT ?? 3003;
  await app.listen(port);

  console.log(`Match Chat Service running on http://localhost:${port}`);
  console.log(`API prefix          http://localhost:${port}/${apiPrefix}`);
  console.log(`Swagger docs        http://localhost:${port}/${docsPath}`);
}

void bootstrap();
