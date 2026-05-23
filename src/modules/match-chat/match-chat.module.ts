import { Module } from '@nestjs/common';
import {
  ChatController,
  ConversationController,
  MatchController,
  PresenceController,
} from '@/modules/match-chat/match-chat.controller';
import { PubSubModule } from '@/common/pub-sub';
import { MessageEncryptionService } from '@/common/crypto/message-encryption.service';
import { ChatGateway } from '@/modules/match-chat/match-chat.gateway';
import { ChatRepository } from '@/modules/match-chat/chat.repository';
import { ChatService } from '@/modules/match-chat/match-chat.service';
import { MatchRepository } from '@/modules/match-chat/match.repository';
import { MatchService } from '@/modules/match-chat/match.service';
import { PresenceRepository } from '@/modules/match-chat/presence.repository';
import { PresenceService } from '@/modules/match-chat/presence.service';
import {
  HobbySyncService,
  ProfileMasterSyncService,
  UserSyncService,
} from '@/modules/match-chat/sync';
import { SyncRepository } from '@/modules/match-chat/sync/sync.repository';

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
    ChatRepository,
    ChatService,
    HobbySyncService,
    MessageEncryptionService,
    MatchRepository,
    MatchService,
    PresenceRepository,
    PresenceService,
    ProfileMasterSyncService,
    SyncRepository,
    UserSyncService,
  ],
})
export class ChatModule {}
