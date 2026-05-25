import { Injectable, Logger } from '@nestjs/common';
import { MessageDto, MessageReadEvent } from '@beefriends/shared-kernel/dto';
import { MessageEncryptionService } from '@/common/crypto/message-encryption.service';
import { PUBSUB_CHANNELS, PubSubService } from '@/common/pub-sub';
import { ChatRepository } from '@/modules/match-chat/chat/chat.repository';

@Injectable()
export class ChatNotificationService {
  private readonly logger = new Logger(ChatNotificationService.name);

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly messageEncryption: MessageEncryptionService,
    private readonly pubSub: PubSubService,
  ) {}

  async publishMessageCreated(message: MessageDto) {
    try {
      const [participants, sender] = await Promise.all([
        this.chatRepository.findConversationParticipantIds(
          message.conversationId,
        ),
        this.chatRepository.findSenderForNotification(message.senderId),
      ]);

      await this.pubSub.publish(PUBSUB_CHANNELS.CHAT_MESSAGES, {
        type: 'message.created',
        conversationId: message.conversationId,
        participantIds: participants.map((participant) => participant.userId),
        sender,
        message: this.toBrokerMessage(message),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to publish message ${message.id}: ${(error as Error).message}`,
      );
    }
  }

  async publishMessageRead(event: MessageReadEvent) {
    try {
      const participants =
        await this.chatRepository.findConversationParticipantIds(
          event.conversationId,
        );

      await this.pubSub.publish(PUBSUB_CHANNELS.CHAT_READS, {
        type: 'message.read',
        ...event,
        participantIds: participants.map((participant) => participant.userId),
      });
    } catch (error) {
      this.logger.warn(
        `Failed to publish read receipt ${event.messageId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  private toBrokerMessage(message: MessageDto): MessageDto {
    return {
      ...message,
      content: this.messageEncryption.encrypt(message.content),
    };
  }
}
