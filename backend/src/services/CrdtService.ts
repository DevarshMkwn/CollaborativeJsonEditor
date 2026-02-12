/**
 * CRDT Service using Yjs for conflict-free collaborative editing
 * Handles document state synchronization and update management
 */

import * as Y from 'yjs';
import Logger from '../utils/logger';

export class CrdtService {
  private documents: Map<string, Y.Doc> = new Map();
  private logger: Logger;

  constructor(instanceId: string = 'crdt-service') {
    this.logger = new Logger(undefined, instanceId);
  }

  /**
   * Get or create a new Yjs document for a room
   */
  getOrCreateDocument(roomId: string): Y.Doc {
    if (!this.documents.has(roomId)) {
      const doc = new Y.Doc();
      // Initialize with empty shared map
      doc.getMap('state');
      this.documents.set(roomId, doc);
      this.logger.debug(`Created new Yjs document for room: ${roomId}`);
    }
    return this.documents.get(roomId)!;
  }

  /**
   * Get existing document without creating
   */
  getDocument(roomId: string): Y.Doc | null {
    return this.documents.get(roomId) || null;
  }

  /**
   * Apply a JSON update to the document (for custom JSON-based updates)
   */
  applyJsonUpdate(roomId: string, updateObj: Record<string, unknown>): void {
    try {
      const doc = this.getOrCreateDocument(roomId);
      const state = doc.getMap('state');

      doc.transact(() => {
        for (const [key, value] of Object.entries(updateObj)) {
          state.set(key, value);
        }
      });

      this.logger.debug(`Applied JSON update to room ${roomId}`, {
        keys: Object.keys(updateObj)
      });
    } catch (error) {
      this.logger.error(`Failed to apply JSON update to room ${roomId}`, error);
      throw error;
    }
  }

  /**
   * Apply a Yjs update to a document
   */
  applyUpdate(roomId: string, update: Uint8Array): void {
    try {
      // Validate update
      if (!update || update.length === 0) {
        this.logger.warn(`Empty update received for room ${roomId}`);
        return;
      }

      const doc = this.getOrCreateDocument(roomId);
      
      // Apply the update
      Y.applyUpdate(doc, update);
      this.logger.debug(`Applied update to room ${roomId}`, {
        updateSize: update.length,
        firstBytes: Array.from(update.slice(0, 4)).map(b => '0x' + b.toString(16)).join(' ')
      });
    } catch (error) {
      this.logger.error(`Failed to apply update to room ${roomId}`, {
        error: error instanceof Error ? error.message : String(error),
        updateSize: update?.length || 0,
        updateFirstBytes: update ? Array.from(update.slice(0, 4)).map(b => '0x' + b.toString(16)).join(' ') : 'N/A'
      });
      throw error;
    }
  }

  /**
   * Get the current state of a document as Yjs update
   */
  getDocumentState(roomId: string): Uint8Array {
    const doc = this.getOrCreateDocument(roomId);
    return Y.encodeStateAsUpdate(doc);
  }

  /**
   * Get the document state as a plain JSON object
   */
  getDocumentAsJson(roomId: string): Record<string, unknown> {
    const doc = this.getOrCreateDocument(roomId);
    const state = doc.getMap('state');
    return state.toJSON() as Record<string, unknown>;
  }

  /**
   * Set a value in the document's shared state
   */
  setValue(roomId: string, key: string, value: unknown): void {
    try {
      const doc = this.getOrCreateDocument(roomId);
      const state = doc.getMap('state');
      doc.transact(() => {
        state.set(key, value);
      });
      this.logger.debug(`Set value in room ${roomId}`, { key });
    } catch (error) {
      this.logger.error(`Failed to set value in room ${roomId}`, error);
      throw error;
    }
  }

  /**
   * Subscribe to document changes (for a specific room)
   */
  observeDocumentChanges(
    roomId: string,
    callback: (update: Uint8Array, origin: unknown) => void
  ): (update: Uint8Array, origin: unknown) => void {
    const doc = this.getOrCreateDocument(roomId);
    const observer = (update: Uint8Array, origin: unknown) => {
      callback(update, origin);
    };
    doc.on('update', observer);
    return observer;
  }

  /**
   * Unsubscribe from document changes
   */
  unobserveDocumentChanges(roomId: string, observer: (update: Uint8Array, origin: unknown) => void): void {
    const doc = this.getDocument(roomId);
    if (doc) {
      doc.off('update', observer);
    }
  }

  /**
   * Delete a document (cleanup)
   */
  deleteDocument(roomId: string): void {
    const doc = this.getDocument(roomId);
    if (doc) {
      doc.destroy();
      this.documents.delete(roomId);
      this.logger.debug(`Deleted document for room: ${roomId}`);
    }
  }

  /**
   * Get statistics about stored documents
   */
  getStats(): {
    totalDocuments: number;
    roomIds: string[];
  } {
    return {
      totalDocuments: this.documents.size,
      roomIds: Array.from(this.documents.keys())
    };
  }
}

export default CrdtService;
