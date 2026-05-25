import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class MatchChatUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveUserIds(userIds: number[]) {
    return this.prisma.msUser.findMany({
      where: {
        id: { in: userIds },
        isActive: true,
      },
      select: { id: true },
    });
  }
}
