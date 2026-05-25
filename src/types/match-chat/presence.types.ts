import type { PresenceDto } from '@beefriends/shared-kernel/dto';

export type PresenceChangePayload = PresenceDto & {
  type: 'presence.changed';
  socketId: string;
  instanceId: string;
  timestamp: string;
};
