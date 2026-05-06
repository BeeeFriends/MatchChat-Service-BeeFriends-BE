import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MatchChatService } from './match-chat.service';

@ApiTags('match-chat')
@Controller('match-chat')
export class MatchChatController {
  constructor(private readonly service: MatchChatService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }
}
