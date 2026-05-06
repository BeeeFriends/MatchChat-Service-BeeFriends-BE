import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PUBSUB_CHANNELS, PubSubService } from '../../common/pub-sub';
import { PrismaService } from '../../prisma/prisma.service';

type UserSnapshotPayload = {
  id: number;
  displayName?: string | null;
  binusianEmail?: string | null;
  phoneNumber?: string | null;
  binusianYear?: number | null;
  description?: string | null;
  profilePhotoUrl?: string | null;
  campusId?: number | null;
  majorId?: number | null;
  campus?: { id?: number | null } | null;
  major?: { id?: number | null } | null;
};

type UserSyncedEvent = {
  type: 'user.synced' | 'user.created' | 'user.updated';
  user: UserSnapshotPayload;
};

type UserDeletedEvent = {
  type: 'user.deleted';
  userId: number;
};

type UserEventPayload = UserSyncedEvent | UserDeletedEvent;

@Injectable()
export class UserSyncService implements OnModuleInit {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: PubSubService,
  ) {}

  async onModuleInit() {
    await this.pubSub.subscribe(PUBSUB_CHANNELS.USER_EVENTS, (payload) =>
      this.handleUserEvent(payload),
    );
  }

  private async handleUserEvent(payload: unknown) {
    if (!this.isUserEventPayload(payload)) return;

    if (payload.type === 'user.deleted') {
      await this.prisma.user.updateMany({
        where: { id: payload.userId },
        data: { isActive: false, syncedAt: new Date() },
      });
      return;
    }

    const user = payload.user;
    await this.prisma.user.upsert({
      where: { id: user.id },
      update: {
        displayName: user.displayName,
        binusianEmail: user.binusianEmail,
        phoneNumber: user.phoneNumber,
        binusianYear: user.binusianYear,
        description: user.description,
        profilePhotoUrl: user.profilePhotoUrl,
        campusId: user.campusId ?? user.campus?.id,
        majorId: user.majorId ?? user.major?.id,
        isActive: true,
        syncedAt: new Date(),
      },
      create: {
        id: user.id,
        displayName: user.displayName,
        binusianEmail: user.binusianEmail,
        phoneNumber: user.phoneNumber,
        binusianYear: user.binusianYear,
        description: user.description,
        profilePhotoUrl: user.profilePhotoUrl,
        campusId: user.campusId ?? user.campus?.id,
        majorId: user.majorId ?? user.major?.id,
        isActive: true,
        syncedAt: new Date(),
      },
    });

    this.logger.log(`Synced user ${user.id} from pubsub`);
  }

  private isUserEventPayload(payload: unknown): payload is UserEventPayload {
    if (typeof payload !== 'object' || payload === null || !('type' in payload)) {
      return false;
    }

    if (payload.type === 'user.deleted') {
      return 'userId' in payload && Number.isInteger(payload.userId);
    }

    return (
      (payload.type === 'user.synced' ||
        payload.type === 'user.created' ||
        payload.type === 'user.updated') &&
      'user' in payload &&
      typeof payload.user === 'object' &&
      payload.user !== null &&
      'id' in payload.user &&
      Number.isInteger(payload.user.id)
    );
  }
}
