import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') ?? 3003;

  app.setGlobalPrefix('api/v1');
  app.enableCors();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BeeFriends Match & Chat Service')
    .setDescription('Template service for BeeFriends matching and chat flows.')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);
}

void bootstrap();
