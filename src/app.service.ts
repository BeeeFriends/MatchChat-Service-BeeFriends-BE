import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AppService {
  constructor(private readonly configService: ConfigService) {}

  getHealth() {
    return {
      status: 'ok',
      service: this.configService.get<string>('serviceName'),
      timestamp: new Date().toISOString(),
    };
  }
}
