import express from 'express';
import { Server } from 'http';

const app = express();
let server: Server | null = null;

/**
 * GET /api/health
 * Returns a simple status object to verify the API server is running.
 */
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

/**
 * Starts the internal HTTP server for the main process.
 * @param port The port to bind the server to (default 3000).
 * @returns The Server instance.
 */
export function startApiServer(port: number = 3000): Server {
  if (server) return server;

  server = app.listen(port, () => {
    console.log(`[API] Internal health server listening on http://localhost:${port}/api/health`);
  });

  return server;
}

/**
 * Gracefully stops the internal API server.
 */
export function stopApiServer(): void {
  if (server) {
    server.close();
    server = null;
    console.log('[API] Internal server stopped');
  }
}

export default app;