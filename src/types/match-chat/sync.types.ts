import type {
  CampusEventPayload,
  DepartmentEventPayload,
  HobbyEventPayload,
  UserEventPayload,
} from '@beefriends/shared-kernel';

export type SyncedUser = {
  id: number;
  displayName?: string | null;
  binusianEmail?: string | null;
  phoneNumber?: string | null;
  gender?: string | null;
  age?: number | null;
  binusianYear?: number | null;
  description?: string | null;
  profilePhotoUrl?: string | null;
};

export type NormalizedCampus = {
  campusId: number;
  name: string;
  address: string | null;
};

export type NormalizedMajor = {
  majorId: number;
  name: string;
};

export type NormalizedHobby = {
  hobbyId: number;
  name: string;
};

export type NormalizedPhoto = {
  photoId: number;
  url: string;
  sortOrder: number;
  isProfile: boolean;
};

export type SyncedUserPayload = Extract<
  UserEventPayload,
  { user: unknown }
>['user'];

export type SyncedCampusPayload = Extract<
  CampusEventPayload,
  { campus: unknown }
>['campus'];

export type SyncedDepartmentPayload = Extract<
  DepartmentEventPayload,
  { department: unknown }
>['department'];

export type SyncedHobbyPayload = Extract<
  HobbyEventPayload,
  { hobby: unknown }
>['hobby'];
