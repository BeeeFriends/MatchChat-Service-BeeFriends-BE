import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PUBSUB_CHANNELS, PubSubService } from '../../common/pub-sub';
import {
  ConversationDto,
  ConversationWithMessagesDto,
  CreateConversationDto,
  CreateMessageDto,
  MessageDto,
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
};

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: PubSubService,
  ) {}

  async createMessage(
    createMessageDto: CreateMessageDto,
    senderId: number,
  ): Promise<MessageDto> {
    await this.ensureUsersSynced([senderId]);

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
          content: createMessageDto.content,
          attachmentUrls: createMessageDto.attachmentUrls ?? [],
          replyToMessageId: createMessageDto.replyToMessageId,
        },
      });

      await tx.conversation.update({
        where: { id: createMessageDto.conversationId },
        data: {
          lastMessageId: createdMessage.id,
          lastMessagePreview: this.createPreview(createdMessage.content),
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
    const conversations = await this.prisma.conversation.findMany({
      where: {
        participants: {
          some: { userId },
        },
      },
      include: {
        participants: true,
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return conversations.map((conversation) =>
      this.toConversationDto(conversation),
    );
  }

  async getConversation(id: string): Promise<ConversationDto | null> {
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
  }

  private toMessageDto(message: MessageRecord): MessageDto {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
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
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageSenderId: conversation.lastMessageSenderId,
      lastMessage,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
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
      await this.pubSub.publish(PUBSUB_CHANNELS.CHAT_MESSAGES, {
        type: 'message.created',
        conversationId: message.conversationId,
        message,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to publish message ${message.id}: ${(error as Error).message}`,
      );
    }
  }

  private async ensureUsersSynced(userIds: number[]) {
    const uniqueUserIds = Array.from(new Set(userIds));
    const users = await this.prisma.user.findMany({
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
}
