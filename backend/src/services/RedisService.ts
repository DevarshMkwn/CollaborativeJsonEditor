/**
 * Redis Service for multi-instance synchronization
 * Handles pub/sub for propagating updates across backend instances
 */

import { createClient, RedisClientOptions } from 'redis';
import Logger from '../utils/logger';

export class RedisService {
  private client: ReturnType<typeof createClient>;
  private pubClient: ReturnType<typeof createClient>;
  private instanceId: string;
  private logger: Logger;
  private subscriptions: Map<string, (message: string) => void> = new Map();

  constructor(
    redisHost: string = 'localhost',
    redisPort: number = 6379,
    instanceId: string = 'redis-service'
  ) {
    this.instanceId = instanceId;
    this.logger = new Logger(undefined, `${instanceId}-redis`);

    // Create separate clients for pub/sub (Redis limitation)
    const options: RedisClientOptions = {
      url: `redis://${redisHost}:${redisPort}`,
      socket: {
        reconnectStrategy: (retries: number) => {
          if (retries > 10) {
            this.logger.error('Max Redis reconnection attempts reached');
            return new Error('Max retries exceeded');
          }
          return 100 * retries;
        }
      }
    };

    this.client = createClient(options);
    this.pubClient = createClient(options);

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.client.on('connect', () => {
      this.logger.info('Connected to Redis');
    });

    this.client.on('error', (err: Error) => {
      this.logger.error('Redis client error', err);
    });

    this.pubClient.on('connect', () => {
      this.logger.info('Connected to Redis (pub client)');
    });

    this.pubClient.on('error', (err: Error) => {
      this.logger.error('Redis pub client error', err);
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      console.log(`[RedisService] Connecting to Redis...`);
      await this.client.connect();
      console.log(`[RedisService] Subscriber client connected`);
      await this.pubClient.connect();
      console.log(`[RedisService] Publisher client connected`);
      this.logger.info('Redis service connected');
    } catch (error) {
      console.error(`[RedisService] Failed to connect to Redis:`, error);
      this.logger.error('Failed to connect to Redis', error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      await this.pubClient.quit();
      this.logger.info('Redis service disconnected');
    } catch (error) {
      this.logger.error('Failed to disconnect from Redis', error);
      throw error;
    }
  }

  /**
   * Subscribe to a channel
   */
  async subscribe(
    channel: string,
    callback: (message: string) => void
  ): Promise<void> {
    try {
      console.log(`[RedisService] Subscribing to channel: ${channel}`);
      this.subscriptions.set(channel, callback);
      await this.client.subscribe(channel, (message: string) => {
        console.log(`[RedisService] Callback triggered for ${channel}, message length: ${message.length}`);
        callback(message);
      });
      console.log(`[RedisService] Successfully subscribed to: ${channel}`);
      this.logger.debug(`Subscribed to channel: ${channel}`);
    } catch (error) {
      console.error(`[RedisService] Failed to subscribe to channel ${channel}:`, error);
      this.logger.error(`Failed to subscribe to channel ${channel}`, error);
      throw error;
    }
  }

  /**
   * Unsubscribe from a channel
   */
  async unsubscribe(channel: string): Promise<void> {
    try {
      await this.client.unsubscribe(channel);
      this.subscriptions.delete(channel);
      this.logger.debug(`Unsubscribed from channel: ${channel}`);
    } catch (error) {
      this.logger.error(`Failed to unsubscribe from channel ${channel}`, error);
      throw error;
    }
  }

  /**
   * Publish a message to a channel
   */
  async publish(channel: string, message: string): Promise<number> {
    try {
      console.log(`[RedisService] Publishing to channel ${channel}, message size: ${message.length} bytes`);
      const reply = await this.pubClient.publish(channel, message);
      console.log(`[RedisService] Publish successful! Subscribers: ${reply}`);
      this.logger.debug(`Published to channel ${channel}`, { subscriberCount: reply });
      return reply;
    } catch (error) {
      console.error(`[RedisService] publish() failed for channel ${channel}:`, error);
      this.logger.error(`Failed to publish to channel ${channel}`, error);
      throw error;
    }
  }

  /**
   * Check if service is connected
   */
  isConnected(): boolean {
    try {
      return this.client && this.pubClient && (this.client as any).isReady && (this.pubClient as any).isReady;
    } catch {
      return false;
    }
  }

  /**
   * Get connection status
   */
  getStatus(): {
    connected: boolean;
    instanceId: string;
    subscribedChannels: string[];
  } {
    return {
      connected: this.isConnected(),
      instanceId: this.instanceId,
      subscribedChannels: Array.from(this.subscriptions.keys())
    };
  }
}

export default RedisService;
