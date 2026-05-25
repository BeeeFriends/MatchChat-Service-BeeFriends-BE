import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class PresenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findInstanceUserSessions(instanceId: string) {
    return this.prisma.presenceSession.findMany({
      where: { instanceId },
      select: { userId: true },
      distinct: ['userId'],
    });
  }

  deleteInstanceSessions(instanceId: string) {
    return this.prisma.presenceSession.deleteMany({
      where: { instanceId },
    });
  }

  countUserSessions(userId: number) {
    return this.prisma.presenceSession.count({
      where: { userId },
    });
  }

  markOnline(userId: number, socketId: string, instanceId: string) {
    return this.prisma.$transaction(async (tx) => {
      const existingSessions = await tx.presenceSession.count({
        where: { userId },
      });

      await tx.presenceSession.upsert({
        where: { socketId },
        update: {
          userId,
          instanceId,
        },
        create: {
          userId,
          socketId,
          instanceId,
        },
      });

      return existingSessions === 0;
    });
  }

  markOffline(socketId: string) {
    return this.prisma.$transaction(async (tx) => {
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
  }

  findOnlineUserIds(userIds: number[]) {
    return this.prisma.presenceSession.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true },
      distinct: ['userId'],
    });
  }
}
