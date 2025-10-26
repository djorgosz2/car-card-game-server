// Egyszerű Frontend Client Teszt
// Csak kapcsolódik a szerverhez

import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3000';

console.log('[SIMPLE TEST] Starting frontend client test...');

// Socket.IO kliens létrehozása
const socket = io(SOCKET_URL, {
  transports: ['websocket'],
  autoConnect: false,
});

// Event listeners
socket.on('connect', () => {
  console.log('[SIMPLE TEST] ✅ Connected to server successfully!');
  console.log('[SIMPLE TEST] Socket ID:', socket.id);
  console.log('[SIMPLE TEST] Connected:', socket.connected);
  
  // Kapcsolat bezárása
  setTimeout(() => {
    socket.disconnect();
    console.log('[SIMPLE TEST] Disconnected from server');
    process.exit(0);
  }, 2000);
});

socket.on('connect_error', (error) => {
  console.error('[SIMPLE TEST] ❌ Connection error:', error.message);
  process.exit(1);
});

socket.on('disconnect', (reason) => {
  console.log('[SIMPLE TEST] Disconnected:', reason);
});

// Kapcsolódás
console.log('[SIMPLE TEST] Attempting to connect...');
socket.connect();

// Timeout ha nem kapcsolódik
setTimeout(() => {
  console.error('[SIMPLE TEST] ❌ Connection timeout');
  process.exit(1);
}, 10000); 