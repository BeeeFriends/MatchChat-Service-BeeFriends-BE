import { Module } from '@nestjs/common';
import {
  ChatController,
  ConversationController,
  PresenceController,
} from './match-chat.controller';
import { PubSubModule } from '../../common/pub-sub';
import { ChatGateway } from './match-chat.gateway';
import { ChatService } from './match-chat.service';
import { PresenceService } from './presence.service';
import { UserSyncService } from './user-sync.service';

@Module({
  imports: [PubSubModule],
  controllers: [ChatController, ConversationController, PresenceController],
  providers: [ChatGateway, ChatService, PresenceService, UserSyncService],
})
export class ChatModule {}
