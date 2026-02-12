/**
 * Prometheus Metrics Service
 * Tracks: active rooms, connected clients, updates per second, latency
 */

import { Counter, Gauge, Histogram, register } from 'prom-client';

export class MetricsService {
  private activeRoomsGauge: Gauge;
  private connectedClientsGauge: Gauge;
  private updatesPerSecondCounter: Counter;
  private updateLatencyHistogram: Histogram;
  private messagesProcessedCounter: Counter;
  private connectionErrorsCounter: Counter;

  constructor() {
    // Gauge: Number of active rooms
    this.activeRoomsGauge = new Gauge({
      name: 'collab_active_rooms',
      help: 'Number of active collaboration rooms',
      registers: [register]
    });

    // Gauge: Number of connected clients
    this.connectedClientsGauge = new Gauge({
      name: 'collab_connected_clients',
      help: 'Number of connected WebSocket clients',
      registers: [register]
    });

    // Counter: Total updates
    this.updatesPerSecondCounter = new Counter({
      name: 'collab_updates_total',
      help: 'Total number of document updates processed',
      registers: [register]
    });

    // Histogram: Update latency in milliseconds
    this.updateLatencyHistogram = new Histogram({
      name: 'collab_update_latency_ms',
      help: 'Latency of document update processing in milliseconds',
      buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
      registers: [register]
    });

    // Counter: Messages processed
    this.messagesProcessedCounter = new Counter({
      name: 'collab_messages_processed_total',
      help: 'Total number of messages processed',
      registers: [register]
    });

    // Counter: Connection errors
    this.connectionErrorsCounter = new Counter({
      name: 'collab_connection_errors_total',
      help: 'Total number of connection errors',
      registers: [register]
    });
  }

  setActiveRooms(count: number): void {
    this.activeRoomsGauge.set(count);
  }

  setConnectedClients(count: number): void {
    this.connectedClientsGauge.set(count);
  }

  incrementUpdates(): void {
    this.updatesPerSecondCounter.inc();
  }

  recordUpdateLatency(latencyMs: number): void {
    this.updateLatencyHistogram.observe(latencyMs);
  }

  incrementMessagesProcessed(): void {
    this.messagesProcessedCounter.inc();
  }

  incrementConnectionErrors(): void {
    this.connectionErrorsCounter.inc();
  }

  /**
   * Get all metrics in Prometheus format
   */
  async getMetrics(): Promise<string> {
    return register.metrics();
  }
}

export default MetricsService;
