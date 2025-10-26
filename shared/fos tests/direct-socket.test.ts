import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';

const SOCKET_URL = 'http://localhost:3000';
const JWT_SECRET = 'your_super_secret_jwt_key';

const generateToken = (userId: string, username: string) =>
  jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '1h' });

describe('Direct Socket.IO E2E Test', () => {
  let player1: any;
  let player2: any;

  beforeAll(() => {
    // Create two direct socket.io clients
    player1 = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: false,
    });
    player2 = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: false,
    });
  });

  afterAll(() => {
    player1.close();
    player2.close();
  });

  test('should connect and authenticate two players', async () => {
    console.log('[TEST] Starting direct socket test...');

    // Generate tokens
    const token1 = generateToken('player1-id', 'Alice');
    const token2 = generateToken('player2-id', 'Bob');

    // Connect both players
    const p1Connect = new Promise<void>((resolve, reject) => {
      player1.on('connect', () => {
        console.log('[TEST] Player 1 connected');
        resolve();
      });
      player1.on('connect_error', reject);
    });

    const p2Connect = new Promise<void>((resolve, reject) => {
      player2.on('connect', () => {
        console.log('[TEST] Player 2 connected');
        resolve();
      });
      player2.on('connect_error', reject);
    });

    player1.connect();
    player2.connect();

    await Promise.all([p1Connect, p2Connect]);

    // Authenticate both players
    const p1Auth = new Promise((resolve, reject) => {
      player1.on('auth:success', (data: any) => {
        console.log('[TEST] Player 1 authenticated:', data);
        expect(data.userId).toBe('player1-id');
        expect(data.username).toBe('Alice');
        resolve(data);
      });
      player1.on('auth:error', reject);
    });

    const p2Auth = new Promise((resolve, reject) => {
      player2.on('auth:success', (data: any) => {
        console.log('[TEST] Player 2 authenticated:', data);
        expect(data.userId).toBe('player2-id');
        expect(data.username).toBe('Bob');
        resolve(data);
      });
      player2.on('auth:error', reject);
    });

    // Send auth events
    player1.emit('auth:authenticate', { token: token1 });
    player2.emit('auth:authenticate', { token: token2 });

    await Promise.all([p1Auth, p2Auth]);

    console.log('[TEST] ✅ Both players connected and authenticated successfully!');
  }, 30000);
}); 