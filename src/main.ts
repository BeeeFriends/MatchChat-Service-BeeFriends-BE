import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for WebSocket connections
  app.enableCors();

  // Global validation pipes
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('Chat Service API')
    .setDescription('BeeFriends Chat Microservice API')
    .setVersion('1.0')
    .addTag('messages', 'Message operations')
    .addTag('conversations', 'Conversation operations')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(3002);
  console.log('🚀 Chat Service running on: http://localhost:3002');
  console.log('📚 Swagger docs available at: http://localhost:3002/api');
}

bootstrap();