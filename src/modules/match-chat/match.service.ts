import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MatchStatus, Prisma } from '@prisma/match-chat-client';
import {
  DiscoverMatchesQueryDto,
  MatchDto,
  MatchProfileCampusDto,
  MatchProfileHobbyDto,
  MatchProfileMajorDto,
  MatchProfileDto,
  SwipeResultDto,
  SwipeUserDto,
} from '@beefriends/shared-kernel/dto';
import { PrismaService } from '../../prisma/prisma.service';

type PrismaClientLike = PrismaService | Prisma.TransactionClient;

type UserProfileRecord = Prisma.MsUserGetPayload<{
  include: {
    campus: true;
    major: true;
    hobbies: {
      include: {
        hobby: true;
      };
    };
    photos: true;
  };
}>;

type MatchRecord = {
  id: string;
  firstUserId: number;
  secondUserId: number;
  status: MatchStatus;
  conversationId: string | null;
  matchedAt: Date;
  firstUser: UserProfileRecord;
  secondUser: UserProfileRecord;
};

const userProfileInclude = {
  campus: true,
  major: true,
  hobbies: {
    where: { hobby: { isActive: true } },
    include: { hobby: true },
    orderBy: { hobbyId: 'asc' as const },
  },
  photos: {
    orderBy: [{ sortOrder: 'asc' as const }, { photoId: 'asc' as const }],
  },
};

const matchInclude = {
  firstUser: {
    include: userProfileInclude,
  },
  secondUser: {
    include: userProfileInclude,
  },
};

@Injectable()
export class MatchService {
  constructor(private readonly prisma: PrismaService) {}

  async discover(query: DiscoverMatchesQueryDto): Promise<MatchProfileDto[]> {
    const userId = Number(query.userId);
    const limit = this.clampLimit(query.limit);

    await this.ensureUsersActive([userId]);

    const swipes = await this.prisma.matchSwipe.findMany({
      where: { swiperId: userId },
      select: { targetId: true },
    });
    const activeMatches = await this.prisma.userMatch.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      select: { firstUserId: true, secondUserId: true },
    });

    const excludedUserIds = new Set<number>([userId]);
    for (const swipe of swipes) excludedUserIds.add(swipe.targetId);
    for (const match of activeMatches) {
      excludedUserIds.add(
        match.firstUserId === userId ? match.secondUserId : match.firstUserId,
      );
    }

    const where: Prisma.MsUserWhereInput = {
      id: { notIn: Array.from(excludedUserIds) },
      isActive: true,
      campusId: query.campusId,
      majorId: query.majorId,
      hobbies: query.hobbyIds?.length
        ? { some: { hobbyId: { in: query.hobbyIds } } }
        : undefined,
    };

    const users = await this.prisma.msUser.findMany({
      where,
      include: userProfileInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
    });

    return users.map((user) => this.toProfileDto(user));
  }

  async swipe(dto: SwipeUserDto): Promise<SwipeResultDto> {
    const swiperId = Number(dto.swiperId);
    const targetUserId = Number(dto.targetUserId);

    if (swiperId === targetUserId) {
      throw new BadRequestException('Cannot swipe yourself');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await this.ensureUsersActive([swiperId, targetUserId], tx);

      await tx.matchSwipe.upsert({
        where: {
          swiperId_targetId: {
            swiperId,
            targetId: targetUserId,
          },
        },
        update: { decision: dto.decision },
        create: {
          swiperId,
          targetId: targetUserId,
          decision: dto.decision,
        },
      });

      if (dto.decision !== 'LIKE') {
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

      const [firstUserId, secondUserId] = this.orderUserIds(
        swiperId,
        targetUserId,
      );
      const existingMatch = await tx.userMatch.findUnique({
        where: {
          firstUserId_secondUserId: {
            firstUserId,
            secondUserId,
          },
        },
      });

      if (existingMatch?.status === 'ACTIVE') {
        return { isMatch: true, matchId: existingMatch.id };
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

      return { isMatch: true, matchId: match.id };
    });

    return {
      swiperId,
      targetUserId,
      decision: dto.decision,
      isMatch: result.isMatch,
      match: result.matchId
        ? await this.getMatchByIdForUser(result.matchId, swiperId)
        : null,
    };
  }

  async getMatches(userId: number): Promise<MatchDto[]> {
    await this.ensureUsersActive([userId]);

    const matches = await this.prisma.userMatch.findMany({
      where: {
        status: 'ACTIVE',
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      include: matchInclude,
      orderBy: { matchedAt: 'desc' },
    });

    return Promise.all(matches.map((match) => this.toMatchDto(match, userId)));
  }

  async getCampuses(): Promise<MatchProfileCampusDto[]> {
    const campuses = await this.prisma.msCampus.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    return campuses.map((campus) => ({
      id: campus.id,
      name: campus.name,
      address: campus.address,
    }));
  }

  async getMajors(): Promise<MatchProfileMajorDto[]> {
    const majors = await this.prisma.msDepartment.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    return majors.map((major) => ({
      id: major.id,
      name: major.name,
    }));
  }

  async getHobbies(): Promise<MatchProfileHobbyDto[]> {
    const hobbies = await this.prisma.msHobby.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    return hobbies.map((hobby) => ({
      id: hobby.id,
      name: hobby.name,
    }));
  }

  async getMatchByIdForUser(id: string, userId: number): Promise<MatchDto> {
    const match = await this.prisma.userMatch.findFirst({
      where: {
        id,
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
      include: matchInclude,
    });

    if (!match) throw new NotFoundException('Match not found');

    return this.toMatchDto(match, userId);
  }

  async unmatch(id: string, userId: number): Promise<MatchDto> {
    const currentMatch = await this.prisma.userMatch.findFirst({
      where: {
        id,
        status: 'ACTIVE',
        OR: [{ firstUserId: userId }, { secondUserId: userId }],
      },
    });

    if (!currentMatch) throw new NotFoundException('Match not found');

    await this.prisma.userMatch.update({
      where: { id },
      data: {
        status: 'UNMATCHED',
        unmatchedAt: new Date(),
      },
    });

    return this.getMatchByIdForUser(id, userId);
  }

  private async ensureUsersActive(
    userIds: number[],
    client: PrismaClientLike = this.prisma,
  ) {
    const uniqueUserIds = Array.from(new Set(userIds));
    const users = await client.msUser.findMany({
      where: { id: { in: uniqueUserIds }, isActive: true },
      select: { id: true },
    });
    const existingUserIds = new Set(users.map((user) => user.id));
    const missingUserIds = uniqueUserIds.filter(
      (userId) => !existingUserIds.has(userId),
    );

    if (missingUserIds.length) {
      throw new BadRequestException(
        `User not synced to match chat service: ${missingUserIds.join(', ')}`,
      );
    }
  }

  private async toMatchDto(
    match: MatchRecord,
    userId: number,
  ): Promise<MatchDto> {
    const matchedUser =
      match.firstUserId === userId ? match.secondUser : match.firstUser;
    const conversation = match.conversationId
      ? await this.prisma.conversation.findUnique({
          where: { id: match.conversationId },
          select: {
            lastMessagePreview: true,
            lastMessageSenderId: true,
          },
        })
      : null;

    return {
      id: match.id,
      userId,
      matchedUser: this.toProfileDto(matchedUser),
      conversationId: match.conversationId,
      status: match.status,
      isNew: !conversation?.lastMessagePreview,
      lastMessagePreview: conversation?.lastMessagePreview ?? null,
      lastMessageSenderId: conversation?.lastMessageSenderId ?? null,
      matchedAt: match.matchedAt,
    };
  }

  private toProfileDto(user: UserProfileRecord): MatchProfileDto {
    return {
      id: user.id,
      displayName: user.displayName,
      binusianEmail: user.binusianEmail,
      phoneNumber: user.phoneNumber,
      gender: user.gender,
      age: user.age,
      binusianYear: user.binusianYear,
      description: user.description,
      profilePhotoUrl: user.profilePhotoUrl,
      campus: user.campus?.isActive
        ? {
            id: user.campus.id,
            name: user.campus.name,
            address: user.campus.address,
          }
        : null,
      major: user.major?.isActive
        ? {
            id: user.major.id,
            name: user.major.name,
          }
        : null,
      hobbies: this.toHobbies(user.hobbies),
      photos: this.toPhotos(user.photos),
    };
  }

  private toHobbies(hobbies: UserProfileRecord['hobbies']) {
    return hobbies.map((hobby) => ({
      id: hobby.hobby.id,
      name: hobby.hobby.name,
    }));
  }

  private toPhotos(photos: UserProfileRecord['photos']) {
    return photos.map((photo) => ({
      id: photo.photoId,
      url: photo.url,
      sortOrder: photo.sortOrder,
      isProfile: photo.isProfile,
    }));
  }

  private orderUserIds(
    firstUserId: number,
    secondUserId: number,
  ): [number, number] {
    return firstUserId < secondUserId
      ? [firstUserId, secondUserId]
      : [secondUserId, firstUserId];
  }

  private clampLimit(limit?: number) {
    if (!limit) return 20;
    return Math.min(Math.max(limit, 1), 50);
  }
}
