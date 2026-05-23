import { Injectable } from '@nestjs/common';
import type { MatchDecision, Prisma } from '@prisma/match-chat-client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  MATCH_INCLUDE,
  USER_PROFILE_INCLUDE,
} from '@/modules/match-chat/match-profile.prisma';

type MatchPair = {
  firstUserId: number;
  secondUserId: number;
};

type SwipeTransactionResult = {
  isMatch: boolean;
  matchId: string | null;
  shouldNotify?: boolean;
};

@Injectable()
export class MatchRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveUserIds(userIds: number[]) {
    return this.prisma.msUser.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true },
    });
  }

  findSwipedTargetIds(userId: number) {
    return this.prisma.matchSwipe.findMany({
      where: { swiperId: userId },
      select: { targetId: true },
    });
  }

  findActiveMatchPairsForUser(userId: number): Promise<MatchPair[]> {
    return this.prisma.userMatch.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      select: { firstUserId: true, secondUserId: true },
    });
  }

  findUnmatchedPairsForUser(userId: number): Promise<MatchPair[]> {
    return this.prisma.userMatch.findMany({
      where: {
        status: 'UNMATCHED',
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      select: { firstUserId: true, secondUserId: true },
    });
  }

  findDiscoverableUsers(where: Prisma.MsUserWhereInput, limit: number) {
    return this.prisma.msUser.findMany({
      where,
      include: USER_PROFILE_INCLUDE,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });
  }

  runSwipeTransaction(
    swiperId: number,
    targetUserId: number,
    decision: MatchDecision,
    orderUserIds: (firstUserId: number, secondUserId: number) => [number, number],
  ): Promise<SwipeTransactionResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.matchSwipe.upsert({
        where: {
          swiperId_targetId: {
            swiperId,
            targetId: targetUserId,
          },
        },
        update: { decision },
        create: {
          swiperId,
          targetId: targetUserId,
          decision,
        },
      });

      if (decision !== 'LIKE') {
        return { isMatch: false, matchId: null };
      }

      const reverseLike = await tx.matchSwipe.findUnique({
        where: {
          swiperId_targetId: {
            swiperId: targetUserId,
            targetId: swiperId,
          },
        },
      });

      if (reverseLike?.decision !== 'LIKE') {
        return { isMatch: false, matchId: null };
      }

      const [firstUserId, secondUserId] = orderUserIds(swiperId, targetUserId);
      const existingMatch = await tx.userMatch.findUnique({
        where: {
          firstUserId_secondUserId: {
            firstUserId,
            secondUserId,
          },
        },
      });

      if (existingMatch?.status === 'ACTIVE') {
        return { isMatch: true, matchId: existingMatch.id, shouldNotify: false };
      }

      const conversationId =
        existingMatch?.conversationId ??
        (
          await tx.conversation.create({
            data: {
              isGroup: false,
              participants: {
                create: [{ userId: swiperId }, { userId: targetUserId }],
              },
            },
            select: { id: true },
          })
        ).id;

      const match = existingMatch
        ? await tx.userMatch.update({
            where: { id: existingMatch.id },
            data: {
              status: 'ACTIVE',
              conversationId,
              matchedAt: new Date(),
              unmatchedAt: null,
            },
          })
        : await tx.userMatch.create({
            data: {
              firstUserId,
              secondUserId,
              conversationId,
            },
          });

      return { isMatch: true, matchId: match.id, shouldNotify: true };
    });
  }

  findActiveMatchesForUser(userId: number) {
    return this.prisma.userMatch.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      include: MATCH_INCLUDE,
      orderBy: { matchedAt: 'desc' },
    });
  }

  findConversationPreview(conversationId: string) {
    return this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        lastMessagePreview: true,
        lastMessageSenderId: true,
      },
    });
  }

  findActiveCampuses() {
    return this.prisma.msCampus.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  findActiveMajors() {
    return this.prisma.msDepartment.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  findActiveHobbies() {
    return this.prisma.msHobby.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  findMatchByIdForUser(id: string, userId: number) {
    return this.prisma.userMatch.findFirst({
      where: {
        id,
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      include: MATCH_INCLUDE,
    });
  }

  findActiveMatchByIdForUser(id: string, userId: number) {
    return this.prisma.userMatch.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
    });
  }

  async unmatchAndDeleteSwipes(match: MatchPair & { id: string }) {
    await this.prisma.$transaction(async (tx) => {
      await tx.userMatch.update({
        where: { id: match.id },
        data: {
          status: 'UNMATCHED',
          unmatchedAt: new Date(),
        },
      });

      await tx.matchSwipe.deleteMany({
        where: {
          OR: [
            {
              swiperId: match.firstUserId,
              targetId: match.secondUserId,
            },
            {
              swiperId: match.secondUserId,
              targetId: match.firstUserId,
            },
          ],
        },
      });
    });
  }

  findMatchEventById(matchId: string) {
    return this.prisma.userMatch.findUnique({
      where: { id: matchId },
      select: {
        id: true,
        firstUserId: true,
        secondUserId: true,
        conversationId: true,
      },
    });
  }
}
