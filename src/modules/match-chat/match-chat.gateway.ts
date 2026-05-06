import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  WebSocketServer,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ChatService } from './match-chat.service';
import {
  CreateMessageDto,
  MessageDto,
  CHAT_EVENTS,
  TypingIndicatorEvent,
  MessageReadEvent
} from '@beefriends/shared-kernel';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('ChatGateway');

  constructor(private readonly chatService: ChatService) {}

  handleConnection(client: Socket, ...args: any[]) {
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(CHAT_EVENTS.JOIN_CONVERSATION)
  handleJoinConversation(
    @MessageBody() data: { conversationId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(data.conversationId);
    this.logger.log(`User ${data.userId} joined conversation ${data.conversationId}`);
  }

  @SubscribeMessage(CHAT_EVENTS.LEAVE_CONVERSATION)
  handleLeaveConversation(
    @MessageBody() data: { conversationId: string; userId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(data.conversationId);
    this.logger.log(`User ${data.userId} left conversation ${data.conversationId}`);
  }

  @SubscribeMessage(CHAT_EVENTS.SEND_MESSAGE)
  async handleSendMessage(
    @MessageBody() data: CreateMessageDto & { senderId: string },
    @ConnectedSocket() client: Socket,
  ): Promise<MessageDto> {
    const message = await this.chatService.createMessage(data, data.senderId);

    // Emit to all participants in the conversation
    this.server.to(data.conversationId).emit(CHAT_EVENTS.MESSAGE_RECEIVED, message);

    this.logger.log(`Message sent in conversation ${data.conversationId}`);
    return message;
  }

  @SubscribeMessage(CHAT_EVENTS.TYPING_START)
  handleTypingStart(
    @MessageBody() data: TypingIndicatorEvent,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.conversationId).emit(CHAT_EVENTS.TYPING_START, data);
  }

  @SubscribeMessage(CHAT_EVENTS.TYPING_STOP)
  handleTypingStop(
    @MessageBody() data: TypingIndicatorEvent,
    @ConnectedSocket() client: Socket,
  ) {
    client.to(data.conversationId).emit(CHAT_EVENTS.TYPING_STOP, data);
  }

  @SubscribeMessage(CHAT_EVENTS.MESSAGE_READ)
  handleMessageRead(
    @MessageBody() data: MessageReadEvent,
    @ConnectedSocket() client: Socket,
  ) {
    // Broadcast to other participants that message was read
    client.to(data.conversationId).emit(CHAT_EVENTS.MESSAGE_READ, data);
  }
}