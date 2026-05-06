import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MatchChatModule } from './modules/match-chat/match-chat.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    MatchChatModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
