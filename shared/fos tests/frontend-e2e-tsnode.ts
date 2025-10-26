// Frontend E2E Test using ts-node
// Teszteli a frontend SocketService-t a futó szerverrel

import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';

const SOCKET_URL = 'http://localhost:3000';
const JWT_SECRET = 'your_super_secret_jwt_key';

const generateToken = (userId: string, username: string) =>
  jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '1h' });

console.log('[FRONTEND E2E] Starting frontend E2E test...');

// Create two socket clients
const player1 = io(SOCKET_URL, {
  transports: ['websocket'],
  autoConnect: false,
});

const player2 = io(SOCKET_URL, {
  transports: ['websocket'],
  autoConnect: false,
});

// Generate tokens
const token1 = generateToken('player1-id', 'Alice');
const token2 = generateToken('player2-id', 'Bob');

// Helper to wait for events
const waitFor = (socket: any, event: string) =>
  new Promise(resolve => socket.once(event, resolve));

async function runE2ETest() {
  try {
    console.log('[FRONTEND E2E] Step 1: Connecting players...');
    
    // Connect both players
    const p1Connect = new Promise<void>((resolve, reject) => {
      player1.on('connect', () => {
        console.log('[FRONTEND E2E] ✅ Player 1 connected');
        resolve();
      });
      player1.on('connect_error', reject);
    });

    const p2Connect = new Promise<void>((resolve, reject) => {
      player2.on('connect', () => {
        console.log('[FRONTEND E2E] ✅ Player 2 connected');
        resolve();
      });
      player2.on('connect_error', reject);
    });

    player1.connect();
    player2.connect();

    await Promise.all([p1Connect, p2Connect]);

    console.log('[FRONTEND E2E] Step 2: Authenticating players...');

    // Authenticate both players
    const p1Auth = new Promise((resolve, reject) => {
      player1.on('auth:success', (data: any) => {
        console.log('[FRONTEND E2E] ✅ Player 1 authenticated:', data);
        resolve(data);
      });
      player1.on('auth:error', reject);
    });

    const p2Auth = new Promise((resolve, reject) => {
      player2.on('auth:success', (data: any) => {
        console.log('[FRONTEND E2E] ✅ Player 2 authenticated:', data);
        resolve(data);
      });
      player2.on('auth:error', reject);
    });

    player1.emit('auth:authenticate', { token: token1 });
    player2.emit('auth:authenticate', { token: token2 });

    await Promise.all([p1Auth, p2Auth]);

    console.log('[FRONTEND E2E] Step 3: Starting matchmaking...');

    // Start matchmaking and wait for game state
    const p1State = waitFor(player1, 'game:stateUpdate');
    const p2State = waitFor(player2, 'game:stateUpdate');

    player1.emit('matchmaking:find');
    player2.emit('matchmaking:find');

    console.log('[FRONTEND E2E] Step 4: Waiting for game state updates...');

    const [state1, state2] = await Promise.all([p1State, p2State]);
    console.log('[FRONTEND E2E] ✅ Game state received!');
    console.log('[FRONTEND E2E] Game state:', JSON.stringify(state1, null, 2));

    console.log('[FRONTEND E2E] ✅ Test completed successfully!');

    // Cleanup
    player1.disconnect();
    player2.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('[FRONTEND E2E] ❌ Test failed:', error);
    player1.disconnect();
    player2.disconnect();
    process.exit(1);
  }
}

// Run the test
runE2ETest();

// Timeout after 30 seconds
setTimeout(() => {
  console.error('[FRONTEND E2E] ❌ Test timeout');
  player1.disconnect();
  player2.disconnect();
  process.exit(1);
}, 30000); 