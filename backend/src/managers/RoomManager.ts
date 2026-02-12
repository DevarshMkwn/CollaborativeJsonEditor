/**
 * Room Manager
 * Manages room lifecycle, client membership, and state synchronization
 */

import { IRoom, IClient } from '../types';
import Logger from '../utils/logger';
import CrdtService from '../services/CrdtService';

export class RoomManager {
  private rooms: Map<string, IRoom> = new Map();
  private roomClients: Map<string, Set<string>> = new Map();
  private clients: Map<string, IClient> = new Map();
  private crdt: CrdtService;
  private logger: Logger;

  constructor(crdt: CrdtService, instanceId: string = 'room-manager') {
    this.crdt = crdt;
    this.logger = new Logger(undefined, instanceId);
  }

  /**
   * Get or create a room
   */
  getOrCreateRoom(roomId: string): IRoom {
    if (!this.rooms.has(roomId)) {
      const room: IRoom = {
        id: roomId,
        createdAt: Date.now(),
        clientCount: 0,
        updatesCount: 0
      };
      this.rooms.set(roomId, room);
      this.roomClients.set(roomId, new Set());
      // Initialize CRDT document for this room
      this.crdt.getOrCreateDocument(roomId);
      this.logger.info(`Created new room: ${roomId}`);
    }
    return this.rooms.get(roomId)!;
  }

  /**
   * Add a client to a room
   */
  addClientToRoom(clientId: string, roomId: string, instanceId: string): IClient {
    const room = this.getOrCreateRoom(roomId);
    const client: IClient = {
      id: clientId,
      roomId,
      instanceId,
      joinedAt: Date.now()
    };

    this.clients.set(clientId, client);
    this.roomClients.get(roomId)!.add(clientId);
    room.clientCount = this.roomClients.get(roomId)!.size;

    this.logger.info(`Client ${clientId} joined room ${roomId}`, {
      totalClientsInRoom: room.clientCount
    });

    return client;
  }

  /**
   * Remove a client from a room
   */
  removeClientFromRoom(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const roomClients = this.roomClients.get(client.roomId);
    if (roomClients) {
      roomClients.delete(clientId);
    }

    const room = this.rooms.get(client.roomId);
    if (room) {
      room.clientCount = roomClients?.size || 0;
      // Clean up empty rooms
      if (room.clientCount === 0) {
        this.deleteRoom(client.roomId);
      }
    }

    this.clients.delete(clientId);
    this.logger.info(`Client ${clientId} left room ${client.roomId}`, {
      totalClientsInRoom: room?.clientCount || 0
    });
  }

  /**
   * Delete a room and cleanup
   */
  private deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
    this.roomClients.delete(roomId);
    this.crdt.deleteDocument(roomId);
    this.logger.info(`Deleted empty room: ${roomId}`);
  }

  /**
   * Get all clients in a room
   */
  getClientsInRoom(roomId: string): IClient[] {
    const clientIds = this.roomClients.get(roomId) || new Set();
    return Array.from(clientIds)
      .map(id => this.clients.get(id))
      .filter(Boolean) as IClient[];
  }

  /**
   * Get other clients in a room (excluding specified client)
   */
  getOtherClientsInRoom(roomId: string, excludeClientId: string): IClient[] {
    return this.getClientsInRoom(roomId).filter(client => client.id !== excludeClientId);
  }

  /**
   * Check if client exists
   */
  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  /**
   * Get client info
   */
  getClient(clientId: string): IClient | null {
    return this.clients.get(clientId) || null;
  }

  /**
   * Record an update in a room
   */
  recordUpdate(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.updatesCount++;
      room.lastUpdateAt = Date.now();
    }
  }

  /**
   * Get room info
   */
  getRoom(roomId: string): IRoom | null {
    return this.rooms.get(roomId) || null;
  }

  /**
   * Get all rooms
   */
  getAllRooms(): IRoom[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalRooms: number;
    totalClients: number;
    rooms: IRoom[];
  } {
    return {
      totalRooms: this.rooms.size,
      totalClients: this.clients.size,
      rooms: Array.from(this.rooms.values())
    };
  }
}

export default RoomManager;
