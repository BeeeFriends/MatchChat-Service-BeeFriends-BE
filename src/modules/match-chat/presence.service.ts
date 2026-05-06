import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Server } from 'socket.io';
import { PUBSUB_CHANNELS, PubSubService } from '../../common/pub-sub';
import { PrismaService } from '../../prisma/prisma.service';
import { CHAT_EVENTS, PresenceDto } from '@beefriends/shared-kernel/dto';

type PresenceChangePayload = PresenceDto & {
  type: 'presence.changed';
  socketId: string;
  instanceId: string;
  timestamp: string;
};

@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly instanceId =
    process.env.RAILWAY_REPLICA_ID ??
    process.env.HOSTNAME ??
    `match-chat-${randomUUID()}`;
  private server?: Server;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: PubSubService,
  ) {}

  async onModuleInit() {
    await this.pubSub.subscribe(PUBSUB_CHANNELS.PRESENCE, (payload) =>
      this.broadcastPresenceChange(payload),
    );
  }

  async onModuleDestroy() {
    try {
      const sessions = await this.prisma.presenceSession.findMany({
        where: { instanceId: this.instanceId },
        select: { userId: true },
        distinct: ['userId'],
      });

      await this.prisma.presenceSession.deleteMany({
        where: { instanceId: this.instanceId },
      });

      for (const session of sessions) {
        const remainingSessions = await this.prisma.presenceSession.count({
          where: { userId: session.userId },
        });

        if (!remainingSessions) {
          await this.publishPresenceChange(session.userId, false, 'shutdown');
        }
      }
    } catch {
      this.logger.warn('Failed to clean up presence sessions on shutdown');
    }
  }

  bindServer(server: Server) {
    this.server = server;
  }

  async markOnline(userId: number, socketId: string) {
    const shouldPublish = await this.prisma.$transaction(async (tx) => {
      const existingSessions = await tx.presenceSession.count({
        where: { userId },
      });

      await tx.presenceSession.upsert({
        where: { socketId },
        update: {
          userId,
          instanceId: this.instanceId,
        },
        create: {
          userId,
          socketId,
          instanceId: this.instanceId,
        },
      });

      return existingSessions === 0;
    });

    if (shouldPublish) {
      await this.publishPresenceChange(userId, true, socketId);
    }
  }

  async markOffline(socketId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const session = await tx.presenceSession.findUnique({
        where: { socketId },
      });

      if (!session) return null;

      await tx.presenceSession.delete({ where: { socketId } });

      const remainingSessions = await tx.presenceSession.count({
        where: { userId: session.userId },
      });

      return {
        userId: session.userId,
        isOffline: remainingSessions === 0,
      };
    });

    if (result?.isOffline) {
      await this.publishPresenceChange(result.userId, false, socketId);
    }
  }

  async getStatus(userId: number): Promise<PresenceDto> {
    const sessionCount = await this.prisma.presenceSession.count({
      where: { userId },
    });

    return { userId, isOnline: sessionCount > 0 };
  }

  async getStatuses(userIds: number[]): Promise<PresenceDto[]> {
    const uniqueUserIds = Array.from(
      new Set(userIds.map((userId) => Number(userId)).filter(Number.isInteger)),
    );

    if (!uniqueUserIds.length) return [];

    const onlineUsers = await this.prisma.presenceSession.findMany({
      where: { userId: { in: uniqueUserIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const onlineUserIds = new Set(onlineUsers.map((user) => user.userId));

    return uniqueUserIds.map((userId) => ({
      userId,
      isOnline: onlineUserIds.has(userId),
    }));
  }

  private async publishPresenceChange(
    userId: number,
    isOnline: boolean,
    socketId: string,
  ) {
    await this.pubSub.publish(PUBSUB_CHANNELS.PRESENCE, {
      type: 'presence.changed',
      userId,
      isOnline,
      socketId,
      instanceId: this.instanceId,
      timestamp: new Date().toISOString(),
    } satisfies PresenceChangePayload);
  }

  private broadcastPresenceChange(payload: unknown) {
    if (!this.isPresenceChangePayload(payload)) return;

    this.server?.emit(CHAT_EVENTS.PRESENCE_CHANGED, {
      userId: payload.userId,
      isOnline: payload.isOnline,
      timestamp: payload.timestamp,
    });
  }

  private isPresenceChangePayload(
    payload: unknown,
  ): payload is PresenceChangePayload {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'type' in payload &&
      payload.type === 'presence.changed' &&
      'userId' in payload &&
      Number.isInteger(payload.userId) &&
      'isOnline' in payload &&
      typeof payload.isOnline === 'boolean' &&
      'socketId' in payload &&
      typeof payload.socketId === 'string' &&
      'instanceId' in payload &&
      typeof payload.instanceId === 'string' &&
      'timestamp' in payload &&
      typeof payload.timestamp === 'string'
    );
  }
}
