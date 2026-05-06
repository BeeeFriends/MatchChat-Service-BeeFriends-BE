import { Module } from '@nestjs/common';
import { MatchChatController } from './match-chat.controller';
import { MatchChatService } from './match-chat.service';

@Module({
  controllers: [MatchChatController],
  providers: [MatchChatService],
  exports: [MatchChatService],
})
export class MatchChatModule {}
