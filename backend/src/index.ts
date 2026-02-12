/**
 * Main entry point for the Distributed State Synchronization Service
 */

import http from "http";
import WebSocket from "ws";
import loadConfig from "./utils/config";
import Logger, { LogLevel } from "./utils/logger";
import CrdtService from "./services/CrdtService";
import MetricsService from "./services/MetricsService";
import RedisService from "./services/RedisService";
import RoomManager from "./managers/RoomManager";
import WebSocketHandler from "./handlers/WebSocketHandler";

const config = loadConfig();
const logLevel = config.logLevel.toUpperCase() as keyof typeof LogLevel;
const logger = new Logger(
  LogLevel[logLevel] || LogLevel.INFO,
  config.instanceId,
);

logger.info("Starting Distributed State Synchronization Service", {
  port: config.port,
  metricsPort: config.metricsPort,
  instanceId: config.instanceId,
  redisHost: config.redisHost,
  redisPort: config.redisPort,
});

// Initialize services
const crdt = new CrdtService(config.instanceId);
const metrics = new MetricsService();
const redis = new RedisService(
  config.redisHost,
  config.redisPort,
  config.instanceId,
);
const roomManager = new RoomManager(crdt, config.instanceId);
const wsHandler = new WebSocketHandler(
  roomManager,
  crdt,
  redis,
  metrics,
  config.instanceId,
);

// Create WebSocket server
const server = http.createServer((req, res) => {
  // Don't handle upgrade requests here - let WebSocket.Server handle them
  if (req.headers.upgrade === 'websocket') {
    return;
  }

  // Health check endpoint
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", instanceId: config.instanceId }));
    return;
  }

  // Default 404
  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  wsHandler.handleConnection(ws);
});

// Create metrics server
const metricsServer = http.createServer(async (req, res) => {
  if (req.url === "/metrics") {
    try {
      const metricsOutput = await metrics.getMetrics();
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(metricsOutput);
    } catch (error) {
      logger.error("Error serving metrics", error);
      res.writeHead(500);
      res.end("Internal Server Error");
    }
    return;
  }

  // Diagnostic endpoint
  if (req.url === "/diagnostics") {
    const redisStatus = redis.getStatus();
    const roomStats = roomManager.getStats();
    const diagnostics = {
      instanceId: config.instanceId,
      timestamp: new Date().toISOString(),
      redis: {
        connected: redisStatus.connected,
        subscribedChannels: redisStatus.subscribedChannels,
        channelCount: redisStatus.subscribedChannels.length,
      },
      rooms: {
        total: roomStats.totalRooms,
        totalClients: roomStats.totalClients,
        details: roomStats.rooms,
      },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(diagnostics, null, 2));
    return;
  }

  // Health check for metrics server
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        instanceId: config.instanceId,
        redis: redis.getStatus(),
      }),
    );
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

// Update metrics periodically
setInterval(() => {
  wsHandler.updateMetrics();
}, 1000);

// Graceful shutdown
process.on("SIGINT", async () => {
  logger.info("Shutting down gracefully...");

  // Close WebSocket server
  wss.close(() => {
    logger.info("WebSocket server closed");
  });

  // Close metrics server
  metricsServer.close(() => {
    logger.info("Metrics server closed");
  });

  // Close main server
  server.close(async () => {
    logger.info("Main server closed");

    // Disconnect Redis
    try {
      await redis.disconnect();
      logger.info("Redis disconnected");
    } catch (error) {
      logger.error("Error disconnecting Redis", error);
    }

    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error("Graceful shutdown timeout, forcing exit");
    process.exit(1);
  }, 10000);
});

// Start servers
async function start(): Promise<void> {
  try {
    // Connect to Redis
    await redis.connect();
    logger.info("Redis connected successfully");

    // Start WebSocket server
    server.listen(config.port, () => {
      logger.info(`WebSocket server listening on port ${config.port}`);
    });

    // Start metrics server
    metricsServer.listen(config.metricsPort, () => {
      logger.info(`Metrics server listening on port ${config.metricsPort}`);
    });

    logger.info("Services started successfully", {
      wsUrl: `ws://localhost:${config.port}`,
      metricsUrl: `http://localhost:${config.metricsPort}/metrics`,
    });
  } catch (error) {
    logger.error("Failed to start services", error);
    process.exit(1);
  }
}

start().catch((error) => {
  logger.error("Unexpected error during startup", error);
  process.exit(1);
});
