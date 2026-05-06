import { Module } from '@nestjs/common';
import { ChatModule } from './chat/chat.module';
import { PrismaModule } from './prisma.module';

@Module({
  imports: [PrismaModule, ChatModule],
})
export class AppModule {}