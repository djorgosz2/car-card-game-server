import { createServer } from 'http';

describe('Simple HTTP Server Test', () => {
  let httpServer: any;
  let port: number;

  beforeAll(async () => {
    console.log('[SIMPLE TEST] Starting simple HTTP server test');
    port = 5000 + Math.floor(Math.random() * 1000);
    console.log('[SIMPLE TEST] Selected port:', port);
    
    httpServer = createServer();
    
    await new Promise<void>((resolve, reject) => {
      console.log('[SIMPLE TEST] Attempting to listen on port', port);
      
      httpServer.listen(port, () => {
        console.log('[SIMPLE TEST] Successfully listening on port', port);
        resolve();
      });
      
      httpServer.on('error', (error: any) => {
        console.log('[SIMPLE TEST] Server error:', error.message);
        reject(error);
      });
    });
    
    console.log('[SIMPLE TEST] beforeAll completed');
  }, 10000);

  afterAll(() => {
    console.log('[SIMPLE TEST] Closing server');
    if (httpServer) {
      httpServer.close();
    }
  });

  test('should start server successfully', () => {
    console.log('[SIMPLE TEST] Running test');
    expect(httpServer).toBeDefined();
    expect(port).toBeGreaterThan(0);
  });
}); 