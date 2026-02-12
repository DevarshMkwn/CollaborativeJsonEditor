/**
 * WebSocket Handler
 * Handles WebSocket message processing and client communication
 */

import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import { MessageType, IMessage, IDocumentUpdate } from "../types";
import Logger from "../utils/logger";
import RoomManager from "../managers/RoomManager";
import CrdtService from "../services/CrdtService";
import RedisService from "../services/RedisService";
import MetricsService from "../services/MetricsService";

export class WebSocketHandler {
  private roomManager: RoomManager;
  private crdt: CrdtService;
  private redis: RedisService;
  private metrics: MetricsService;
  private logger: Logger;
  private instanceId: string;
  private clientConnections: Map<string, WebSocket> = new Map();

  constructor(
    roomManager: RoomManager,
    crdt: CrdtService,
    redis: RedisService,
    metrics: MetricsService,
    instanceId: string = "ws-handler",
  ) {
    this.roomManager = roomManager;
    this.crdt = crdt;
    this.redis = redis;
    this.metrics = metrics;
    this.instanceId = instanceId;
    this.logger = new Logger(undefined, instanceId);
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: WebSocket): void {
    const clientId = uuidv4();
    this.clientConnections.set(clientId, ws);

    this.logger.info(`New WebSocket connection: ${clientId}`);
    this.metrics.incrementMessagesProcessed();

    ws.on("message", (data) => {
      this.handleMessage(clientId, data);
    });
    ws.on("close", () => this.handleDisconnect(clientId));
    ws.on("error", (error) => this.handleError(clientId, error));
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(
    clientId: string,
    data: WebSocket.Data,
  ): Promise<void> {
    try {
      const ws = this.clientConnections.get(clientId);
      if (!ws) return;

      const startTime = Date.now();

      // Parse message - handle both JSON and binary formats
      let message: IMessage;

      // First, try to parse as JSON (string or convertible to string)
      if (typeof data === "string") {
        try {
          message = JSON.parse(data);
        } catch (error) {
          this.logger.warn(`Invalid JSON message from ${clientId}`, error);
          this.sendError(ws, "Invalid message format");
          return;
        }
      } else if (data instanceof Buffer || data instanceof Uint8Array || ArrayBuffer.isView(data)) {
        // Try to decode as string first (might be text-encoded JSON)
        let jsonStr: string | null = null;
        try {
          const buffer = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data as ArrayBuffer);
          jsonStr = buffer.toString("utf8");

          // Check if it looks like JSON
          if (jsonStr.trim().startsWith("{")) {
            message = JSON.parse(jsonStr);
          } else {
            // Not JSON, try binary decode
            const binaryMessage = this.decodeBinaryDocumentUpdate(
              data,
              clientId,
            );
            if (binaryMessage) {
              message = binaryMessage;
            } else {
              this.logger.warn(
                `Invalid message from ${clientId} - not JSON or valid binary`,
              );
              this.sendError(ws, "Invalid message format");
              return;
            }
          }
        } catch (error) {
          // If UTF-8 conversion or JSON parse fails, try binary
          const binaryMessage = this.decodeBinaryDocumentUpdate(data, clientId);
          if (binaryMessage) {
            message = binaryMessage;
          } else {
            this.logger.warn(`Invalid message from ${clientId}`, error);
            this.sendError(ws, "Invalid message format");
            return;
          }
        }
      } else {
        this.logger.warn(`Unknown data type from ${clientId}`);
        this.sendError(ws, "Invalid message format");
        return;
      }

      this.metrics.incrementMessagesProcessed();

      // Route message based on type
      switch (message.type) {
        case MessageType.JOIN_ROOM:
          await this.handleJoinRoom(clientId, ws, message);
          break;
        case MessageType.LEAVE_ROOM:
          await this.handleLeaveRoom(clientId, message);
          break;
        case MessageType.DOCUMENT_UPDATE:
          await this.handleDocumentUpdate(clientId, message);
          break;
        case MessageType.SYNC_UPDATE:
          // SYNC_UPDATE is handled by Redis subscription only
          break;
        default:
          this.logger.warn(`Unknown message type: ${message.type}`);
      }

      const latency = Date.now() - startTime;
      this.metrics.recordUpdateLatency(latency);
    } catch (error) {
      this.logger.error(`Error handling message from ${clientId}`, error);
    }
  }

  /**
   * Decode binary document update message
   * Format: [1 byte type=1][2 bytes roomLen][room utf8][8 bytes timestamp][4 bytes updateLen][update bytes]
   * Note: Uses little-endian for multi-byte values (matching client's DataView defaults)
   */
  private decodeBinaryDocumentUpdate(
    data: WebSocket.Data,
    clientId?: string,
  ): IMessage | null {
    try {
      const buffer = Buffer.isBuffer(data)
        ? data
        : Buffer.from(data as ArrayBuffer);
      
      if (buffer.length < 15) {
        // Minimum: 1 + 2 + 0 + 8 + 4 = 15 bytes
        return null;
      }

      let offset = 0;

      // Read type (1 byte)
      const type = buffer.readUInt8(offset);
      offset += 1;

      if (type !== 1) {
        // Not a document-update message
        return null;
      }

      // Read room length (2 bytes, little-endian)
      const roomLen = buffer.readUInt16LE(offset);
      offset += 2;

      if (offset + roomLen > buffer.length) {
        return null;
      }

      // Read room ID (UTF-8)
      const roomId = buffer.toString("utf8", offset, offset + roomLen);
      offset += roomLen;

      if (offset + 8 > buffer.length) {
        return null;
      }

      // Read timestamp (8 bytes, little-endian BigUint64)
      const timestamp = Number(buffer.readBigUInt64LE(offset));
      offset += 8;

      if (offset + 4 > buffer.length) {
        return null;
      }

      // Read update length (4 bytes, little-endian)
      const updateLen = buffer.readUInt32LE(offset);
      offset += 4;

      if (offset + updateLen !== buffer.length) {
        return null;
      }

      // Read update bytes
      const updateBytes = buffer.slice(offset, offset + updateLen);

      // Convert to IMessage format with base64-encoded update
      const message: IMessage = {
        type: MessageType.DOCUMENT_UPDATE,
        roomId,
        clientId,
        payload: {
          update: Buffer.from(updateBytes).toString("base64"),
          clientId: clientId || "",
          timestamp,
        },
        timestamp: Date.now(),
      };

      this.logger.debug(`Successfully decoded binary document update`, {
        roomId,
        clientId,
        updateSize: updateBytes.length,
        timestamp,
      });

      return message;
    } catch (error) {
      this.logger.debug(`Failed to decode binary document update`, error);
      return null;
    }
  }

  /**
   * Handle JOIN_ROOM message
   */
  private async handleJoinRoom(
    clientId: string,
    ws: WebSocket,
    message: IMessage,
  ): Promise<void> {
    const { roomId } = message;
    if (!roomId) {
      this.sendError(ws, "Missing roomId");
      return;
    }

    try {
      // Join room
      this.roomManager.addClientToRoom(clientId, roomId, this.instanceId);

      // Get current document state
      const documentState = this.crdt.getDocumentState(roomId);

      this.logger.debug(`Sending initial state for room ${roomId}`, {
        stateSize: documentState.length,
        isEmpty: documentState.length === 0,
        firstBytes:
          documentState.length > 0
            ? Array.from(documentState.slice(0, 10))
                .map((b) => "0x" + b.toString(16).padStart(2, "0"))
                .join(" ")
            : "empty",
      });

      // Send document state to client
      const stateMessage: IMessage = {
        type: MessageType.DOCUMENT_STATE,
        roomId,
        clientId,
        payload: {
          state: Buffer.from(documentState).toString("base64"),
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      };

      ws.send(JSON.stringify(stateMessage));

      // Send ACK directly to the joining client with their client ID
      const ackMessage: IMessage = {
        type: MessageType.ACK,
        roomId,
        clientId,
        payload: {
          message: `You joined the room ${roomId}`,
          clientJoined: clientId,
        },
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(ackMessage));

      // Notify other clients about the new client joining
      this.broadcastToRoom(
        roomId,
        {
          type: MessageType.ACK,
          roomId,
          payload: {
            message: `Client ${clientId} joined the room`,
            clientJoined: clientId,
          },
          timestamp: Date.now(),
        },
        clientId,
      );

      // Subscribe to room updates via Redis (if not already subscribed)
      const channel = `room:${roomId}:updates`;
      const redisStatus = this.redis.getStatus();
      
      if (!redisStatus.subscribedChannels.includes(channel)) {
        try {
          await this.redis.subscribe(channel, (redisMessage) => {
            this.handleRedisUpdate(roomId, redisMessage);
          });
          this.logger.info(`Subscribed to Redis channel for room ${roomId}`, { channel });
        } catch (subError) {
          this.logger.error(`Failed to subscribe to Redis channel ${channel}`, subError);
          this.sendError(ws, "Failed to subscribe to room updates");
          return;
        }
      }

      this.logger.info(`Client ${clientId} successfully joined room ${roomId}`);
    } catch (error) {
      this.logger.error(`Failed to join room ${roomId}`, error);
      this.sendError(ws, "Failed to join room");
    }
  }

  /**
   * Handle LEAVE_ROOM message
   */
  private async handleLeaveRoom(
    clientId: string,
    message: IMessage,
  ): Promise<void> {
    const { roomId } = message;
    if (!roomId) return;

    try {
      this.roomManager.removeClientFromRoom(clientId);

      // Notify others in room
      this.broadcastToRoom(
        roomId,
        {
          type: MessageType.ACK,
          roomId,
          payload: {
            message: `Client ${clientId} left the room`,
            clientLeft: clientId,
          },
          timestamp: Date.now(),
        },
        clientId,
      );

      this.logger.info(`Client ${clientId} left room ${roomId}`);
    } catch (error) {
      this.logger.error(`Error leaving room ${roomId}`, error);
    }
  }

  /**
   * Handle DOCUMENT_UPDATE message (from client)
   */
  private async handleDocumentUpdate(
    clientId: string,
    message: IMessage,
  ): Promise<void> {
    const { roomId, payload } = message;
    if (!roomId || !payload) return;

    try {
      const update = payload as IDocumentUpdate;

      if (typeof update.update !== "string") {
        this.logger.warn(`Update is not a string, skipping`);
        return;
      }

      // Decode base64 to buffer
      const buffer = Buffer.from(update.update, "base64");
      
      // Try to decode as JSON first (for custom JSON updates)
      let jsonUpdateObj: Record<string, unknown> | null = null;
      try {
        const jsonStr = buffer.toString('utf-8');
        // Check if it looks like JSON
        if (jsonStr.trim().startsWith('{')) {
          jsonUpdateObj = JSON.parse(jsonStr);
        }
      } catch (jsonError) {
        // Not JSON, will try binary format below
      }

      if (jsonUpdateObj) {
        // Handle JSON update
        this.crdt.applyJsonUpdate(roomId, jsonUpdateObj);
      } else {
        // Handle binary Yjs update
        const updateUint8 = new Uint8Array(buffer.length);
        for (let i = 0; i < buffer.length; i++) {
          updateUint8[i] = buffer[i];
        }

        // Validate update is not empty
        if (updateUint8.length === 0) {
          this.logger.warn(
            `Received empty update from ${clientId} in room ${roomId}`,
          );
          return;
        }

        this.crdt.applyUpdate(roomId, updateUint8);
      }

      this.roomManager.recordUpdate(roomId);
      this.metrics.incrementUpdates();

      // Publish to Redis for other instances
      const channel = `room:${roomId}:updates`;
      try {
        const subscriberCount = await this.redis.publish(
          channel,
          JSON.stringify({
            type: MessageType.SYNC_UPDATE,
            clientId,
            update: update.update, // Send original base64 to keep consistency
            timestamp: Date.now(),
            instanceId: this.instanceId,
          }),
        );
        this.logger.debug(`Published update to Redis for room ${roomId}`, {
          channel,
          subscriberCount,
          updateSize: buffer.length,
        });
      } catch (redisError) {
        this.logger.error(`Failed to publish to Redis for room ${roomId}`, redisError);
      }

      // Broadcast to other clients in this instance
      this.broadcastToRoom(
        roomId,
        {
          type: MessageType.DOCUMENT_UPDATE,
          roomId,
          clientId,
          payload: {
            update: update.update,
            timestamp: Date.now(),
          },
          timestamp: Date.now(),
        },
        clientId,
      );

      this.logger.debug(`Applied update from ${clientId} in room ${roomId}`, {
        updateType: jsonUpdateObj ? 'json' : 'binary',
        updateSize: buffer.length,
      });
    } catch (error) {
      this.logger.error(
        `Failed to apply document update in room ${roomId}`,
        error,
      );
    }
  }

  /**
   * Handle SYNC_UPDATE from Redis (from other instances)
   */
  private handleRedisUpdate(roomId: string, redisMessage: string): void {
    try {
      const update = JSON.parse(redisMessage);

      // Skip if this instance publishes to itself (shouldn't happen but safety check)
      if (update.instanceId === this.instanceId) {
        return;
      }

      const updateBuffer = Buffer.from(update.update, "base64");

      // Try to decode as JSON first (for custom JSON updates)
      let jsonUpdateObj: Record<string, unknown> | null = null;
      try {
        const jsonStr = updateBuffer.toString('utf-8');
        // Check if it looks like JSON
        if (jsonStr.trim().startsWith('{')) {
          jsonUpdateObj = JSON.parse(jsonStr);
        }
      } catch (jsonError) {
        // Not JSON, will try binary format below
      }

      if (jsonUpdateObj) {
        // Handle JSON update
        this.crdt.applyJsonUpdate(roomId, jsonUpdateObj);
      } else {
        // Handle binary Yjs update
        const updateUint8 = new Uint8Array(updateBuffer);

        this.crdt.applyUpdate(roomId, updateUint8);
      }

      this.roomManager.recordUpdate(roomId);
      this.metrics.incrementUpdates();

      // Broadcast to local clients
      this.broadcastToRoom(roomId, {
        type: MessageType.DOCUMENT_UPDATE,
        roomId,
        clientId: update.clientId,
        payload: {
          update: update.update,
          timestamp: update.timestamp,
        },
        timestamp: Date.now(),
      });

      this.logger.debug(
        `Applied sync update for room ${roomId} from instance ${update.instanceId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle Redis update for room ${roomId}`,
        error,
      );
    }
  }

  /**
   * Handle disconnect
   */
  private handleDisconnect(clientId: string): void {
    const client = this.roomManager.getClient(clientId);
    if (client) {
      this.handleLeaveRoom(clientId, {
        type: MessageType.LEAVE_ROOM,
        roomId: client.roomId,
        timestamp: Date.now(),
      });
    }

    this.clientConnections.delete(clientId);
    this.logger.info(`Client ${clientId} disconnected`);
  }

  /**
   * Handle WebSocket error
   */
  private handleError(clientId: string, error: Error): void {
    this.logger.error(`WebSocket error for client ${clientId}`, error);
    this.metrics.incrementConnectionErrors();
  }

  /**
   * Broadcast message to all clients in a room
   */
  private broadcastToRoom(
    roomId: string,
    message: IMessage,
    excludeClientId?: string,
  ): void {
    const clients = this.roomManager.getClientsInRoom(roomId);
    const messageStr = JSON.stringify(message);

    clients.forEach((client) => {
      if (excludeClientId && client.id === excludeClientId) {
        return;
      }

      const ws = this.clientConnections.get(client.id);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(messageStr);
      }
    });
  }

  /**
   * Send error message to client
   */
  private sendError(ws: WebSocket, errorMessage: string): void {
    const message: IMessage = {
      type: MessageType.ERROR,
      roomId: "",
      payload: { error: errorMessage },
      timestamp: Date.now(),
    };
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Update metrics based on current state
   */
  updateMetrics(): void {
    const stats = this.roomManager.getStats();
    this.metrics.setActiveRooms(stats.totalRooms);
    this.metrics.setConnectedClients(stats.totalClients);
  }
}

export default WebSocketHandler;
