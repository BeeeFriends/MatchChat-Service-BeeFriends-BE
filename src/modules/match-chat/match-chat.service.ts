import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PUBSUB_CHANNELS, PubSubService } from '../../common/pub-sub';
import { MessageEncryptionService } from '../../common/crypto/message-encryption.service';
import {
  ConversationDto,
  ConversationWithMessagesDto,
  CreateConversationDto,
  CreateMessageDto,
  MessageDto,
  MessageReadEvent,
} from '@beefriends/shared-kernel/dto';

type MessageRecord = {
  id: string;
  conversationId: string;
  senderId: number;
  content: string;
  attachmentUrls: string[];
  isEdited: boolean;
  isDeleted: boolean;
  readBy: number[];
  replyToMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ConversationRecord = {
  id: string;
  name: string | null;
  description: string | null;
  isGroup: boolean;
  lastMessageId: string | null;
  lastMessagePreview: string | null;
  lastMessageSenderId: number | null;
  createdAt: Date;
  updatedAt: Date;
  participants?: { userId: number }[];
  messages?: MessageRecord[];
  _count?: {
    messages?: number;
  };
};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: PubSubService,
    private readonly messageEncryption: MessageEncryptionService,
  ) {}

  async createMessage(
    createMessageDto: CreateMessageDto,
    senderId: number,
  ): Promise<MessageDto> {
    await this.ensureUsersSynced([senderId]);
    await this.ensureConversationAvailable(createMessageDto.conversationId);

    const message = await this.prisma.$transaction(async (tx) => {
      const participant = await tx.conversationParticipant.findUnique({
        where: {
          conversationId_userId: {
            conversationId: createMessageDto.conversationId,
            userId: senderId,
          },
        },
      });

      if (!participant) {
        throw new BadRequestException(
          'Sender is not a participant in this conversation',
        );
      }

      const createdMessage = await tx.message.create({
        data: {
          conversationId: createMessageDto.conversationId,
          senderId,
          content: this.messageEncryption.encrypt(createMessageDto.content),
          attachmentUrls: createMessageDto.attachmentUrls ?? [],
          replyToMessageId: createMessageDto.replyToMessageId,
        },
      });

      await tx.conversation.update({
        where: { id: createMessageDto.conversationId },
        data: {
          lastMessageId: createdMessage.id,
          lastMessagePreview: this.messageEncryption.encrypt(
            this.createPreview(createMessageDto.content),
          ),
          lastMessageSenderId: senderId,
        },
      });

      return createdMessage;
    });

    const messageDto = this.toMessageDto(message);
    await this.publishMessageCreated(messageDto);

    return messageDto;
  }

  async getMessages(conversationId: string): Promise<MessageDto[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map((message) => this.toMessageDto(message));
  }

  async markMessageRead(
    conversationId: string,
    messageId: string,
    userId: number,
  ): Promise<MessageDto> {
    await this.ensureConversationAvailable(conversationId);

    const message = await this.prisma.$transaction(async (tx) => {
      const participant = await tx.conversationParticipant.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId,
          },
        },
        select: { id: true },
      });

      if (!participant) {
        throw new BadRequestException(
          'Reader is not a participant in this conversation',
        );
      }

      const existingMessage = await tx.message.findFirst({
        where: {
          id: messageId,
          conversationId,
          isDeleted: false,
        },
      });

      if (!existingMessage) {
        throw new NotFoundException('Message not found');
      }

      if (
        existingMessage.senderId === userId ||
        existingMessage.readBy.includes(userId)
      ) {
        return existingMessage;
      }

      return tx.message.update({
        where: { id: messageId },
        data: {
          readBy: {
            push: userId,
          },
        },
      });
    });

    return this.toMessageDto(message);
  }

  async publishMessageRead(event: MessageReadEvent) {
    try {
      const participantIds = await this.getConversationParticipantIds(
        event.conversationId,
      );

      await this.pubSub.publish(PUBSUB_CHANNELS.CHAT_READS, {
        type: 'message.read',
        ...event,
        participantIds,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to publish read receipt ${event.messageId}: ${
          (error as Error).message
        }`,
      );
    }
  }

  async getConversationParticipantIds(conversationId: string) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });

    return participants.map((participant) => participant.userId);
  }

  async createConversation(
    createConversationDto: CreateConversationDto,
  ): Promise<ConversationDto> {
    const participantIds = Array.from(
      new Set(createConversationDto.participantIds),
    );

    if (!participantIds.length) {
      throw new BadRequestException('At least one participant is required');
    }

    await this.ensureUsersSynced(participantIds);

    const conversation = await this.prisma.conversation.create({
      data: {
        name: createConversationDto.name,
        description: createConversationDto.description,
        isGroup: createConversationDto.isGroup ?? participantIds.length > 2,
        participants: {
          create: participantIds.map((userId) => ({ userId })),
        },
      },
      include: { participants: true },
    });

    return this.toConversationDto(conversation);
  }

  async getConversations(userId: number): Promise<ConversationDto[]> {
    const hiddenConversationIds = await this.getHiddenConversationIds(userId);

    const conversations = await this.prisma.conversation.findMany({
      where: {
        id: hiddenConversationIds.length
          ? { notIn: hiddenConversationIds }
          : undefined,
        participants: {
          some: { userId },
        },
      },
      include: this.getConversationListInclude(userId),
      orderBy: { updatedAt: 'desc' },
    });

    return conversations.map((conversation) =>
      this.toConversationDto(conversation),
    );
  }

  async getConversation(id: string): Promise<ConversationDto | null> {
    if (await this.isConversationHidden(id)) return null;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        participants: true,
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!conversation) return null;
    return this.toConversationDto(conversation);
  }

  async getConversationWithMessages(
    id: string,
  ): Promise<ConversationWithMessagesDto | null> {
    if (await this.isConversationHidden(id)) return null;

    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        participants: true,
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!conversation) return null;

    return {
      ...this.toConversationDto(conversation),
      messages: conversation.messages.map((message) =>
        this.toMessageDto(message),
      ),
    };
  }

  async ensureConversationExists(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');
    await this.ensureConversationAvailable(id);
  }

  private async ensureConversationAvailable(id: string) {
    if (await this.isConversationHidden(id)) {
      throw new BadRequestException('Conversation is no longer available');
    }
  }

  private async isConversationHidden(id: string) {
    const unmatchedMatch = await this.prisma.userMatch.findFirst({
      where: {
        conversationId: id,
        status: 'UNMATCHED',
      },
      select: { id: true },
    });

    return Boolean(unmatchedMatch);
  }

  private async getHiddenConversationIds(userId: number) {
    const unmatchedMatches = await this.prisma.userMatch.findMany({
      where: {
        status: 'UNMATCHED',
        conversationId: { not: null },
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      select: { conversationId: true },
    });

    return unmatchedMatches
      .map((match) => match.conversationId)
      .filter((conversationId): conversationId is string =>
        Boolean(conversationId),
      );
  }

  private toMessageDto(message: MessageRecord): MessageDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: this.messageEncryption.decrypt(message.content),
      timestamp: message.createdAt,
      messageType: this.resolveMessageType(message.attachmentUrls),
      attachmentUrls: message.attachmentUrls,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      readBy: message.readBy,
      replyToMessageId: message.replyToMessageId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  private toConversationDto(conversation: ConversationRecord): ConversationDto {
    const participantIds =
      conversation.participants?.map((participant) => participant.userId) ?? [];
    const lastMessage = conversation.messages?.[0]
      ? this.toMessageDto(conversation.messages[0])
      : null;

    return {
      id: conversation.id,
      participants: participantIds,
      participantIds,
      name: conversation.name,
      description: conversation.description,
      isGroup: conversation.isGroup,
      lastMessageId: conversation.lastMessageId,
      lastMessagePreview: this.messageEncryption.decryptNullable(
        conversation.lastMessagePreview,
      ),
      lastMessageSenderId: conversation.lastMessageSenderId,
      lastMessage,
      unreadCount: conversation._count?.messages ?? 0,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    } as ConversationDto & { unreadCount: number };
  }

  private getConversationListInclude(userId: number) {
    return {
      participants: true,
      messages: {
        where: { isDeleted: false },
        orderBy: { createdAt: 'desc' as const },
        take: 1,
      },
      _count: {
        select: {
          messages: {
            where: {
              isDeleted: false,
              senderId: { not: userId },
              NOT: {
                readBy: {
                  has: userId,
                },
              },
            },
          },
        },
      },
    };
  }

  private createPreview(content: string) {
    return content.length > 120 ? `${content.slice(0, 117)}...` : content;
  }

  private resolveMessageType(
    attachmentUrls: string[],
  ): MessageDto['messageType'] {
    if (!attachmentUrls.length) return 'text';

    const hasImage = attachmentUrls.some((url) =>
      /\.(apng|avif|gif|jpe?g|png|webp)$/i.test(url),
    );

    return hasImage ? 'image' : 'file';
  }

  private async publishMessageCreated(message: MessageDto) {
    try {
      const participants = await this.prisma.conversationParticipant.findMany({
        where: { conversationId: message.conversationId },
        select: { userId: true },
      });
      const sender = await this.prisma.msUser.findUnique({
        where: { id: message.senderId },
        select: {
          id: true,
          displayName: true,
          profilePhotoUrl: true,
        },
      });

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

  private async ensureUsersSynced(userIds: number[]) {
    const uniqueUserIds = Array.from(new Set(userIds));
    const users = await this.prisma.msUser.findMany({
      where: {
        id: { in: uniqueUserIds },
        isActive: true,
      },
      select: { id: true },
    });
    const existingUserIds = new Set(users.map((user) => user.id));
    const missingUserIds = uniqueUserIds.filter(
      (userId) => !existingUserIds.has(userId),
    );

    if (missingUserIds.length) {
      throw new BadRequestException(
        `User not synced to chat service: ${missingUserIds.join(', ')}`,
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
