import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/match-chat-client';
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
import { PUBSUB_CHANNELS, PubSubService } from '@/common/pub-sub';
import { MatchRepository } from '@/modules/match-chat/match.repository';
import {
  toMatchDto,
  toProfileDto,
} from '@/modules/match-chat/match-profile.mapper';

@Injectable()
export class MatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly pubSub: PubSubService,
  ) {}

  async discover(query: DiscoverMatchesQueryDto): Promise<MatchProfileDto[]> {
    const userId = Number(query.userId);
    const limit = this.clampLimit(query.limit);

    await this.ensureUsersActive([userId]);

    const [swipes, activeMatches, unmatchedMatches] = await Promise.all([
      this.matchRepository.findSwipedTargetIds(userId),
      this.matchRepository.findActiveMatchPairsForUser(userId),
      this.matchRepository.findUnmatchedPairsForUser(userId),
    ]);
    const unmatchedUserIds = new Set(
      unmatchedMatches.map((match) =>
        match.firstUserId === userId ? match.secondUserId : match.firstUserId,
      ),
    );

    const excludedUserIds = new Set<number>([userId]);
    for (const swipe of swipes) {
      if (!unmatchedUserIds.has(swipe.targetId)) {
        excludedUserIds.add(swipe.targetId);
      }
    }
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

    const users = await this.matchRepository.findDiscoverableUsers(
      where,
      limit,
    );

    return users.map((user) => toProfileDto(user));
  }

  async swipe(dto: SwipeUserDto): Promise<SwipeResultDto> {
    const swiperId = Number(dto.swiperId);
    const targetUserId = Number(dto.targetUserId);

    if (swiperId === targetUserId) {
      throw new BadRequestException('Cannot swipe yourself');
    }

    await this.ensureUsersActive([swiperId, targetUserId]);

    const result = await this.matchRepository.runSwipeTransaction(
      swiperId,
      targetUserId,
      dto.decision,
      this.orderUserIds,
    );

    if (result.isMatch && result.matchId && result.shouldNotify) {
      await this.publishMatchCreated(result.matchId);
    }

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

    const matches = await this.matchRepository.findActiveMatchesForUser(userId);

    return Promise.all(matches.map((match) => this.toMatchDto(match, userId)));
  }

  async getCampuses(): Promise<MatchProfileCampusDto[]> {
    const campuses = await this.matchRepository.findActiveCampuses();

    return campuses.map((campus) => ({
      id: campus.id,
      name: campus.name,
      address: campus.address,
    }));
  }

  async getMajors(): Promise<MatchProfileMajorDto[]> {
    const majors = await this.matchRepository.findActiveMajors();

    return majors.map((major) => ({
      id: major.id,
      name: major.name,
    }));
  }

  async getHobbies(): Promise<MatchProfileHobbyDto[]> {
    const hobbies = await this.matchRepository.findActiveHobbies();

    return hobbies.map((hobby) => ({
      id: hobby.id,
      name: hobby.name,
    }));
  }

  async getMatchByIdForUser(id: string, userId: number): Promise<MatchDto> {
    const match = await this.matchRepository.findMatchByIdForUser(id, userId);

    if (!match) throw new NotFoundException('Match not found');

    return this.toMatchDto(match, userId);
  }

  async unmatch(id: string, userId: number): Promise<MatchDto> {
    const currentMatch = await this.matchRepository.findActiveMatchByIdForUser(
      id,
      userId,
    );

    if (!currentMatch) throw new NotFoundException('Match not found');

    await this.matchRepository.unmatchAndDeleteSwipes(currentMatch);

    return this.getMatchByIdForUser(id, userId);
  }

  private async ensureUsersActive(userIds: number[]) {
    const uniqueUserIds = Array.from(new Set(userIds));
    const users = await this.matchRepository.findActiveUserIds(uniqueUserIds);
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

  private async toMatchDto(matchId: string, userId: number): Promise<MatchDto>;
  private async toMatchDto(
    match: Awaited<ReturnType<MatchRepository['findMatchByIdForUser']>>,
    userId: number,
  ): Promise<MatchDto>;
  private async toMatchDto(
    matchOrId:
      | string
      | Awaited<ReturnType<MatchRepository['findMatchByIdForUser']>>,
    userId: number,
  ): Promise<MatchDto> {
    const match =
      typeof matchOrId === 'string'
        ? await this.matchRepository.findMatchByIdForUser(matchOrId, userId)
        : matchOrId;

    if (!match) throw new NotFoundException('Match not found');

    const conversation = match.conversationId
      ? await this.matchRepository.findConversationPreview(match.conversationId)
      : null;

    return toMatchDto(match, userId, conversation);
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

  private async publishMatchCreated(matchId: string) {
    try {
      const match = await this.matchRepository.findMatchEventById(matchId);

      if (!match) return;

      await this.pubSub.publish(PUBSUB_CHANNELS.MATCH_EVENTS, {
        type: 'match.created',
        match,
      });
    } catch {
      // Matching must not fail because notification delivery is unavailable.
    }
  }
}
