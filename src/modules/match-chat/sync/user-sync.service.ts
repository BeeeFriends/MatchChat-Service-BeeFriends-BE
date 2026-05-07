import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type {
  UserEventPayload,
  UserSnapshotPayload,
} from '@beefriends/shared-kernel';
import { PUBSUB_CHANNELS, PubSubService } from '../../../common/pub-sub';
import { PrismaService } from '../../../prisma/prisma.service';

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

@Injectable()
export class UserSyncService implements OnModuleInit {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
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
      await this.prisma.user.updateMany({
        where: { id: payload.userId },
        data: { isActive: false, syncedAt: new Date() },
      });
      return;
    }

    const user = payload.user;
    const campus = this.normalizeCampus(user);
    const major = this.normalizeMajor(user);
    const hobbies = this.normalizeHobbies(user.hobbies);
    const photos = this.normalizePhotos(user.photos);

    await this.prisma.$transaction(async (tx) => {
      const syncedAt = new Date();

      if (campus) {
        await tx.campus.upsert({
          where: { id: campus.campusId },
          update: {
            name: campus.name,
            address: campus.address,
            isActive: true,
            syncedAt,
          },
          create: {
            id: campus.campusId,
            name: campus.name,
            address: campus.address,
            isActive: true,
            syncedAt,
          },
        });
      }

      if (major) {
        await tx.major.upsert({
          where: { id: major.majorId },
          update: {
            name: major.name,
            isActive: true,
            syncedAt,
          },
          create: {
            id: major.majorId,
            name: major.name,
            isActive: true,
            syncedAt,
          },
        });
      }

      await tx.user.upsert({
        where: { id: user.id },
        update: {
          displayName: user.displayName,
          binusianEmail: user.binusianEmail,
          phoneNumber: user.phoneNumber,
          binusianYear: user.binusianYear,
          description: user.description,
          profilePhotoUrl: user.profilePhotoUrl,
          campusId: campus?.campusId ?? null,
          majorId: major?.majorId ?? null,
          isActive: true,
          syncedAt,
        },
        create: {
          id: user.id,
          displayName: user.displayName,
          binusianEmail: user.binusianEmail,
          phoneNumber: user.phoneNumber,
          binusianYear: user.binusianYear,
          description: user.description,
          profilePhotoUrl: user.profilePhotoUrl,
          campusId: campus?.campusId ?? null,
          majorId: major?.majorId ?? null,
          isActive: true,
          syncedAt,
        },
      });

      await tx.userHobbySnapshot.deleteMany({ where: { userId: user.id } });
      if (hobbies.length) {
        for (const hobby of hobbies) {
          await tx.hobby.upsert({
            where: { id: hobby.hobbyId },
            update: {
              name: hobby.name,
              isActive: true,
              syncedAt,
            },
            create: {
              id: hobby.hobbyId,
              name: hobby.name,
              isActive: true,
              syncedAt,
            },
          });
        }

        await tx.userHobbySnapshot.createMany({
          data: hobbies.map((hobby) => ({
            userId: user.id,
            hobbyId: hobby.hobbyId,
          })),
        });
      }

      await tx.userPhotoSnapshot.deleteMany({ where: { userId: user.id } });
      if (photos.length) {
        await tx.userPhotoSnapshot.createMany({
          data: photos.map((photo) => ({
            userId: user.id,
            photoId: photo.photoId,
            url: photo.url,
            sortOrder: photo.sortOrder,
            isProfile: photo.isProfile,
          })),
        });
      }
    });

    this.logger.log(`Synced user ${user.id} from pubsub`);
  }

  private normalizeCampus(user: UserSnapshotPayload): NormalizedCampus | null {
    const campusId = user.campusId ?? user.campus?.id;
    const name = user.campusName ?? user.campus?.name;

    if (!campusId || !name) return null;

    return {
      campusId,
      name,
      address: user.campusAddress ?? user.campus?.address ?? null,
    };
  }

  private normalizeMajor(user: UserSnapshotPayload): NormalizedMajor | null {
    const majorId = user.majorId ?? user.major?.id;
    const name = user.majorName ?? user.major?.name;

    if (!majorId || !name) return null;

    return { majorId, name };
  }

  private normalizeHobbies(
    hobbies: UserSnapshotPayload['hobbies'],
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
    photos: UserSnapshotPayload['photos'],
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
