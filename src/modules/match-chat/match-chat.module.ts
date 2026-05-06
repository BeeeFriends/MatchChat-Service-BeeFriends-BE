import { Module } from '@nestjs/common';
import { ChatController, ConversationController } from './chat.controller';
import { ChatGateway } from './match-chat.gateway';
import { ChatService } from './match-chat.service';

@Module({
  controllers: [ChatController, ConversationController],
  providers: [ChatGateway, ChatService],
})
export class ChatModule {}