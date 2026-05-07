import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { HobbyEventPayload } from '@beefriends/shared-kernel';
import { PUBSUB_CHANNELS, PubSubService } from '../../../common/pub-sub';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class HobbySyncService implements OnModuleInit {
  private readonly logger = new Logger(HobbySyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: PubSubService,
  ) {}

  async onModuleInit() {
    await this.pubSub.subscribe(
      PUBSUB_CHANNELS.HOBBY_EVENTS,
      (payload) => this.handleHobbyEvent(payload),
      {
        consumerId: 'match-chat-hobby-sync',
        durable: true,
        replayFromStart: true,
      },
    );
  }

  private async handleHobbyEvent(payload: unknown) {
    if (!this.isHobbyEventPayload(payload)) return;

    if (payload.type === 'hobby.deleted') {
      await this.prisma.$transaction(async (tx) => {
        await tx.userHobbySnapshot.deleteMany({
          where: { hobbyId: payload.hobbyId },
        });
        await tx.hobby.updateMany({
          where: { id: payload.hobbyId },
          data: { isActive: false, syncedAt: new Date() },
        });
      });
      return;
    }

    await this.prisma.hobby.upsert({
      where: { id: payload.hobby.id },
      update: {
        name: payload.hobby.name,
        isActive: true,
        syncedAt: new Date(),
      },
      create: {
        id: payload.hobby.id,
        name: payload.hobby.name,
        isActive: true,
        syncedAt: new Date(),
      },
    });

    this.logger.log(`Synced hobby ${payload.hobby.id} from pubsub`);
  }

  private isHobbyEventPayload(payload: unknown): payload is HobbyEventPayload {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('type' in payload)
    ) {
      return false;
    }

    if (payload.type === 'hobby.deleted') {
      return 'hobbyId' in payload && Number.isInteger(payload.hobbyId);
    }

    return (
      (payload.type === 'hobby.synced' ||
        payload.type === 'hobby.created' ||
        payload.type === 'hobby.updated') &&
      'hobby' in payload &&
      typeof payload.hobby === 'object' &&
      payload.hobby !== null &&
      'id' in payload.hobby &&
      Number.isInteger(payload.hobby.id) &&
      'name' in payload.hobby &&
      typeof payload.hobby.name === 'string'
    );
  }
}
