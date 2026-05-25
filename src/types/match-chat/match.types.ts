import { Prisma } from '@prisma/match-chat-client';

export const USER_PROFILE_INCLUDE = {
  campus: true,
  major: true,
  hobbies: {
    include: {
      hobby: true,
    },
  },
  photos: {
    orderBy: {
      sortOrder: 'asc' as const,
    },
  },
} satisfies Prisma.MsUserInclude;

export const MATCH_INCLUDE = {
  firstUser: { include: USER_PROFILE_INCLUDE },
  secondUser: { include: USER_PROFILE_INCLUDE },
} satisfies Prisma.UserMatchInclude;

export type MatchUserProfile = Prisma.MsUserGetPayload<{
  include: typeof USER_PROFILE_INCLUDE;
}>;

export type MatchRecord = Prisma.UserMatchGetPayload<{
  include: typeof MATCH_INCLUDE;
}>;

export type MatchPair = {
  firstUserId: number;
  secondUserId: number;
};

export type SwipeTransactionResult = {
  isMatch: boolean;
  matchId: string | null;
  shouldNotify?: boolean;
};

export type ConversationPreview = {
  lastMessagePreview: string | null;
  lastMessageSenderId: number | null;
} | null;
