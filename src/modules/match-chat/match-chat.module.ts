import { Module } from '@nestjs/common';
import {
  ChatController,
  ConversationController,
  MatchController,
  PresenceController,
} from './match-chat.controller';
import { PubSubModule } from '../../common/pub-sub';
import { MessageEncryptionService } from '../../common/crypto/message-encryption.service';
import { ChatGateway } from './match-chat.gateway';
import { ChatService } from './match-chat.service';
import { PresenceService } from './presence.service';
import { MatchService } from './match.service';
import {
  HobbySyncService,
  ProfileMasterSyncService,
  UserSyncService,
} from './sync';

@Module({
  imports: [PubSubModule],
  controllers: [
    ChatController,
    ConversationController,
    MatchController,
    PresenceController,
  ],
  providers: [
    ChatGateway,
    ChatService,
    HobbySyncService,
    MessageEncryptionService,
    MatchService,
    PresenceService,
    ProfileMasterSyncService,
    UserSyncService,
  ],
})
export class ChatModule {}
