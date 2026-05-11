import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PUBSUB_CHANNELS, PubSubService } from '../../common/pub-sub';
import { MessageEncryptionService } from '../../common/crypto/message-encryption.service';
import { ChatService } from './match-chat.service';
import { PresenceService } from './presence.service';
import { CHAT_EVENTS, CreateMessageDto } from '@beefriends/shared-kernel/dto';
import type {
  MessageDto,
  PresenceDto,
  MessageReadEvent,
  TypingIndicatorEvent,
} from '@beefriends/shared-kernel/dto';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly presenceService: PresenceService,
    private readonly pubSub: PubSubService,
    private readonly messageEncryption: MessageEncryptionService,
  ) {}

  afterInit(server: Server) {
    this.presenceService.bindServer(server);
    void this.pubSub
      .subscribe(PUBSUB_CHANNELS.CHAT_MESSAGES, (payload) =>
        this.broadcastMessageCreated(payload),
      )
      .catch((error: Error) => {
        this.logger.error(
          `Failed to subscribe to chat messages: ${error.message}`,
          error.stack,
        );
      });
    void this.pubSub
      .subscribe(PUBSUB_CHANNELS.CHAT_READS, (payload) =>
        this.broadcastMessageRead(payload),
      )
      .catch((error: Error) => {
        this.logger.error(
          `Failed to subscribe to chat reads: ${error.message}`,
          error.stack,
        );
      });
  }

  async handleConnection(client: Socket) {
    const userId = this.getHandshakeUserId(client);
    if (userId) {
      await client.join(this.getUserRoom(userId));
      await this.presenceService.markOnline(userId, client.id);
    }

    this.logger.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    await this.presenceService.markOffline(client.id);
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(CHAT_EVENTS.JOIN_CONVERSATION)
  async handleJoinConversation(
    @MessageBody() data: { conversationId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    await this.chatService.ensureConversationExists(data.conversationId);
    await client.join(data.conversationId);
    this.logger.log(
      `User ${data.userId} joined conversation ${data.conversationId}`,
    );
  }

  @SubscribeMessage(CHAT_EVENTS.LEAVE_CONVERSATION)
  async handleLeaveConversation(
    @MessageBody() data: { conversationId: string; userId: number },
    @ConnectedSocket() client: Socket,
  ) {
    await client.leave(data.conversationId);
    this.logger.log(
      `User ${data.userId} left conversation ${data.conversationId}`,
    );
  }

  @SubscribeMessage(CHAT_EVENTS.SEND_MESSAGE)
  async handleSendMessage(
    @MessageBody() data: CreateMessageDto & { senderId: number },
  ): Promise<MessageDto> {
    const message = await this.chatService.createMessage(
      data,
      Number(data.senderId),
    );

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
  async handleMessageRead(
    @MessageBody() data: MessageReadEvent,
    @ConnectedSocket() _client: Socket,
  ) {
    const message = await this.chatService.markMessageRead(
      data.conversationId,
      data.messageId,
      Number(data.userId),
    );
    const event: MessageReadEvent = {
      conversationId: data.conversationId,
      messageId: message.id,
      userId: Number(data.userId),
    };

    await this.chatService.publishMessageRead(event);

    return event;
  }

  @SubscribeMessage(CHAT_EVENTS.PRESENCE_GET)
  getPresence(
    @MessageBody() data: { userIds: number[] },
  ): Promise<PresenceDto[]> {
    return this.presenceService.getStatuses(data.userIds ?? []);
  }

  private getHandshakeUserId(client: Socket) {
    const auth = client.handshake.auth as { userId?: unknown };
    const query = client.handshake.query as { userId?: string | string[] };
    const rawUserId: unknown = auth.userId ?? query.userId;
    const value: unknown = Array.isArray(rawUserId)
      ? (rawUserId as unknown[])[0]
      : rawUserId;
    const userId = Number(value);

    return Number.isInteger(userId) && userId > 0 ? userId : null;
  }

  private getUserRoom(userId: number) {
    return `user:${userId}`;
  }

  private getRealtimeRooms(conversationId: string, userIds: number[]) {
    return [
      conversationId,
      ...Array.from(new Set(userIds)).map((userId) => this.getUserRoom(userId)),
    ];
  }

  private broadcastMessageCreated(payload: unknown) {
    if (!this.isMessageCreatedPayload(payload)) return;

    this.server
      .to(
        this.getRealtimeRooms(
          payload.conversationId,
          payload.participantIds ?? [],
        ),
      )
      .emit(CHAT_EVENTS.MESSAGE_RECEIVED, this.decryptMessage(payload.message));
  }

  private broadcastMessageRead(payload: unknown) {
    if (!this.isMessageReadPayload(payload)) return;

    const event: MessageReadEvent = {
      conversationId: payload.conversationId,
      messageId: payload.messageId,
      userId: payload.userId,
    };

    this.server
      .to(
        this.getRealtimeRooms(
          payload.conversationId,
          payload.participantIds ?? [],
        ),
      )
      .emit(CHAT_EVENTS.MESSAGE_READ, event);
  }

  private isMessageCreatedPayload(payload: unknown): payload is {
    type: 'message.created';
    conversationId: string;
    participantIds?: number[];
    message: MessageDto;
  } {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'type' in payload &&
      payload.type === 'message.created' &&
      'conversationId' in payload &&
      typeof payload.conversationId === 'string' &&
      'message' in payload &&
      typeof payload.message === 'object' &&
      payload.message !== null &&
      'id' in payload.message &&
      typeof payload.message.id === 'string'
    );
  }

  private isMessageReadPayload(payload: unknown): payload is {
    type: 'message.read';
    conversationId: string;
    messageId: string;
    userId: number;
    participantIds?: number[];
  } {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'type' in payload &&
      payload.type === 'message.read' &&
      'conversationId' in payload &&
      typeof payload.conversationId === 'string' &&
      'messageId' in payload &&
      typeof payload.messageId === 'string' &&
      'userId' in payload &&
      typeof payload.userId === 'number'
    );
  }

  private decryptMessage(message: MessageDto): MessageDto {
    return {
      ...message,
      content: this.messageEncryption.decrypt(message.content),
    };
  }
}
