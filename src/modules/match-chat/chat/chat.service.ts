import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MessageEncryptionService } from '@/common/crypto/message-encryption.service';
import { ChatNotificationService } from '@/modules/match-chat/chat/chat-notification.service';
import { ChatRepository } from '@/modules/match-chat/chat/chat.repository';
import { MatchChatUserValidationService } from '@/modules/match-chat/users/user-validation.service';
import type { ConversationRecord, MessageRecord } from '@/types/match-chat';
import {
  ConversationDto,
  ConversationWithMessagesDto,
  CreateConversationDto,
  CreateMessageDto,
  MessageDto,
} from '@beefriends/shared-kernel/dto';

@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly chatNotificationService: ChatNotificationService,
    private readonly messageEncryption: MessageEncryptionService,
    private readonly userValidationService: MatchChatUserValidationService,
  ) {}

  async createMessage(
    createMessageDto: CreateMessageDto,
    senderId: number,
  ): Promise<MessageDto> {
    await this.userValidationService.ensureActiveUsers(
      [senderId],
      'chat service',
    );
    await this.ensureConversationAvailable(createMessageDto.conversationId);

    const message = await this.chatRepository.createMessage(
      createMessageDto.conversationId,
      senderId,
      this.messageEncryption.encrypt(createMessageDto.content),
      this.messageEncryption.encrypt(
        this.createPreview(createMessageDto.content),
      ),
      createMessageDto.attachmentUrls ?? [],
      createMessageDto.replyToMessageId,
    );

    if (!message) {
      throw new BadRequestException(
        'Sender is not a participant in this conversation',
      );
    }

    const messageDto = this.toMessageDto(message);
    await this.chatNotificationService.publishMessageCreated(messageDto);

    return messageDto;
  }

  async getMessages(conversationId: string): Promise<MessageDto[]> {
    const messages = await this.chatRepository.findMessages(conversationId);

    return messages.map((message) => this.toMessageDto(message));
  }

  async markMessageRead(
    conversationId: string,
    messageId: string,
    userId: number,
  ): Promise<MessageDto> {
    await this.ensureConversationAvailable(conversationId);

    const message = await this.chatRepository.markMessageRead(
      conversationId,
      messageId,
      userId,
    );

    if (message.status === 'participant-not-found') {
      throw new BadRequestException(
        'Reader is not a participant in this conversation',
      );
    }

    if (message.status === 'message-not-found') {
      throw new NotFoundException('Message not found');
    }

    return this.toMessageDto(message.message);
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

    await this.userValidationService.ensureActiveUsers(
      participantIds,
      'chat service',
    );

    const conversation = await this.chatRepository.createConversation(
      createConversationDto,
      participantIds,
    );

    return this.toConversationDto(conversation);
  }

  async getConversations(userId: number): Promise<ConversationDto[]> {
    const hiddenConversationIds = await this.getHiddenConversationIds(userId);

    const conversations = await this.chatRepository.findConversations(
      userId,
      hiddenConversationIds,
    );

    return conversations.map((conversation) =>
      this.toConversationDto(conversation),
    );
  }

  async getConversation(id: string): Promise<ConversationDto | null> {
    if (await this.isConversationHidden(id)) return null;

    const conversation = await this.chatRepository.findConversation(id);

    if (!conversation) return null;
    return this.toConversationDto(conversation);
  }

  async getConversationWithMessages(
    id: string,
  ): Promise<ConversationWithMessagesDto | null> {
    if (await this.isConversationHidden(id)) return null;

    const conversation =
      await this.chatRepository.findConversationWithMessages(id);

    if (!conversation) return null;

    return {
      ...this.toConversationDto(conversation),
      messages: conversation.messages.map((message) =>
        this.toMessageDto(message),
      ),
    };
  }

  async ensureConversationExists(id: string) {
    const conversation = await this.chatRepository.conversationExists(id);

    if (!conversation) throw new NotFoundException('Conversation not found');
    await this.ensureConversationAvailable(id);
  }

  private async ensureConversationAvailable(id: string) {
    if (await this.isConversationHidden(id)) {
      throw new BadRequestException('Conversation is no longer available');
    }
  }

  private async isConversationHidden(id: string) {
    const unmatchedMatch =
      await this.chatRepository.findUnmatchedMatchByConversationId(id);

    return Boolean(unmatchedMatch);
  }

  private async getHiddenConversationIds(userId: number) {
    const unmatchedMatches =
      await this.chatRepository.findHiddenConversationIds(userId);

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
}
