import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { UserEventPayload } from '@beefriends/shared-kernel';
import { PUBSUB_CHANNELS, PubSubService } from '@/common/pub-sub';
import { SyncRepository } from '@/modules/match-chat/sync/sync.repository';

type NormalizedHobby = {
  hobbyId: number;
  name: string;
};

type NormalizedCampus = {
  campusId: number;
  name: string;
  address: string | null;
};

type NormalizedMajor = {
  majorId: number;
  name: string;
};

type NormalizedPhoto = {
  photoId: number;
  url: string;
  sortOrder: number;
  isProfile: boolean;
};

type SyncedUserPayload = Extract<UserEventPayload, { user: unknown }>['user'];

@Injectable()
export class UserSyncService implements OnModuleInit {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(
    private readonly syncRepository: SyncRepository,
    private readonly pubSub: PubSubService,
  ) {}

  async onModuleInit() {
    await this.pubSub.subscribe(
      PUBSUB_CHANNELS.USER_EVENTS,
      (payload) => this.handleUserEvent(payload),
      {
        consumerId: 'match-chat-user-sync',
        durable: true,
        replayFromStart: true,
      },
    );
  }

  private async handleUserEvent(payload: unknown) {
    if (!this.isUserEventPayload(payload)) return;

    if (payload.type === 'user.deleted') {
      await this.syncRepository.deactivateUser(payload.userId);
      return;
    }

    const user = payload.user;
    const campus = this.normalizeCampus(user);
    const major = this.normalizeMajor(user);
    const hobbies = this.normalizeHobbies(user.hobbies);
    const photos = this.normalizePhotos(user.photos);

    await this.syncRepository.syncUser(user, campus, major, hobbies, photos);

    this.logger.log(`Synced user ${user.id} from pubsub`);
  }

  private normalizeCampus(user: SyncedUserPayload): NormalizedCampus | null {
    const campusId = user.campusId ?? user.campus?.id;
    const name = user.campusName ?? user.campus?.name;

    if (!campusId || !name) return null;

    return {
      campusId,
      name,
      address: user.campusAddress ?? user.campus?.address ?? null,
    };
  }

  private normalizeMajor(user: SyncedUserPayload): NormalizedMajor | null {
    const majorId = user.majorId ?? user.major?.id;
    const name = user.majorName ?? user.major?.name;

    if (!majorId || !name) return null;

    return { majorId, name };
  }

  private normalizeHobbies(
    hobbies: SyncedUserPayload['hobbies'],
  ): NormalizedHobby[] {
    const uniqueHobbies = new Map<number, NormalizedHobby>();

    for (const hobby of hobbies ?? []) {
      if (!hobby.id || !hobby.name) continue;
      uniqueHobbies.set(hobby.id, {
        hobbyId: hobby.id,
        name: hobby.name,
      });
    }

    return Array.from(uniqueHobbies.values());
  }

  private normalizePhotos(
    photos: SyncedUserPayload['photos'],
  ): NormalizedPhoto[] {
    const uniquePhotos = new Map<number, NormalizedPhoto>();

    for (const photo of photos ?? []) {
      if (!photo.id || !photo.url) continue;
      uniquePhotos.set(photo.id, {
        photoId: photo.id,
        url: photo.url,
        sortOrder: photo.sortOrder ?? 0,
        isProfile: photo.isProfile ?? false,
      });
    }

    return Array.from(uniquePhotos.values()).sort(
      (first, second) => first.sortOrder - second.sortOrder,
    );
  }

  private isUserEventPayload(payload: unknown): payload is UserEventPayload {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('type' in payload)
    ) {
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
