import { ApiProperty } from '@nestjs/swagger';

export class MessageDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  conversationId: string;

  @ApiProperty()
  senderId: string;

  @ApiProperty()
  content: string;

  @ApiProperty()
  timestamp: Date;

  @ApiProperty({ enum: ['text', 'image', 'file'] })
  messageType: 'text' | 'image' | 'file';

  @ApiProperty({ required: false })
  attachmentUrls?: string[];

  @ApiProperty()
  isEdited: boolean;

  @ApiProperty()
  isDeleted: boolean;

  @ApiProperty({ required: false })
  readBy?: string[];

  @ApiProperty({ required: false })
  replyToMessageId?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class ConversationDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  participants: string[];

  @ApiProperty()
  participantIds: string[];

  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty()
  isGroup: boolean;

  @ApiProperty({ required: false })
  lastMessageId?: string;

  @ApiProperty({ required: false })
  lastMessagePreview?: string;

  @ApiProperty({ required: false })
  lastMessageSenderId?: string;

  @ApiProperty({ required: false, type: MessageDto })
  lastMessage?: MessageDto;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}