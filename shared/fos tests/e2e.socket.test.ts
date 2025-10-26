// Minimal Socket.IO E2E test based on official docs
// https://socket.io/docs/v4/testing/
process.env.DEBUG = '*';
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { createServer } from 'node:http';
import { type AddressInfo } from 'node:net';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { Server, Socket as ServerSocket } from 'socket.io';

let io: Server;
let httpServer: ReturnType<typeof createServer>;
let clientSocket: ClientSocket;
let serverSocket: ServerSocket;

describe('Socket.IO minimal E2E', () => {
  beforeAll((done) => {
    httpServer = createServer();
    io = new Server(httpServer);
    httpServer.listen(() => {
      const port = (httpServer.address() as AddressInfo).port;
      console.log('[TEST] Server listening on port', port);
      
      clientSocket = Client(`http://localhost:${port}`);
      
      io.on('connection', (socket) => {
        console.log('[TEST] Server received connection');
        serverSocket = socket;
      });
      
      // Várjuk meg a szerver kapcsolatot, nem a kliens connect eseményt
      io.on('connection', () => {
        console.log('[TEST] Server connection established');
        done();
      });
      
      clientSocket.on('connect_error', (err: any) => {
        console.error('[TEST] Client connect_error:', err.message, err.description);
        done(err);
      });
      
      clientSocket.on('disconnect', (reason) => {
        console.log('[TEST] Client disconnected:', reason);
      });
    });
  }, 30000);

  afterAll(() => {
    io.close();
    httpServer.close();
    clientSocket?.disconnect();
  });

  test('should work', (done) => {
    clientSocket.on('hello', (arg) => {
      console.log('[TEST] Client received hello:', arg);
      expect(arg).toBe('world');
      done();
    });
    
    serverSocket.emit('hello', 'world');
  }, 10000);

  test('should work with an acknowledgement', (done) => {
    serverSocket.on('hi', (cb) => {
      console.log('[TEST] Server received hi, sending hola');
      cb('hola');
    });
    
    clientSocket.emit('hi', (arg: any) => {
      console.log('[TEST] Client received acknowledgement:', arg);
      expect(arg).toBe('hola');
      done();
    });
  }, 10000);
});