import { Injectable } from '@nestjs/common';

@Injectable()
export class MatchChatService {
  findAll() {
    return [
      'candidate-match',
      'active-chat',
      'message-thread',
    ];
  }
}
