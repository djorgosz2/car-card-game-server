import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

// Import the SocketService class from the frontend
const { SocketService } = require('../../newfrontend/src/services/socketService');

// JWT secret must match the server's
const JWT_SECRET = 'your_super_secret_jwt_key';
const generateToken = (userId: string, username: string) =>
  jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '1h' });

describe('Simple Frontend SocketService E2E Test', () => {
  let player1: any;

  // Helper to create a mock Redux store
  const createMockStore = (token: string) => ({
    getState: () => ({ user: { token } }),
    dispatch: jest.fn(),
  });

  beforeAll(() => {
    // Create one SocketService instance
    const token1 = generateToken('player1-id', 'Alice');
    
    jest.doMock('../../newfrontend/src/store/index', () => ({
      store: createMockStore(token1),
    }));
    player1 = new SocketService();
  });

  afterAll(() => {
    if (player1) {
      player1.disconnect();
    }
  });

  test('should connect and authenticate successfully', async () => {
    console.log('[TEST] Starting simple frontend E2E test...');
    
    // 1. Connect
    const connectPromise = new Promise<void>((resolve, reject) => {
      player1.socket.on('connect', () => {
        console.log('[TEST] ✅ Connected successfully!');
        resolve();
      });
      player1.socket.on('connect_error', (err: any) => {
        console.error('[TEST] ❌ Connection error:', err);
        reject(err);
      });
    });

    player1.connect();
    await connectPromise;

    // 2. Wait for auth:success
    const authPromise = new Promise((resolve, reject) => {
      player1.socket.on('auth:success', (data: any) => {
        console.log('[TEST] ✅ Authentication successful:', data);
        expect(data.userId).toBe('player1-id');
        expect(data.username).toBe('Alice');
        resolve(data);
      });
      player1.socket.on('auth:error', (data: any) => {
        console.error('[TEST] ❌ Authentication error:', data);
        reject(new Error(data.message));
      });
    });

    await authPromise;
    console.log('[TEST] ✅ Test completed successfully!');
  }, 30000);
}); 