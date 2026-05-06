import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ChatService } from './match-chat.service';
import {
  ConversationDto,
  ConversationWithMessagesDto,
  CreateConversationDto,
  CreateMessageDto,
  MessageDto,
  PresenceDto,
  PresenceQueryDto,
} from '@beefriends/shared-kernel/dto';
import { PresenceService } from './presence.service';

@ApiTags('messages')
@Controller('messages')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message' })
  @ApiQuery({ name: 'senderId', type: Number })
  @ApiResponse({
    status: 201,
    description: 'Message sent successfully',
    type: MessageDto,
  })
  sendMessage(
    @Body() createMessageDto: CreateMessageDto,
    @Query('senderId', ParseIntPipe) senderId: number,
  ): Promise<MessageDto> {
    return this.chatService.createMessage(createMessageDto, senderId);
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({
    status: 200,
    description: 'Messages retrieved successfully',
    type: [MessageDto],
  })
  getMessages(
    @Param('conversationId') conversationId: string,
  ): Promise<MessageDto[]> {
    return this.chatService.getMessages(conversationId);
  }
}

@ApiTags('conversations')
@Controller('conversations')
export class ConversationController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Create a conversation' })
  @ApiResponse({
    status: 201,
    description: 'Conversation created successfully',
    type: ConversationDto,
  })
  createConversation(
    @Body() createConversationDto: CreateConversationDto,
  ): Promise<ConversationDto> {
    return this.chatService.createConversation(createConversationDto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user conversations' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Conversations retrieved successfully',
    type: [ConversationDto],
  })
  getUserConversations(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<ConversationDto[]> {
    return this.chatService.getConversations(userId);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Get conversation with messages' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({
    status: 200,
    description: 'Conversation and messages retrieved successfully',
    type: ConversationWithMessagesDto,
  })
  async getConversationWithMessages(
    @Param('id') id: string,
  ): Promise<ConversationWithMessagesDto> {
    const conversation = await this.chatService.getConversationWithMessages(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation by ID' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({
    status: 200,
    description: 'Conversation retrieved successfully',
    type: ConversationDto,
  })
  async getConversation(@Param('id') id: string): Promise<ConversationDto> {
    const conversation = await this.chatService.getConversation(id);
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}

@ApiTags('presence')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get(':userId')
  @ApiOperation({ summary: 'Get user online status' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Presence status retrieved successfully',
    type: PresenceDto,
  })
  getPresence(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<PresenceDto> {
    return this.presenceService.getStatus(userId);
  }

  @Post('batch')
  @ApiOperation({ summary: 'Get online status for multiple users' })
  @ApiResponse({
    status: 200,
    description: 'Presence statuses retrieved successfully',
    type: [PresenceDto],
  })
  getPresenceBatch(@Body() dto: PresenceQueryDto): Promise<PresenceDto[]> {
    return this.presenceService.getStatuses(dto.userIds);
  }
}
