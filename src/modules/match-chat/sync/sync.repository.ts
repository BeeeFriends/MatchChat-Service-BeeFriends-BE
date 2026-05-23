import { Injectable } from '@nestjs/common';
import type {
  CampusEventPayload,
  DepartmentEventPayload,
  HobbyEventPayload,
} from '@beefriends/shared-kernel';
import { PrismaService } from '@/prisma/prisma.service';

type SyncedUser = {
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

type NormalizedCampus = {
  campusId: number;
  name: string;
  address: string | null;
};

type NormalizedMajor = {
  majorId: number;
  name: string;
};

type NormalizedHobby = {
  hobbyId: number;
  name: string;
};

type NormalizedPhoto = {
  photoId: number;
  url: string;
  sortOrder: number;
  isProfile: boolean;
};

@Injectable()
export class SyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  deactivateUser(userId: number) {
    return this.prisma.msUser.updateMany({
      where: { id: userId },
      data: { isActive: false, syncedAt: new Date() },
    });
  }

  syncUser(
    user: SyncedUser,
    campus: NormalizedCampus | null,
    major: NormalizedMajor | null,
    hobbies: NormalizedHobby[],
    photos: NormalizedPhoto[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      const syncedAt = new Date();

      if (campus) {
        await tx.msCampus.upsert({
          where: { id: campus.campusId },
          update: {
            name: campus.name,
            address: campus.address,
            isActive: true,
            syncedAt,
          },
          create: {
            id: campus.campusId,
            name: campus.name,
            address: campus.address,
            isActive: true,
            syncedAt,
          },
        });
      }

      if (major) {
        await tx.msDepartment.upsert({
          where: { id: major.majorId },
          update: {
            name: major.name,
            isActive: true,
            syncedAt,
          },
          create: {
            id: major.majorId,
            name: major.name,
            isActive: true,
            syncedAt,
          },
        });
      }

      await tx.msUser.upsert({
        where: { id: user.id },
        update: {
          displayName: user.displayName,
          binusianEmail: user.binusianEmail,
          phoneNumber: user.phoneNumber,
          gender: user.gender,
          age: user.age,
          binusianYear: user.binusianYear,
          description: user.description,
          profilePhotoUrl: user.profilePhotoUrl,
          campusId: campus?.campusId ?? null,
          majorId: major?.majorId ?? null,
          isActive: true,
          syncedAt,
        },
        create: {
          id: user.id,
          displayName: user.displayName,
          binusianEmail: user.binusianEmail,
          phoneNumber: user.phoneNumber,
          gender: user.gender,
          age: user.age,
          binusianYear: user.binusianYear,
          description: user.description,
          profilePhotoUrl: user.profilePhotoUrl,
          campusId: campus?.campusId ?? null,
          majorId: major?.majorId ?? null,
          isActive: true,
          syncedAt,
        },
      });

      await tx.trUserHobby.deleteMany({ where: { userId: user.id } });
      if (hobbies.length) {
        for (const hobby of hobbies) {
          await tx.msHobby.upsert({
            where: { id: hobby.hobbyId },
            update: {
              name: hobby.name,
              isActive: true,
              syncedAt,
            },
            create: {
              id: hobby.hobbyId,
              name: hobby.name,
              isActive: true,
              syncedAt,
            },
          });
        }

        await tx.trUserHobby.createMany({
          data: hobbies.map((hobby) => ({
            userId: user.id,
            hobbyId: hobby.hobbyId,
          })),
        });
      }

      await tx.trUserPhoto.deleteMany({ where: { userId: user.id } });
      if (photos.length) {
        await tx.trUserPhoto.createMany({
          data: photos.map((photo) => ({
            userId: user.id,
            photoId: photo.photoId,
            url: photo.url,
            sortOrder: photo.sortOrder,
            isProfile: photo.isProfile,
          })),
        });
      }
    });
  }

  deactivateCampus(campusId: number) {
    return this.prisma.msCampus.updateMany({
      where: { id: campusId },
      data: { isActive: false, syncedAt: new Date() },
    });
  }

  syncCampus(campus: Extract<CampusEventPayload, { campus: unknown }>['campus']) {
    return this.prisma.msCampus.upsert({
      where: { id: campus.id },
      update: {
        name: campus.name,
        address: campus.address,
        isActive: true,
        syncedAt: new Date(),
      },
      create: {
        id: campus.id,
        name: campus.name,
        address: campus.address,
        isActive: true,
        syncedAt: new Date(),
      },
    });
  }

  deactivateDepartment(departmentId: number) {
    return this.prisma.msDepartment.updateMany({
      where: { id: departmentId },
      data: { isActive: false, syncedAt: new Date() },
    });
  }

  syncDepartment(
    department: Extract<DepartmentEventPayload, { department: unknown }>['department'],
  ) {
    return this.prisma.msDepartment.upsert({
      where: { id: department.id },
      update: {
        name: department.name,
        isActive: true,
        syncedAt: new Date(),
      },
      create: {
        id: department.id,
        name: department.name,
        isActive: true,
        syncedAt: new Date(),
      },
    });
  }

  deleteHobbyRelationsAndDeactivate(hobbyId: number) {
    return this.prisma.$transaction(async (tx) => {
      await tx.trUserHobby.deleteMany({
        where: { hobbyId },
      });
      await tx.msHobby.updateMany({
        where: { id: hobbyId },
        data: { isActive: false, syncedAt: new Date() },
      });
    });
  }

  syncHobby(hobby: Extract<HobbyEventPayload, { hobby: unknown }>['hobby']) {
    return this.prisma.msHobby.upsert({
      where: { id: hobby.id },
      update: {
        name: hobby.name,
        isActive: true,
        syncedAt: new Date(),
      },
      create: {
        id: hobby.id,
        name: hobby.name,
        isActive: true,
        syncedAt: new Date(),
      },
    });
  }
}
