import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Client } from 'pg';
import type { Notification } from 'pg';

export const PUBSUB_CHANNELS = {
  CAMPUS_EVENTS: 'campus_events',
  CHAT_MESSAGES: 'match_chat_messages',
  DEPARTMENT_EVENTS: 'department_events',
  HOBBY_EVENTS: 'hobby_events',
  PRESENCE: 'match_chat_presence',
  USER_EVENTS: 'user_events',
} as const;

type PubSubHandler = (payload: unknown) => Promise<void> | void;
type PublishOptions = { durable?: boolean };
type SubscribeOptions = {
  durable?: boolean;
  consumerId?: string;
  pollIntervalMs?: number;
  replayFromStart?: boolean;
};
type DurableSubscription = {
  consumerId: string;
  draining: boolean;
  pollIntervalMs: number;
  replayFromStart: boolean;
};
type PubSubEventRow = {
  id: string;
  payload: unknown;
};

const DEFAULT_RECONNECT_INTERVAL_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DURABLE_BATCH_SIZE = 100;

@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private readonly handlers = new Map<string, Set<PubSubHandler>>();
  private readonly listeningChannels = new Set<string>();
  private readonly durableSubscriptions = new Map<
    string,
    DurableSubscription
  >();
  private readonly pollTimers = new Map<string, NodeJS.Timeout>();
  private connectionString?: string;
  private publisher?: Client;
  private listener?: Client;
  private reconnectTimer?: NodeJS.Timeout;
  private connecting = false;
  private shuttingDown = false;

  onModuleInit() {
    this.connectionString =
      process.env.MATCH_CHAT_DATABASE_URL ?? process.env.PUBSUB_DATABASE_URL;
    if (!this.connectionString) {
      this.logger.warn(
        'MATCH_CHAT_DATABASE_URL or PUBSUB_DATABASE_URL is not set; pubsub is local only',
      );
      return;
    }

    void this.connectWithRetry();
  }

  async onModuleDestroy() {
    this.shuttingDown = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();

    await this.disconnectClients();
  }

  async publish(
    channel: string,
    payload: unknown,
    options: PublishOptions = {},
  ) {
    this.assertChannel(channel);

    if (options.durable) {
      await this.publishDurable(channel, payload);
      return;
    }

    if (!this.publisher) {
      await this.dispatch(channel, payload);
      this.scheduleReconnect();
      return;
    }

    try {
      await this.publisher.query('SELECT pg_notify($1, $2)', [
        channel,
        JSON.stringify(payload),
      ]);
    } catch (error) {
      this.logger.warn(
        `Pubsub publish failed for ${channel}: ${(error as Error).message}`,
      );
      this.scheduleReconnect();
      await this.dispatch(channel, payload);
    }
  }

  async subscribe(
    channel: string,
    handler: PubSubHandler,
    options: SubscribeOptions = {},
  ) {
    this.assertChannel(channel);

    const handlers = this.handlers.get(channel) ?? new Set<PubSubHandler>();
    handlers.add(handler);
    this.handlers.set(channel, handlers);

    if (options.durable) {
      const subscription: DurableSubscription = {
        consumerId:
          options.consumerId ??
          process.env.PUBSUB_CONSUMER_ID ??
          `match-chat:${channel}`,
        draining: false,
        pollIntervalMs:
          options.pollIntervalMs ??
          this.getNumberEnv(
            'PUBSUB_POLL_INTERVAL_MS',
            DEFAULT_POLL_INTERVAL_MS,
          ),
        replayFromStart: options.replayFromStart ?? true,
      };
      this.durableSubscriptions.set(channel, subscription);
      this.startPolling(channel);

      if (this.publisher) {
        await this.ensureDurableOffset(channel, subscription);
        void this.drainDurableChannel(channel);
      }
    }

    if (this.listener) {
      await this.listen(channel);
    }
  }

  private async connectWithRetry() {
    if (this.connecting || this.shuttingDown || !this.connectionString) return;

    this.connecting = true;

    while (!this.shuttingDown) {
      try {
        await this.disconnectClients();

        const publisher = new Client({
          connectionString: this.connectionString,
        });
        const listener = new Client({
          connectionString: this.connectionString,
        });

        this.bindClientLifecycle(publisher, 'publisher');
        this.bindClientLifecycle(listener, 'listener');
        listener.on('notification', (notification) => {
          void this.handleNotification(notification);
        });

        await publisher.connect();
        await listener.connect();

        this.publisher = publisher;
        this.listener = listener;
        this.listeningChannels.clear();

        await this.ensureDurableTables();

        for (const channel of this.handlers.keys()) {
          await this.listen(channel);
        }

        for (const [channel, subscription] of this.durableSubscriptions) {
          await this.ensureDurableOffset(channel, subscription);
          this.startPolling(channel);
          void this.drainDurableChannel(channel);
        }

        this.logger.log('Pubsub connected');
        break;
      } catch (error) {
        this.logger.warn(
          `Pubsub connect failed, retrying: ${(error as Error).message}`,
        );
        await this.disconnectClients();
        await this.delay(this.getReconnectIntervalMs());
      }
    }

    this.connecting = false;
  }

  private bindClientLifecycle(client: Client, name: string) {
    client.on('error', (error: Error) => {
      if (this.shuttingDown) return;
      this.logger.warn(`Pubsub ${name} error: ${error.message}`);
      this.scheduleReconnect();
    });

    client.on('end', () => {
      if (this.shuttingDown) return;
      this.logger.warn(`Pubsub ${name} disconnected`);
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect() {
    if (this.shuttingDown || this.connecting || this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectWithRetry();
    }, this.getReconnectIntervalMs());
    void this.disconnectClients();
  }

  private async disconnectClients() {
    const publisher = this.publisher;
    const listener = this.listener;

    this.publisher = undefined;
    this.listener = undefined;
    this.listeningChannels.clear();

    await Promise.allSettled([publisher?.end(), listener?.end()]);
  }

  private async publishDurable(channel: string, payload: unknown) {
    if (!this.publisher) {
      throw new Error('Pubsub publisher is not connected');
    }

    await this.ensureDurableTables();

    const event = await this.publisher.query<{ id: string }>(
      `
        INSERT INTO pubsub_events (channel, payload)
        VALUES ($1, $2::jsonb)
        RETURNING id
      `,
      [channel, JSON.stringify(payload)],
    );

    try {
      await this.publisher.query('SELECT pg_notify($1, $2)', [
        channel,
        JSON.stringify({ eventId: event.rows[0].id }),
      ]);
    } catch (error) {
      this.logger.warn(
        `Durable pubsub notify failed for ${channel}: ${
          (error as Error).message
        }`,
      );
      this.scheduleReconnect();
    }
  }

  private async listen(channel: string) {
    if (this.listeningChannels.has(channel) || !this.listener) return;

    await this.listener.query(`LISTEN ${channel}`);
    this.listeningChannels.add(channel);
  }

  private async handleNotification(notification: Notification) {
    if (!notification.channel || !notification.payload) return;

    try {
      const payload = JSON.parse(notification.payload) as unknown;

      if (
        this.durableSubscriptions.has(notification.channel) &&
        this.isDurableNotification(payload)
      ) {
        await this.drainDurableChannel(notification.channel);
        return;
      }

      await this.dispatch(notification.channel, payload);
    } catch {
      this.logger.warn(`Invalid pubsub payload on ${notification.channel}`);
    }
  }

  private async drainDurableChannel(channel: string) {
    const subscription = this.durableSubscriptions.get(channel);
    if (!subscription || !this.publisher || subscription.draining) return;

    subscription.draining = true;

    try {
      await this.ensureDurableOffset(channel, subscription);

      while (!this.shuttingDown && this.publisher) {
        const events = await this.fetchDurableEvents(channel, subscription);
        if (!events.length) break;

        for (const event of events) {
          await this.dispatch(channel, event.payload, true);
          await this.updateDurableOffset(channel, subscription, event.id);
        }

        if (events.length < DURABLE_BATCH_SIZE) break;
      }
    } catch (error) {
      this.logger.warn(
        `Durable pubsub replay failed for ${channel}: ${
          (error as Error).message
        }`,
      );
    } finally {
      subscription.draining = false;
    }
  }

  private async fetchDurableEvents(
    channel: string,
    subscription: DurableSubscription,
  ): Promise<PubSubEventRow[]> {
    if (!this.publisher) return [];

    const offset = await this.publisher.query<{ last_event_id: string }>(
      `
        SELECT last_event_id
        FROM pubsub_offsets
        WHERE consumer_id = $1 AND channel = $2
      `,
      [subscription.consumerId, channel],
    );
    const lastEventId = offset.rows[0]?.last_event_id ?? '0';

    const events = await this.publisher.query<PubSubEventRow>(
      `
        SELECT id::text, payload
        FROM pubsub_events
        WHERE channel = $1 AND id > $2::bigint
        ORDER BY id ASC
        LIMIT $3
      `,
      [channel, lastEventId, DURABLE_BATCH_SIZE],
    );

    return events.rows;
  }

  private async ensureDurableTables() {
    if (!this.publisher) return;

    await this.publisher.query(`
      CREATE TABLE IF NOT EXISTS pubsub_events (
        id BIGSERIAL PRIMARY KEY,
        channel TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await this.publisher.query(`
      CREATE INDEX IF NOT EXISTS idx_pubsub_events_channel_id
      ON pubsub_events (channel, id)
    `);
    await this.publisher.query(`
      CREATE TABLE IF NOT EXISTS pubsub_offsets (
        consumer_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        last_event_id BIGINT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (consumer_id, channel)
      )
    `);
  }

  private async ensureDurableOffset(
    channel: string,
    subscription: DurableSubscription,
  ) {
    if (!this.publisher) return;

    const initialOffset = subscription.replayFromStart
      ? '0'
      : await this.getCurrentChannelEventId(channel);

    await this.publisher.query(
      `
        INSERT INTO pubsub_offsets (consumer_id, channel, last_event_id)
        VALUES ($1, $2, $3::bigint)
        ON CONFLICT (consumer_id, channel) DO NOTHING
      `,
      [subscription.consumerId, channel, initialOffset],
    );
  }

  private async getCurrentChannelEventId(channel: string) {
    if (!this.publisher) return '0';

    const result = await this.publisher.query<{ last_event_id: string }>(
      `
        SELECT COALESCE(MAX(id), 0)::text AS last_event_id
        FROM pubsub_events
        WHERE channel = $1
      `,
      [channel],
    );

    return result.rows[0]?.last_event_id ?? '0';
  }

  private async updateDurableOffset(
    channel: string,
    subscription: DurableSubscription,
    eventId: string,
  ) {
    if (!this.publisher) return;

    await this.publisher.query(
      `
        INSERT INTO pubsub_offsets (
          consumer_id,
          channel,
          last_event_id,
          updated_at
        )
        VALUES ($1, $2, $3::bigint, now())
        ON CONFLICT (consumer_id, channel)
        DO UPDATE SET last_event_id = EXCLUDED.last_event_id,
                      updated_at = now()
      `,
      [subscription.consumerId, channel, eventId],
    );
  }

  private startPolling(channel: string) {
    const subscription = this.durableSubscriptions.get(channel);
    if (!subscription || this.pollTimers.has(channel)) return;

    const timer = setInterval(() => {
      void this.drainDurableChannel(channel);
    }, subscription.pollIntervalMs);
    this.pollTimers.set(channel, timer);
  }

  private async dispatch(
    channel: string,
    payload: unknown,
    bubbleErrors = false,
  ) {
    const handlers = Array.from(this.handlers.get(channel) ?? []);
    const results = await Promise.allSettled(
      handlers.map((handler) => Promise.resolve(handler(payload))),
    );

    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    if (!rejected) return;

    const error = rejected.reason as Error;
    this.logger.error(
      `Pubsub handler failed for ${channel}: ${error.message}`,
      error.stack,
    );

    if (bubbleErrors) throw error;
  }

  private isDurableNotification(payload: unknown): payload is {
    eventId: string | number;
  } {
    return (
      typeof payload === 'object' &&
      payload !== null &&
      'eventId' in payload &&
      (typeof payload.eventId === 'string' ||
        typeof payload.eventId === 'number')
    );
  }

  private assertChannel(channel: string) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(channel)) {
      throw new Error(`Invalid pubsub channel: ${channel}`);
    }
  }

  private getReconnectIntervalMs() {
    return this.getNumberEnv(
      'PUBSUB_RECONNECT_INTERVAL_MS',
      DEFAULT_RECONNECT_INTERVAL_MS,
    );
  }

  private getNumberEnv(key: string, fallback: number) {
    const value = Number(process.env[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
