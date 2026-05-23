import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/match-chat-client';
import { PrismaService } from '@/prisma/prisma.service';
import type { CreateConversationDto } from '@beefriends/shared-kernel/dto';

@Injectable()
export class ChatRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveUserIds(userIds: number[]) {
    return this.prisma.msUser.findMany({
      where: {
        id: { in: userIds },
        isActive: true,
      },
      select: { id: true },
    });
  }

  async createMessage(
    conversationId: string,
    senderId: number,
    encryptedContent: string,
    encryptedPreview: string,
    attachmentUrls: string[],
    replyToMessageId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const participant = await tx.conversationParticipant.findUnique({
        where: {
          conversationId_userId: {
            conversationId,
            userId: senderId,
          },
        },
      });

      if (!participant) return null;

      const createdMessage = await tx.message.create({
        data: {
          conversationId,
          senderId,
          content: encryptedContent,
          attachmentUrls,
          replyToMessageId,
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageId: createdMessage.id,
          lastMessagePreview: encryptedPreview,
          lastMessageSenderId: senderId,
        },
      });

      return createdMessage;
    });
  }

  findMessages(conversationId: string) {
    return this.prisma.message.findMany({
      where: { conversationId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  async markMessageRead(
    conversationId: string,
    messageId: string,
    userId: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
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
        return {
          status: 'participant-not-found' as const,
          message: null,
        };
      }

      const existingMessage = await tx.message.findFirst({
        where: {
          id: messageId,
          conversationId,
          isDeleted: false,
        },
      });

      if (!existingMessage) {
        return {
          status: 'message-not-found' as const,
          message: null,
        };
      }

      if (
        existingMessage.senderId === userId ||
        existingMessage.readBy.includes(userId)
      ) {
        return {
          status: 'ok' as const,
          message: existingMessage,
        };
      }

      const message = await tx.message.update({
        where: { id: messageId },
        data: {
          readBy: {
            push: userId,
          },
        },
      });

      return {
        status: 'ok' as const,
        message,
      };
    });
  }

  findConversationParticipantIds(conversationId: string) {
    return this.prisma.conversationParticipant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
  }

  createConversation(dto: CreateConversationDto, participantIds: number[]) {
    return this.prisma.conversation.create({
      data: {
        name: dto.name,
        description: dto.description,
        isGroup: dto.isGroup ?? participantIds.length > 2,
        participants: {
          create: participantIds.map((userId) => ({ userId })),
        },
      },
      include: { participants: true },
    });
  }

  findConversations(userId: number, hiddenConversationIds: string[]) {
    return this.prisma.conversation.findMany({
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
  }

  findConversation(id: string) {
    return this.prisma.conversation.findUnique({
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
  }

  findConversationWithMessages(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      include: {
        participants: true,
        messages: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  conversationExists(id: string) {
    return this.prisma.conversation.findUnique({
      where: { id },
      select: { id: true },
    });
  }

  findUnmatchedMatchByConversationId(id: string) {
    return this.prisma.userMatch.findFirst({
      where: {
        conversationId: id,
        status: 'UNMATCHED',
      },
      select: { id: true },
    });
  }

  findHiddenConversationIds(userId: number) {
    return this.prisma.userMatch.findMany({
      where: {
        status: 'UNMATCHED',
        conversationId: { not: null },
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      select: { conversationId: true },
    });
  }

  findSenderForNotification(senderId: number) {
    return this.prisma.msUser.findUnique({
      where: { id: senderId },
      select: {
        id: true,
        displayName: true,
        profilePhotoUrl: true,
      },
    });
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
    } satisfies Prisma.ConversationInclude;
  }
}
