import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { IGameState, PlayerId, MetricType } from '../interfaces';

// Import the SocketService class from the frontend
const { SocketService } = require('../../newfrontend/src/services/socketService');

// JWT secret must match the server's
const JWT_SECRET = 'your_super_secret_jwt_key';
const generateToken = (userId: PlayerId, username: string) =>
  jwt.sign({ userId, username }, JWT_SECRET, { expiresIn: '1h' });

describe('Frontend SocketService E2E Test', () => {
  let player1: any;
  let player2: any;

  // Helper to create a mock Redux store
  const createMockStore = (token: string) => ({
    getState: () => ({ user: { token } }),
    dispatch: jest.fn(),
  });

  // Helper to wait for a socket event once
  const waitFor = (service: any, event: string) =>
    new Promise(resolve => service.socket.once(event, resolve));

  beforeAll(() => {
    // Create two separate stores and SocketService instances
    const token1 = generateToken('player1-id', 'Alice');
    const token2 = generateToken('player2-id', 'Bob');

    jest.doMock('../../newfrontend/src/store/index', () => ({
      store: createMockStore(token1),
    }));
    player1 = new SocketService();

    jest.doMock('../../newfrontend/src/store/index', () => ({
      store: createMockStore(token2),
    }));
    player2 = new SocketService();
  });

  afterAll(() => {
    player1.disconnect();
    player2.disconnect();
  });

  test('should complete a full game round including an action card', async () => {
    // 1. Connect both players
    const p1Connect = new Promise<void>((resolve, reject) => {
      player1.socket.on('connect', resolve);
      player1.socket.on('connect_error', reject);
    });
    const p2Connect = new Promise<void>((resolve, reject) => {
      player2.socket.on('connect', resolve);
      player2.socket.on('connect_error', reject);
    });
    player1.connect();
    player2.connect();
    await Promise.all([p1Connect, p2Connect]);

    // 2. Wait for auth:success
    const p1Auth = waitFor(player1, 'auth:success');
    const p2Auth = waitFor(player2, 'auth:success');
    await Promise.all([p1Auth, p2Auth]);

    // 3. Matchmaking
    let p1GameState: IGameState, p2GameState: IGameState;
    const p1GamePromise = waitFor(player1, 'game:stateUpdate').then(state => (p1GameState = state as IGameState));
    const p2GamePromise = waitFor(player2, 'game:stateUpdate').then(state => (p2GameState = state as IGameState));
    player1.findMatch();
    player2.findMatch();
    await Promise.all([p1GamePromise, p2GamePromise]);

    expect(p1GameState!.gameStatus).toBe('playing');
    expect(p2GameState!.gameStatus).toBe('playing');
    expect(p1GameState!.players.length).toBe(2);

    // 4. Game loop
    let turn = 1;
    while (p1GameState!.gameStatus === 'playing') {
      const currentPlayerId = p1GameState!.currentPlayerId;
      let activePlayer, activeState, waitingPlayer;
      if (currentPlayerId === 'player1-id') {
        activePlayer = player1;
        activeState = p1GameState!;
        waitingPlayer = player2;
      } else {
        activePlayer = player2;
        activeState = p2GameState!;
        waitingPlayer = player1;
      }

      const playerHand = activeState.players.find(p => p.id === currentPlayerId)!.hand;
      expect(playerHand.length).toBeGreaterThan(0);

      // Play action card if available and phase is correct
      const turboBoostCard = playerHand.find(c => c.cardId === 'ACTION_HP_BOOST_TEMP');
      if (activeState.currentPlayerPhase === 'waiting_for_initial_play' && turboBoostCard) {
        const p1UpdatePromise = waitFor(player1, 'game:stateUpdate');
        const p2UpdatePromise = waitFor(player2, 'game:stateUpdate');
        activePlayer.playCard(turboBoostCard.instanceId);
        [p1GameState, p2GameState] = await Promise.all([p1UpdatePromise, p2UpdatePromise]) as [IGameState, IGameState];
      }

      // Play car card
      const carCard = activeState.players.find(p => p.id === currentPlayerId)!.hand.find(c => c.cardId.startsWith('CAR_'));
      expect(carCard).toBeDefined();

      let selectedMetric: MetricType | undefined = undefined;
      if (p1GameState!.selectedMetricForRound === null) {
        selectedMetric = 'hp';
      }

      const p1FinalUpdate = waitFor(player1, 'game:stateUpdate');
      const p2FinalUpdate = waitFor(player2, 'game:stateUpdate');
      activePlayer.playCard(carCard!.instanceId, selectedMetric);
      [p1GameState, p2GameState] = await Promise.all([p1FinalUpdate, p2FinalUpdate]) as [IGameState, IGameState];
      turn++;
    }

    expect(['win', 'loss', 'tie']).toContain(p1GameState!.gameStatus);

    // Wait for game:end
    const p1EndPromise = waitFor(player1, 'game:end');
    const p2EndPromise = waitFor(player2, 'game:end');
    const endData = await Promise.all([p1EndPromise, p2EndPromise]);
    expect(endData[0]).toHaveProperty('winnerId');
  }, 60000);
}); 