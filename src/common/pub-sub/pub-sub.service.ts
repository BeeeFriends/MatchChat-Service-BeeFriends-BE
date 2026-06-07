import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient } from 'redis';

export const PUBSUB_CHANNELS = {
  CAMPUS_EVENTS: 'beefriends:campus-events',
  CHAT_MESSAGES: 'beefriends:match-chat-messages',
  CHAT_READS: 'beefriends:match-chat-reads',
  DEPARTMENT_EVENTS: 'beefriends:department-events',
  HOBBY_EVENTS: 'beefriends:hobby-events',
  MATCH_EVENTS: 'beefriends:match-events',
  PRESENCE: 'beefriends:match-chat-presence',
  USER_EVENTS: 'beefriends:user-events',
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
  consumerGroup: string;
  consumerName: string;
  draining: boolean;
  pollIntervalMs: number;
  replayFromStart: boolean;
};
type RedisClient = ReturnType<typeof createClient>;

const DEFAULT_RECONNECT_INTERVAL_MS = 5000;
const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_STREAM_MAXLEN = 10000;
const DURABLE_BATCH_SIZE = 100;

@Injectable()
export class PubSubService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PubSubService.name);
  private readonly realtimeHandlers = new Map<string, Set<PubSubHandler>>();
  private readonly durableHandlers = new Map<string, Set<PubSubHandler>>();
  private readonly durableSubscriptions = new Map<
    string,
    DurableSubscription
  >();
  private readonly subscribedChannels = new Set<string>();
  private readonly pollTimers = new Map<string, NodeJS.Timeout>();
  private redisUrl?: string;
  private publisher?: RedisClient;
  private subscriber?: RedisClient;
  private reconnectTimer?: NodeJS.Timeout;
  private connecting = false;
  private shuttingDown = false;

  onModuleInit() {
    this.redisUrl = process.env.REDIS_URL;
    if (!this.redisUrl) {
      this.logger.warn('REDIS_URL is not set; redis pubsub is local only');
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

  async publish(channel: string, payload: unknown, options: PublishOptions = {}) {
    this.assertChannel(channel);

    const serializedPayload = JSON.stringify(payload);
    const shouldPersist = options.durable ?? true;

    if (!this.publisher?.isReady) {
      await this.dispatch(channel, payload, false);
      void this.connectWithRetry();
      return;
    }

    try {
      if (shouldPersist) {
        await this.publisher.xAdd(
          channel,
          '*',
          { payload: serializedPayload },
          {
            TRIM: {
              strategy: 'MAXLEN',
              strategyModifier: '~',
              threshold: this.getStreamMaxLen(),
            },
          },
        );
      }
      await this.publisher.publish(channel, serializedPayload);
    } catch (error) {
      this.logger.warn(
        `Redis pubsub publish failed for ${channel}: ${
          (error as Error).message
        }`,
      );
      this.scheduleReconnect();
      await this.dispatch(channel, payload, false);
    }
  }

  async subscribe(
    channel: string,
    handler: PubSubHandler,
    options: SubscribeOptions = {},
  ) {
    this.assertChannel(channel);

    const handlerMap = options.durable
      ? this.durableHandlers
      : this.realtimeHandlers;
    const handlers = handlerMap.get(channel) ?? new Set<PubSubHandler>();
    handlers.add(handler);
    handlerMap.set(channel, handlers);

    if (options.durable) {
      const consumerGroup =
        options.consumerId ??
        process.env.PUBSUB_CONSUMER_ID ??
        `match-chat:${channel}`;
      const subscription: DurableSubscription = {
        consumerGroup,
        consumerName: this.getConsumerName(consumerGroup),
        draining: false,
        pollIntervalMs:
          options.pollIntervalMs ??
          this.getNumberEnv('PUBSUB_POLL_INTERVAL_MS', DEFAULT_POLL_INTERVAL_MS),
        replayFromStart: options.replayFromStart ?? true,
      };
      this.durableSubscriptions.set(channel, subscription);
      this.startPolling(channel);

      if (this.publisher?.isReady) {
        await this.ensureConsumerGroup(channel, subscription);
        void this.drainDurableChannel(channel);
      }
    }

    if (this.subscriber?.isReady) {
      await this.subscribeChannel(channel);
    } else {
      void this.connectWithRetry();
    }
  }

  private async connectWithRetry() {
    if (this.connecting || this.shuttingDown || !this.redisUrl) return;

    this.connecting = true;

    while (!this.shuttingDown) {
      try {
        await this.disconnectClients();

        const publisher = this.createRedisClient();
        const subscriber = this.createRedisClient();

        this.bindClientLifecycle(publisher, 'publisher');
        this.bindClientLifecycle(subscriber, 'subscriber');

        await publisher.connect();
        await subscriber.connect();

        this.publisher = publisher;
        this.subscriber = subscriber;
        this.subscribedChannels.clear();

        for (const channel of this.getKnownChannels()) {
          await this.subscribeChannel(channel);
        }

        for (const [channel, subscription] of this.durableSubscriptions) {
          await this.ensureConsumerGroup(channel, subscription);
          this.startPolling(channel);
          void this.drainDurableChannel(channel);
        }

        this.logger.log('Redis pubsub connected');
        break;
      } catch (error) {
        this.logger.warn(
          `Redis pubsub connect failed, retrying: ${(error as Error).message}`,
        );
        await this.disconnectClients();
        await this.delay(this.getReconnectIntervalMs());
      }
    }

    this.connecting = false;
  }

  private createRedisClient() {
    return createClient({
      url: this.redisUrl,
      socket: {
        reconnectStrategy: (retries) =>
          Math.min(this.getReconnectIntervalMs() * (retries + 1), 30000),
      },
    });
  }

  private bindClientLifecycle(client: RedisClient, name: string) {
    client.on('error', (error: Error) => {
      if (this.shuttingDown) return;
      this.logger.warn(`Redis pubsub ${name} error: ${error.message}`);
    });

    client.on('end', () => {
      if (this.shuttingDown) return;
      this.logger.warn(`Redis pubsub ${name} disconnected`);
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
    const subscriber = this.subscriber;

    this.publisher = undefined;
    this.subscriber = undefined;
    this.subscribedChannels.clear();

    await Promise.allSettled([
      publisher?.quit().catch(() => publisher.destroy()),
      subscriber?.quit().catch(() => subscriber.destroy()),
    ]);
  }

  private async subscribeChannel(channel: string) {
    if (this.subscribedChannels.has(channel) || !this.subscriber?.isReady) {
      return;
    }

    await this.subscriber.subscribe(channel, (message) => {
      void this.handlePubSubMessage(channel, message);
    });
    this.subscribedChannels.add(channel);
  }

  private async handlePubSubMessage(channel: string, message: string) {
    try {
      const payload = JSON.parse(message) as unknown;
      await this.dispatch(channel, payload, false);

      if (this.durableSubscriptions.has(channel)) {
        void this.drainDurableChannel(channel);
      }
    } catch (error) {
      this.logger.warn(
        `Invalid redis pubsub payload on ${channel}: ${
          (error as Error).message
        }`,
      );
    }
  }

  private async ensureConsumerGroup(
    channel: string,
    subscription: DurableSubscription,
  ) {
    if (!this.publisher?.isReady) return;

    try {
      await this.publisher.xGroupCreate(
        channel,
        subscription.consumerGroup,
        subscription.replayFromStart ? '0' : '$',
        { MKSTREAM: true },
      );
    } catch (error) {
      if (!this.isBusyGroupError(error)) {
        throw error;
      }
    }
  }

  private startPolling(channel: string) {
    if (this.pollTimers.has(channel)) return;

    const subscription = this.durableSubscriptions.get(channel);
    if (!subscription) return;

    this.pollTimers.set(
      channel,
      setInterval(() => {
        void this.drainDurableChannel(channel);
      }, subscription.pollIntervalMs),
    );
  }

  private async drainDurableChannel(channel: string) {
    const subscription = this.durableSubscriptions.get(channel);
    if (!subscription || !this.publisher?.isReady || subscription.draining) {
      return;
    }

    subscription.draining = true;

    try {
      await this.ensureConsumerGroup(channel, subscription);
      await this.readStreamMessages(channel, subscription, '0');
      await this.readStreamMessages(channel, subscription, '>');
    } catch (error) {
      this.logger.warn(
        `Redis stream drain failed for ${channel}: ${(error as Error).message}`,
      );
      this.scheduleReconnect();
    } finally {
      subscription.draining = false;
    }
  }

  private async readStreamMessages(
    channel: string,
    subscription: DurableSubscription,
    id: '0' | '>',
  ) {
    while (!this.shuttingDown && this.publisher?.isReady) {
      const streams = (await this.publisher.xReadGroup(
        subscription.consumerGroup,
        subscription.consumerName,
        { key: channel, id },
        { COUNT: DURABLE_BATCH_SIZE },
      )) as
        | Array<{
            messages: Array<{
              id: string;
              message: Record<string, string>;
            }>;
          }>
        | null;

      const messages = streams?.flatMap((stream) => stream.messages) ?? [];
      if (!messages.length) break;

      for (const entry of messages) {
        const payload = this.parseStreamPayload(entry.message.payload);
        if (payload === undefined) {
          await this.publisher.xAck(
            channel,
            subscription.consumerGroup,
            entry.id,
          );
          continue;
        }

        await this.dispatch(channel, payload, true);
        await this.publisher.xAck(channel, subscription.consumerGroup, entry.id);
      }

      if (messages.length < DURABLE_BATCH_SIZE) break;
    }
  }

  private parseStreamPayload(payload?: string) {
    if (!payload) return undefined;

    try {
      return JSON.parse(payload) as unknown;
    } catch {
      return undefined;
    }
  }

  private async dispatch(
    channel: string,
    payload: unknown,
    durable: boolean,
  ) {
    const handlers = durable
      ? this.durableHandlers.get(channel)
      : this.realtimeHandlers.get(channel);
    if (!handlers?.size) return;

    await Promise.all(
      Array.from(handlers).map((handler) => Promise.resolve(handler(payload))),
    );
  }

  private getKnownChannels() {
    return new Set([
      ...this.realtimeHandlers.keys(),
      ...this.durableHandlers.keys(),
      ...this.durableSubscriptions.keys(),
    ]);
  }

  private getConsumerName(consumerGroup: string) {
    return (
      process.env.REDIS_CONSUMER_NAME ??
      process.env.RAILWAY_REPLICA_ID ??
      process.env.SERVICE_NAME ??
      consumerGroup
    );
  }

  private assertChannel(channel: string) {
    if (!/^[A-Za-z0-9:_-]+$/.test(channel)) {
      throw new Error(`Invalid redis pubsub channel: ${channel}`);
    }
  }

  private isBusyGroupError(error: unknown) {
    return (
      error instanceof Error &&
      error.message.toUpperCase().includes('BUSYGROUP')
    );
  }

  private getReconnectIntervalMs() {
    return this.getNumberEnv(
      'PUBSUB_RECONNECT_INTERVAL_MS',
      DEFAULT_RECONNECT_INTERVAL_MS,
    );
  }

  private getStreamMaxLen() {
    return this.getNumberEnv('REDIS_STREAM_MAXLEN', DEFAULT_STREAM_MAXLEN);
  }

  private getNumberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
