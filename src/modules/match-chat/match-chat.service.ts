import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { MessageDto, ConversationDto, CreateMessageDto, CreateConversationDto, ConversationWithMessagesDto } from '@beefriends/shared-kernel';

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService) {}

  async createMessage(createMessageDto: CreateMessageDto, senderId: string): Promise<MessageDto> {
    const message = await this.prisma.message.create({
      data: {
        conversationId: createMessageDto.conversationId,
        senderId,
        content: createMessageDto.content,
        attachmentUrls: createMessageDto.attachmentUrls || [],
        replyToMessageId: createMessageDto.replyToMessageId,
      },
    });

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      content: message.content,
      timestamp: message.createdAt,
      messageType: 'text' as const,
      attachmentUrls: message.attachmentUrls,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      readBy: message.readBy,
      replyToMessageId: message.replyToMessageId,
      createdAt: message.createdAt,
      updatedAt: message.updatedAt,
    };
  }

  async getMessages(conversationId: string): Promise<MessageDto[]> {
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    return messages.map(msg => ({
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      content: msg.content,
      timestamp: msg.createdAt,
      messageType: 'text' as const,
      attachmentUrls: msg.attachmentUrls,
      isEdited: msg.isEdited,
      isDeleted: msg.isDeleted,
      readBy: msg.readBy,
      replyToMessageId: msg.replyToMessageId,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    }));
  }

  async createConversation(createConversationDto: CreateConversationDto): Promise<ConversationDto> {
    const conversation = await this.prisma.conversation.create({
      data: {
        name: createConversationDto.name,
        description: createConversationDto.description,
        isGroup: createConversationDto.isGroup,
        participants: {
          create: createConversationDto.participantIds.map(userId => ({ userId })),
        },
      },
      include: { participants: true },
    });

    return {
      id: conversation.id,
      participants: conversation.participants.map(p => p.userId),
      participantIds: conversation.participants.map(p => p.userId),
      name: conversation.name,
      description: conversation.description,
      isGroup: conversation.isGroup,
      lastMessageId: conversation.lastMessageId,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageSenderId: conversation.lastMessageSenderId,
      lastMessage: null, // or fetch last message if needed
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  async getConversations(userId: string): Promise<ConversationDto[]> {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        participants: {
          some: { userId },
        },
      },
      include: { participants: true },
    });

    return conversations.map(conv => ({
      id: conv.id,
      participants: conv.participants.map(p => p.userId),
      participantIds: conv.participants.map(p => p.userId),
      name: conv.name,
      description: conv.description,
      isGroup: conv.isGroup,
      lastMessageId: conv.lastMessageId,
      lastMessagePreview: conv.lastMessagePreview,
      lastMessageSenderId: conv.lastMessageSenderId,
      lastMessage: null, // or fetch
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    }));
  }

  async getConversation(id: string): Promise<ConversationDto | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: { participants: true },
    });

    if (!conversation) return null;

    return {
      id: conversation.id,
      participants: conversation.participants.map(p => p.userId),
      participantIds: conversation.participants.map(p => p.userId),
      name: conversation.name,
      description: conversation.description,
      isGroup: conversation.isGroup,
      lastMessageId: conversation.lastMessageId,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageSenderId: conversation.lastMessageSenderId,
      lastMessage: null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  }

  async getConversationWithMessages(id: string): Promise<ConversationWithMessagesDto | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: { participants: true, messages: { orderBy: { createdAt: 'asc' } } },
    });

    if (!conversation) return null;

    const messages: MessageDto[] = conversation.messages.map(msg => ({
      id: msg.id,
      conversationId: msg.conversationId,
      senderId: msg.senderId,
      content: msg.content,
      timestamp: msg.createdAt,
      messageType: 'text' as const,
      attachmentUrls: msg.attachmentUrls,
      isEdited: msg.isEdited,
      isDeleted: msg.isDeleted,
      readBy: msg.readBy,
      replyToMessageId: msg.replyToMessageId,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    }));

    return {
      id: conversation.id,
      participants: conversation.participants.map(p => p.userId),
      participantIds: conversation.participants.map(p => p.userId),
      name: conversation.name,
      description: conversation.description,
      isGroup: conversation.isGroup,
      lastMessageId: conversation.lastMessageId,
      lastMessagePreview: conversation.lastMessagePreview,
      lastMessageSenderId: conversation.lastMessageSenderId,
      lastMessage: null,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages,
    };
  }
}