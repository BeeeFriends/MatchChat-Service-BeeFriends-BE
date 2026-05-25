import { Module } from '@nestjs/common';
import {
  ChatController,
  ConversationController,
  MatchController,
  PresenceController,
} from '@/modules/match-chat/controllers/match-chat.controller';
import { PubSubModule } from '@/common/pub-sub';
import { MessageEncryptionService } from '@/common/crypto/message-encryption.service';
import { ChatGateway } from '@/modules/match-chat/gateways/match-chat.gateway';
import { ChatNotificationService } from '@/modules/match-chat/chat/chat-notification.service';
import { ChatRepository } from '@/modules/match-chat/chat/chat.repository';
import { ChatService } from '@/modules/match-chat/chat/chat.service';
import { MatchNotificationService } from '@/modules/match-chat/match/match-notification.service';
import { MatchRepository } from '@/modules/match-chat/match/match.repository';
import { MatchService } from '@/modules/match-chat/match/match.service';
import { PresenceRepository } from '@/modules/match-chat/presence/presence.repository';
import { PresenceService } from '@/modules/match-chat/presence/presence.service';
import { MatchChatUserRepository } from '@/modules/match-chat/users/user.repository';
import { MatchChatUserValidationService } from '@/modules/match-chat/users/user-validation.service';
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
    ChatNotificationService,
    ChatRepository,
    ChatService,
    HobbySyncService,
    MessageEncryptionService,
    MatchChatUserRepository,
    MatchChatUserValidationService,
    MatchNotificationService,
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
