/**
 * Configuration loader from environment variables
 */

import { IConfig } from '../types';

function loadConfig(): IConfig {
  return {
    port: parseInt(process.env.PORT || '8080', 10),
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
    instanceId: process.env.INSTANCE_ID || 'instance-1',
    logLevel: process.env.LOG_LEVEL || 'info',
    metricsPort: parseInt(process.env.METRICS_PORT || '9091', 10),
    nodeEnv: process.env.NODE_ENV || 'development'
  };
}

export default loadConfig;
