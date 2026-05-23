import type { Prisma } from '@prisma/match-chat-client';

export const USER_PROFILE_INCLUDE = {
  campus: true,
  major: true,
  hobbies: {
    where: { hobby: { isActive: true } },
    include: { hobby: true },
    orderBy: { hobbyId: 'asc' as const },
  },
  photos: {
    orderBy: [{ sortOrder: 'asc' as const }, { photoId: 'asc' as const }],
  },
} satisfies Prisma.MsUserInclude;

export const MATCH_INCLUDE = {
  firstUser: {
    include: USER_PROFILE_INCLUDE,
  },
  secondUser: {
    include: USER_PROFILE_INCLUDE,
  },
} satisfies Prisma.UserMatchInclude;

export type MatchUserProfile = Prisma.MsUserGetPayload<{
  include: typeof USER_PROFILE_INCLUDE;
}>;

export type MatchRecord = Prisma.UserMatchGetPayload<{
  include: typeof MATCH_INCLUDE;
}>;
