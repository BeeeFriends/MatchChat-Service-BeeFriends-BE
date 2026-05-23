import type {
  MatchDto,
  MatchProfileDto,
} from '@beefriends/shared-kernel/dto';
import type {
  MatchRecord,
  MatchUserProfile,
} from '@/modules/match-chat/match-profile.prisma';

type ConversationPreview = {
  lastMessagePreview: string | null;
  lastMessageSenderId: number | null;
} | null;

export function toMatchDto(
  match: MatchRecord,
  userId: number,
  conversation: ConversationPreview,
): MatchDto {
  const matchedUser =
    match.firstUserId === userId ? match.secondUser : match.firstUser;

  return {
    id: match.id,
    userId,
    matchedUser: toProfileDto(matchedUser),
    conversationId: match.conversationId,
    status: match.status,
    isNew: !conversation?.lastMessagePreview,
    lastMessagePreview: conversation?.lastMessagePreview ?? null,
    lastMessageSenderId: conversation?.lastMessageSenderId ?? null,
    matchedAt: match.matchedAt,
  };
}

export function toProfileDto(user: MatchUserProfile): MatchProfileDto {
  return {
    id: user.id,
    displayName: user.displayName,
    binusianEmail: user.binusianEmail,
    phoneNumber: user.phoneNumber,
    gender: user.gender,
    age: user.age,
    binusianYear: user.binusianYear,
    description: user.description,
    profilePhotoUrl: user.profilePhotoUrl,
    campus: user.campus?.isActive
      ? {
          id: user.campus.id,
          name: user.campus.name,
          address: user.campus.address,
        }
      : null,
    major: user.major?.isActive
      ? {
          id: user.major.id,
          name: user.major.name,
        }
      : null,
    hobbies: user.hobbies.map((hobby) => ({
      id: hobby.hobby.id,
      name: hobby.hobby.name,
    })),
    photos: user.photos.map((photo) => ({
      id: photo.photoId,
      url: photo.url,
      sortOrder: photo.sortOrder,
      isProfile: photo.isProfile,
    })),
  };
}
