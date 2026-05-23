import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ChatModule } from '@/modules/match-chat/match-chat.module';
import { PrismaModule } from '@/prisma/prisma.module';

@Controller('health')
class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'match-chat-service',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
    };
  }
}

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ChatModule],
  controllers: [HealthController],
})
export class AppModule {}
