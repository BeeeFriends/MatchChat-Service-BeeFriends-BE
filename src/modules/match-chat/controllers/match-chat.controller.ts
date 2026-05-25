import {
  Body,
  Controller,
  Delete,
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
import { ChatService } from '@/modules/match-chat/chat/chat.service';
import {
  ConversationDto,
  ConversationWithMessagesDto,
  CreateConversationDto,
  CreateMessageDto,
  DiscoverMatchesQueryDto,
  MatchDto,
  MatchProfileCampusDto,
  MatchProfileHobbyDto,
  MatchProfileMajorDto,
  MatchProfileDto,
  MessageDto,
  PresenceDto,
  PresenceQueryDto,
  SwipeResultDto,
  SwipeUserDto,
} from '@beefriends/shared-kernel/dto';
import { PresenceService } from '@/modules/match-chat/presence/presence.service';
import { ChatNotificationService } from '@/modules/match-chat/chat/chat-notification.service';
import { MatchService } from '@/modules/match-chat/match/match.service';

@ApiTags('messages')
@Controller('messages')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatNotificationService: ChatNotificationService,
  ) {}

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

  @Post(':messageId/read')
  @ApiOperation({ summary: 'Mark a message as read' })
  @ApiParam({ name: 'messageId', description: 'Message ID' })
  @ApiQuery({ name: 'conversationId', type: String })
  @ApiQuery({ name: 'userId', type: Number })
  @ApiResponse({
    status: 201,
    description: 'Message marked as read',
    type: MessageDto,
  })
  async markMessageRead(
    @Param('messageId') messageId: string,
    @Query('conversationId') conversationId: string,
    @Query('userId', ParseIntPipe) userId: number,
  ): Promise<MessageDto> {
    const message = await this.chatService.markMessageRead(
      conversationId,
      messageId,
      userId,
    );

    await this.chatNotificationService.publishMessageRead({
      conversationId,
      messageId: message.id,
      userId,
    });

    return message;
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

@ApiTags('matches')
@Controller('matches')
export class MatchController {
  constructor(private readonly matchService: MatchService) {}

  @Get('discover')
  @ApiOperation({ summary: 'Discover match candidates' })
  @ApiResponse({
    status: 200,
    description: 'Match candidates retrieved successfully',
    type: [MatchProfileDto],
  })
  discover(
    @Query() query: DiscoverMatchesQueryDto,
  ): Promise<MatchProfileDto[]> {
    return this.matchService.discover(query);
  }

  @Post('swipe')
  @ApiOperation({ summary: 'Like or pass a user' })
  @ApiResponse({
    status: 201,
    description: 'Swipe recorded successfully',
    type: SwipeResultDto,
  })
  swipe(@Body() dto: SwipeUserDto): Promise<SwipeResultDto> {
    return this.matchService.swipe(dto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user matches' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({
    status: 200,
    description: 'Matches retrieved successfully',
    type: [MatchDto],
  })
  getUserMatches(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<MatchDto[]> {
    return this.matchService.getMatches(userId);
  }

  @Get('campuses')
  @ApiOperation({ summary: 'Get synced campuses for match filters' })
  @ApiResponse({
    status: 200,
    description: 'Campuses retrieved successfully',
    type: [MatchProfileCampusDto],
  })
  getCampuses(): Promise<MatchProfileCampusDto[]> {
    return this.matchService.getCampuses();
  }

  @Get('majors')
  @ApiOperation({ summary: 'Get synced majors for match filters' })
  @ApiResponse({
    status: 200,
    description: 'Majors retrieved successfully',
    type: [MatchProfileMajorDto],
  })
  getMajors(): Promise<MatchProfileMajorDto[]> {
    return this.matchService.getMajors();
  }

  @Get('hobbies')
  @ApiOperation({ summary: 'Get synced hobbies for match filters' })
  @ApiResponse({
    status: 200,
    description: 'Hobbies retrieved successfully',
    type: [MatchProfileHobbyDto],
  })
  getHobbies(): Promise<MatchProfileHobbyDto[]> {
    return this.matchService.getHobbies();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get match by ID' })
  @ApiParam({ name: 'id', description: 'Match ID' })
  @ApiQuery({ name: 'userId', type: Number })
  @ApiResponse({
    status: 200,
    description: 'Match retrieved successfully',
    type: MatchDto,
  })
  getMatch(
    @Param('id') id: string,
    @Query('userId', ParseIntPipe) userId: number,
  ): Promise<MatchDto> {
    return this.matchService.getMatchByIdForUser(id, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Unmatch a user' })
  @ApiParam({ name: 'id', description: 'Match ID' })
  @ApiQuery({ name: 'userId', type: Number })
  @ApiResponse({
    status: 200,
    description: 'User unmatched successfully',
    type: MatchDto,
  })
  unmatch(
    @Param('id') id: string,
    @Query('userId', ParseIntPipe) userId: number,
  ): Promise<MatchDto> {
    return this.matchService.unmatch(id, userId);
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
