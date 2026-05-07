import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type {
  CampusEventPayload,
  DepartmentEventPayload,
} from '@beefriends/shared-kernel';
import { PUBSUB_CHANNELS, PubSubService } from '../../../common/pub-sub';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ProfileMasterSyncService implements OnModuleInit {
  private readonly logger = new Logger(ProfileMasterSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pubSub: PubSubService,
  ) {}

  async onModuleInit() {
    await this.pubSub.subscribe(
      PUBSUB_CHANNELS.CAMPUS_EVENTS,
      (payload) => this.handleCampusEvent(payload),
      {
        consumerId: 'match-chat-campus-sync',
        durable: true,
        replayFromStart: true,
      },
    );
    await this.pubSub.subscribe(
      PUBSUB_CHANNELS.DEPARTMENT_EVENTS,
      (payload) => this.handleDepartmentEvent(payload),
      {
        consumerId: 'match-chat-department-sync',
        durable: true,
        replayFromStart: true,
      },
    );
  }

  private async handleCampusEvent(payload: unknown) {
    if (!this.isCampusEventPayload(payload)) return;

    if (payload.type === 'campus.deleted') {
      await this.prisma.campus.updateMany({
        where: { id: payload.campusId },
        data: { isActive: false, syncedAt: new Date() },
      });
      return;
    }

    await this.prisma.campus.upsert({
      where: { id: payload.campus.id },
      update: {
        name: payload.campus.name,
        address: payload.campus.address,
        isActive: true,
        syncedAt: new Date(),
      },
      create: {
        id: payload.campus.id,
        name: payload.campus.name,
        address: payload.campus.address,
        isActive: true,
        syncedAt: new Date(),
      },
    });

    this.logger.log(`Synced campus ${payload.campus.id} from pubsub`);
  }

  private async handleDepartmentEvent(payload: unknown) {
    if (!this.isDepartmentEventPayload(payload)) return;

    if (payload.type === 'department.deleted') {
      await this.prisma.major.updateMany({
        where: { id: payload.departmentId },
        data: { isActive: false, syncedAt: new Date() },
      });
      return;
    }

    await this.prisma.major.upsert({
      where: { id: payload.department.id },
      update: {
        name: payload.department.name,
        isActive: true,
        syncedAt: new Date(),
      },
      create: {
        id: payload.department.id,
        name: payload.department.name,
        isActive: true,
        syncedAt: new Date(),
      },
    });

    this.logger.log(`Synced department ${payload.department.id} from pubsub`);
  }

  private isCampusEventPayload(
    payload: unknown,
  ): payload is CampusEventPayload {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('type' in payload)
    ) {
      return false;
    }

    if (payload.type === 'campus.deleted') {
      return 'campusId' in payload && Number.isInteger(payload.campusId);
    }

    return (
      (payload.type === 'campus.synced' ||
        payload.type === 'campus.created' ||
        payload.type === 'campus.updated') &&
      'campus' in payload &&
      typeof payload.campus === 'object' &&
      payload.campus !== null &&
      'id' in payload.campus &&
      Number.isInteger(payload.campus.id) &&
      'name' in payload.campus &&
      typeof payload.campus.name === 'string'
    );
  }

  private isDepartmentEventPayload(
    payload: unknown,
  ): payload is DepartmentEventPayload {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('type' in payload)
    ) {
      return false;
    }

    if (payload.type === 'department.deleted') {
      return (
        'departmentId' in payload && Number.isInteger(payload.departmentId)
      );
    }

    return (
      (payload.type === 'department.synced' ||
        payload.type === 'department.created' ||
        payload.type === 'department.updated') &&
      'department' in payload &&
      typeof payload.department === 'object' &&
      payload.department !== null &&
      'id' in payload.department &&
      Number.isInteger(payload.department.id) &&
      'name' in payload.department &&
      typeof payload.department.name === 'string'
    );
  }
}
