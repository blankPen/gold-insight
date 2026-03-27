import Fastify from 'fastify';
import path from 'path';
import fastifyStatic from '@fastify/static';
import { registerRoutes } from './routes';
import { registerSSE } from './sse';
import db, { closeDb } from './db';
import config from './config';
import * as ScraperModule from './scraper';
import { monitor } from './monitor';

let fastifyInstance: any;
let sseManager: any;

async function start() {
  fastifyInstance = Fastify({ logger: true });
  fastifyInstance.register(fastifyStatic, {
    root: path.join(__dirname, 'public'),
    prefix: '/public/',
  });

  // 1) Initialize Database
  try {
    await db.getLatestPrice();
    fastifyInstance.log.info('Database initialized');
  } catch (e) {
    fastifyInstance.log.warn('Database initialization warning', e as any);
  }

  // 2) Start Scraper
  try {
    await ((ScraperModule as any).scraper.start)();
    fastifyInstance.log.info('Scraper started');
  } catch (e) {
    fastifyInstance.log.warn('Scraper start warning', e as any);
  }

  // 3) Register Routes
  try {
    await registerRoutes(fastifyInstance);
    fastifyInstance.log.info('Routes registered');
  } catch (e) {
    fastifyInstance.log.error(e as any);
    throw e;
  }

  // 4) Register SSE
  try {
    sseManager = registerSSE(fastifyInstance);
    fastifyInstance.log.info('SSE endpoint registered');
  } catch (e) {
    fastifyInstance.log.warn('SSE registration warning', e as any);
  }

  // 4.5) Start Monitor (technical indicators + alerts + feishu push)
  try {
    await monitor.start();
    fastifyInstance.log.info('Monitor started (indicators + alerts + feishu)');
  } catch (e) {
    fastifyInstance.log.warn('Monitor start warning', e as any);
  }

  // 5) Start HTTP server
  try {
    await fastifyInstance.listen({ port: config.port, host: '0.0.0.0' });
    fastifyInstance.log.info(`Server listening on port ${config.port}`);
  } catch (err) {
    fastifyInstance.log.error(err as any);
    process.exit(1);
  }

  // Graceful shutdown
  const gracefulShutdown = async () => {
    fastifyInstance.log.info('Shutting down gracefully...');
    try {
      await ((ScraperModule as any).scraper.stop)();
      fastifyInstance.log.info('Scraper stopped');
    } catch {
      // ignore
    }
    try {
      monitor.stop();
      fastifyInstance.log.info('Monitor stopped');
    } catch {
      // ignore
    }
    try {
      sseManager?.cleanup?.();
      fastifyInstance.log.info('SSE connections closed');
    } catch {
      // ignore
    }
    try {
      closeDb();
      fastifyInstance.log.info('Database closed');
    } catch {
      // ignore
    }
    try {
      await fastifyInstance.close();
      fastifyInstance.log.info('Server stopped');
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

console.log('[Index] Starting server...');
start();
