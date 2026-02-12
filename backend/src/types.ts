/**
 * Type definitions for the Distributed State Synchronization Service
 */

/**
 * Represents a client connection in a room
 */
export interface IClient {
  id: string;
  roomId: string;
  instanceId: string;
  joinedAt: number;
}

/**
 * Represents a room with shared document state
 */
export interface IRoom {
  id: string;
  createdAt: number;
  clientCount: number;
  updatesCount: number;
  lastUpdateAt?: number;
}

/**
 * WebSocket message types
 */
export enum MessageType {
  JOIN_ROOM = 'join-room',
  LEAVE_ROOM = 'leave-room',
  DOCUMENT_UPDATE = 'document-update',
  DOCUMENT_STATE = 'document-state',
  SYNC_UPDATE = 'sync-update',
  ERROR = 'error',
  ACK = 'ack'
}

/**
 * WebSocket message structure
 */
export interface IMessage {
  type: MessageType;
  roomId: string;
  clientId?: string;
  payload?: unknown;
  timestamp: number;
}

/**
 * Document update from client
 */
export interface IDocumentUpdate {
  update: Uint8Array;
  clientId: string;
  timestamp: number;
}

/**
 * Configuration interface
 */
export interface IConfig {
  port: number;
  redisHost: string;
  redisPort: number;
  instanceId: string;
  logLevel: string;
  metricsPort: number;
  nodeEnv: string;
}

/**
 * Error response
 */
export interface IErrorResponse {
  message: string;
  code?: string;
  details?: unknown;
}
