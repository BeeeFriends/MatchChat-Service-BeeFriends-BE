export type MessageRecord = {
  id: string;
  conversationId: string;
  senderId: number;
  content: string;
  attachmentUrls: string[];
  isEdited: boolean;
  isDeleted: boolean;
  readBy: number[];
  replyToMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ConversationRecord = {
  id: string;
  name: string | null;
  description: string | null;
  isGroup: boolean;
  lastMessageId: string | null;
  lastMessagePreview: string | null;
  lastMessageSenderId: number | null;
  createdAt: Date;
  updatedAt: Date;
  participants?: { userId: number }[];
  messages?: MessageRecord[];
  _count?: {
    messages?: number;
  };
};
