import { BadRequestException, Injectable } from '@nestjs/common';
import { MatchChatUserRepository } from '@/modules/match-chat/users/user.repository';

@Injectable()
export class MatchChatUserValidationService {
  constructor(private readonly userRepository: MatchChatUserRepository) {}

  async ensureActiveUsers(userIds: number[], context = 'match chat service') {
    const uniqueValues = Array.from(new Set(userIds.map(Number)));
    const uniqueUserIds = uniqueValues.filter(Number.isInteger);

    if (!uniqueValues.length) return;

    const users = await this.userRepository.findActiveUserIds(uniqueUserIds);
    const activeUserIds = new Set(users.map((user) => user.id));
    const missingUserIds = uniqueValues.filter(
      (userId) => !Number.isInteger(userId) || !activeUserIds.has(userId),
    );

    if (missingUserIds.length) {
      throw new BadRequestException(
        `User not synced to ${context}: ${missingUserIds.join(', ')}`,
      );
    }
  }
}
