import { startTestServer } from './testServer';
import { io as Client } from 'socket.io-client';

describe('Socket.IO Test Server', () => {
  let httpServer: any;
  let clientSocket: any;
  let port: number;
  let io: any;

  beforeAll(async () => {
    console.log('[TEST] Starting beforeAll setup');
    port = 5000 + Math.floor(Math.random() * 1000);
    console.log('[TEST] Selected port:', port);
    
    console.log('[TEST] Starting test server...');
    ({ httpServer, io } = await startTestServer(port));
    console.log('[TEST] Test server started successfully');
    
    console.log('[TEST] Creating client socket...');
    clientSocket = Client(`http://localhost:${port}`);
    
    console.log('[TEST] Waiting for client connection...');
    await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        console.log('[TEST] Client connected successfully');
        resolve(true);
      });
      clientSocket.on('connect_error', (error: any) => {
        console.log('[TEST] Client connection error:', error.message);
      });
    });
    console.log('[TEST] beforeAll setup completed');
  }, 20000); // 20 másodperc timeout

  afterAll(() => {
    clientSocket.close();
    io.close();
    httpServer.close();
  });

  test('should connect and disconnect', (done) => {
    console.log('[TEST] Running connect/disconnect test');
    expect(clientSocket.connected).toBe(true);
    clientSocket.on('disconnect', () => {
      console.log('[TEST] Client disconnected as expected');
      expect(clientSocket.connected).toBe(false);
      done();
    });
    console.log('[TEST] Disconnecting client...');
    clientSocket.disconnect();
  });

  test('should echo pong on ping', (done) => {
    console.log('[TEST] Running ping/pong test');
    clientSocket.emit('ping');
    clientSocket.on('pong', () => {
      console.log('[TEST] Received pong response');
      done();
    });
  });
});