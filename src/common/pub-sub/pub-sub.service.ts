import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Client } from 'pg';
import type { Notification } from 'pg';

export const PUBSUB_CHANNELS = {
  CHAT_MESSAGES: 'match_chat_messages',
  PRESENCE: 'match_chat_presence',
} as const;

type PubSubHandler = (payload: unknown) => Promise<void> | void;

@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private readonly handlers = new Map<string, Set<PubSubHandler>>();
  private readonly listeningChannels = new Set<string>();
  private publisher?: Client;
  private listener?: Client;

  async onModuleInit() {
    const connectionString = process.env.MATCH_CHAT_DATABASE_URL;
    if (!connectionString) {
      this.logger.warn(
        'MATCH_CHAT_DATABASE_URL is not set; pubsub is local only',
      );
      return;
    }

    this.publisher = new Client({ connectionString });
    this.listener = new Client({ connectionString });
    this.listener.on('notification', (notification) =>
      this.handleNotification(notification),
    );

    await this.publisher.connect();
    await this.listener.connect();

    for (const channel of this.handlers.keys()) {
      await this.listen(channel);
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.publisher?.end(), this.listener?.end()]);
  }

  async publish(channel: string, payload: unknown) {
    this.assertChannel(channel);

    if (!this.publisher) {
      this.dispatch(channel, payload);
      return;
    }

    await this.publisher.query('SELECT pg_notify($1, $2)', [
      channel,
      JSON.stringify(payload),
    ]);
  }

  async subscribe(channel: string, handler: PubSubHandler) {
    this.assertChannel(channel);

    const handlers = this.handlers.get(channel) ?? new Set<PubSubHandler>();
    handlers.add(handler);
    this.handlers.set(channel, handlers);

    if (this.listener) {
      await this.listen(channel);
    }
  }

  private async listen(channel: string) {
    if (this.listeningChannels.has(channel) || !this.listener) return;

    await this.listener.query(`LISTEN ${channel}`);
    this.listeningChannels.add(channel);
  }

  private handleNotification(notification: Notification) {
    if (!notification.channel || !notification.payload) return;

    try {
      this.dispatch(notification.channel, JSON.parse(notification.payload));
    } catch {
      this.logger.warn(`Invalid pubsub payload on ${notification.channel}`);
    }
  }

  private dispatch(channel: string, payload: unknown) {
    const handlers = Array.from(this.handlers.get(channel) ?? []);

    for (const handler of handlers) {
      void Promise.resolve(handler(payload)).catch((error: Error) => {
        this.logger.error(
          `Pubsub handler failed for ${channel}: ${error.message}`,
          error.stack,
        );
      });
    }
  }

  private assertChannel(channel: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(channel)) {
      throw new Error(`Invalid pubsub channel: ${channel}`);
    }
  }
}
