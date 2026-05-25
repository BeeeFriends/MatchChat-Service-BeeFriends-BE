import { Injectable } from '@nestjs/common';
import { PUBSUB_CHANNELS, PubSubService } from '@/common/pub-sub';
import { MatchRepository } from '@/modules/match-chat/match/match.repository';

@Injectable()
export class MatchNotificationService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly pubSub: PubSubService,
  ) {}

  async publishMatchCreated(matchId: string) {
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
