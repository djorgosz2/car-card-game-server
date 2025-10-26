import { createServer } from 'http';
import { Server } from 'socket.io';

export function startTestServer(port: number) {
  const httpServer = createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] }
  });

  // Import and use the main server logic here if needed, or add minimal handlers for test
  // For now, just echo events for basic connection test
  io.on('connection', (socket) => {
    console.log('[TEST SERVER] Client connected:', socket.id);
    socket.on('ping', () => {
      console.log('[TEST SERVER] Received ping, sending pong');
      socket.emit('pong');
    });
    socket.on('disconnect', () => {
      console.log('[TEST SERVER] Client disconnected:', socket.id);
    });
    // You can add more handlers here or import your main logic
  });

  return new Promise<{ httpServer: any, io: any }>((resolve) => {
    console.log('[TEST SERVER] Starting server on port', port);
    httpServer.listen(port, () => {
      console.log('[TEST SERVER] Successfully listening on port', port);
      resolve({ httpServer, io });
    });
  });
} 