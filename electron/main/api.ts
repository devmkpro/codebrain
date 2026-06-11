import express from 'express';
import { Server } from 'http';

const app = express();
let server: Server | null = null;

// Middleware
app.use(express.json());

/**
 * GET /api/health
 * Standard health check endpoint for monitoring the local API server status.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

/**
 * Starts the local API server
 * @param port The port to listen on (defaults to 3000)
 */
export function startApiServer(port: number = 3000): Server {
  if (server) return server;

  server = app.listen(port, () => {
    console.log(`[API] Codebrain server running on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    console.error('[API] Server error:', err);
  });

  return server;
}

/**
 * Stops the local API server
 */
export async function stopApiServer(): Promise<void> {
  if (server) {
    return new Promise((resolve) => {
      server!.close((err) => {
        if (err) console.error('[API] Error closing server:', err);
        server = null;
        console.log('[API] Server stopped');
        resolve();
      });
    });
  }
}

export default app;