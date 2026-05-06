import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ChatService } from './match-chat.service';
import {
  CreateMessageDto,
  CreateConversationDto,
  CHAT_ENDPOINTS
} from '@beefriends/shared-kernel';
import { MessageDto, ConversationDto } from './swagger.dto';

@ApiTags('messages')
@Controller('api/v1/chat/messages')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Send a message' })
  @ApiResponse({ status: 201, description: 'Message sent successfully', type: MessageDto })
  async sendMessage(@Body() createMessageDto: CreateMessageDto, @Query('senderId') senderId: string): Promise<MessageDto> {
    return this.chatService.createMessage(createMessageDto, senderId);
  }

  @Get('conversation/:conversationId')
  @ApiOperation({ summary: 'Get messages for a conversation' })
  @ApiParam({ name: 'conversationId', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Messages retrieved successfully', type: [MessageDto] })
  async getMessages(@Param('conversationId') conversationId: string): Promise<MessageDto[]> {
    return this.chatService.getMessages(conversationId);
  }
}

@ApiTags('conversations')
@Controller('api/v1/chat/conversations')
export class ConversationController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  @ApiOperation({ summary: 'Create a conversation' })
  @ApiResponse({ status: 201, description: 'Conversation created successfully', type: ConversationDto })
  async createConversation(@Body() createConversationDto: CreateConversationDto): Promise<ConversationDto> {
    return this.chatService.createConversation(createConversationDto);
  }

  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user conversations' })
  @ApiParam({ name: 'userId', description: 'User ID' })
  @ApiResponse({ status: 200, description: 'Conversations retrieved successfully', type: [ConversationDto] })
  async getUserConversations(@Param('userId') userId: string): Promise<ConversationDto[]> {
    return this.chatService.getConversations(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation by ID' })
  @ApiParam({ name: 'id', description: 'Conversation ID' })
  @ApiResponse({ status: 200, description: 'Conversation retrieved successfully', type: ConversationDto })
  async getConversation(@Param('id') id: string): Promise<ConversationDto> {
    const conversation = this.chatService.getConversation(id);
    if (!conversation) {
      throw new Error('Conversation not found');
    }
    return conversation;
  }
}