/*
  PVP Smoke Test (Node)

  Purpose: Connect two simulated clients to the running server, request PVP (humanOnly),
  wait for the game to start, and attempt to play one car card each.

  Usage:
    1) Start the server in another terminal:
       npm run dev    // or equivalent that starts src/index.ts on http://localhost:3000

    2) Install dependencies (once):
       npm i -D ts-node typescript socket.io-client fast-json-patch

    3) Run this script:
       npx ts-node scripts/pvp-smoke.ts
*/

import { io } from 'socket.io-client';
import * as jsonpatch from 'fast-json-patch';

type PlayerId = string;

interface CardInstance {
  instanceId: string;
  cardId: string;
  currentMetrics?: Record<string, number> | null;
  originalMetrics?: Record<string, number> | null;
}

interface PlayerState {
  id: PlayerId;
  name: string;
  hand: CardInstance[];
  score: number;
}

interface GameStateClient {
  gameId: string;
  players: PlayerState[];
  currentPlayerId: PlayerId;
  gameStatus: 'playing' | 'win' | 'tie' | 'paused';
  roundWinnerId: PlayerId | null;
  winnerId: PlayerId | null;
  selectedMetricForRound: string | null;
  activeActionCardsOnBoard: Record<PlayerId, CardInstance | null>;
  carCardsOnBoard: Record<PlayerId, CardInstance | null>;
  drawPileSize?: number;
  currentPlayerPhase: string;
}

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

async function delay(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

function firstCarCardInHand(state: GameStateClient, myId: PlayerId): CardInstance | null {
  const me = state.players.find(p => p.id === myId);
  if (!me) return null;
  const car = me.hand.find(c => !!c.currentMetrics);
  return car || null;
}

async function run() {
  const aId = `pvpA-${Math.random().toString(36).slice(2, 8)}`;
  const bId = `pvpB-${Math.random().toString(36).slice(2, 8)}`;

  const a = io(SERVER_URL, { transports: ['websocket'], autoConnect: false });
  const b = io(SERVER_URL, { transports: ['websocket'], autoConnect: false });

  let aState: GameStateClient | null = null;
  let bState: GameStateClient | null = null;

  const applyA = (patch: jsonpatch.Operation[]) => {
    if (!aState) return;
    const patched = jsonpatch.applyPatch(JSON.parse(JSON.stringify(aState)), patch, false, false).newDocument;
    aState = patched as GameStateClient;
  };
  const applyB = (patch: jsonpatch.Operation[]) => {
    if (!bState) return;
    const patched = jsonpatch.applyPatch(JSON.parse(JSON.stringify(bState)), patch, false, false).newDocument;
    bState = patched as GameStateClient;
  };

  const ready = { aStarted: false, bStarted: false, aPlayed: false, bPlayed: false };

  // Wire A
  a.on('connect', () => {
    a.emit('auth:authenticate', { userId: aId, username: 'P1' });
  });
  a.on('auth:success', () => {
    a.emit('matchmaking:join', { humanOnly: true });
  });
  a.on('game:start', () => { ready.aStarted = true; });
  a.on('game:stateUpdate', (state: GameStateClient) => { aState = state; });
  a.on('game:patch', (patch: jsonpatch.Operation[]) => { applyA(patch); });

  // Wire B
  b.on('connect', () => {
    b.emit('auth:authenticate', { userId: bId, username: 'P2' });
  });
  b.on('auth:success', () => {
    b.emit('matchmaking:join', { humanOnly: true });
  });
  b.on('game:start', () => { ready.bStarted = true; });
  b.on('game:stateUpdate', (state: GameStateClient) => { bState = state; });
  b.on('game:patch', (patch: jsonpatch.Operation[]) => { applyB(patch); });

  a.connect();
  b.connect();

  // Wait for game start
  const startDeadline = Date.now() + 15000;
  while (!(ready.aStarted && ready.bStarted)) {
    if (Date.now() > startDeadline) {
      throw new Error('Timeout waiting for game:start for both clients');
    }
    await delay(100);
  }
  console.log('[SMOKE] Game started for both clients');

  // Play one card each
  const playLoopDeadline = Date.now() + 30000;
  while (!(ready.aPlayed && ready.bPlayed)) {
    if (Date.now() > playLoopDeadline) throw new Error('Timeout waiting to play both cards');

    if (!ready.aPlayed && aState) {
      const currentA = aState as GameStateClient;
      if (currentA.gameStatus === 'playing') {
        if ((currentA.currentPlayerId === aId) && (currentA.currentPlayerPhase === 'waiting_for_initial_play' || currentA.currentPlayerPhase === 'waiting_for_car_card_after_action')) {
          const car = firstCarCardInHand(currentA, aId);
          if (car) {
            a.emit('game:playCard', { cardInstanceId: car.instanceId, payload: { selectedMetric: 'speed' } });
            ready.aPlayed = true;
            console.log('[SMOKE] P1 played a card');
          }
        }
      }
    }

    if (!ready.bPlayed && bState) {
      const currentB = bState as GameStateClient;
      if (currentB.gameStatus === 'playing') {
        if ((currentB.currentPlayerId === bId) && (currentB.currentPlayerPhase === 'waiting_for_initial_play' || currentB.currentPlayerPhase === 'waiting_for_car_card_after_action')) {
          const car = firstCarCardInHand(currentB, bId);
          if (car) {
            b.emit('game:playCard', { cardInstanceId: car.instanceId, payload: { selectedMetric: 'speed' } });
            ready.bPlayed = true;
            console.log('[SMOKE] P2 played a card');
          }
        }
      }
    }

    await delay(100);
  }

  console.log('[SMOKE] Success: both clients played one card. Exiting.');
  a.disconnect();
  b.disconnect();
  process.exit(0);
}

run().catch((err) => {
  console.error('[SMOKE] Failed:', err);
  process.exit(1);
});


